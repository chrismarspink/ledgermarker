"""docx / pdf / hwpx / hwp 텍스트 추출. 실패 시 빈 문자열이 아니라 ExtractError.

의존성(optional extra `formats`): python-docx, pypdf, olefile. 없으면 명시적으로 알린다.
"""

from __future__ import annotations

import re
import struct
import zipfile
import zlib
from pathlib import Path
from xml.etree import ElementTree as ET

from docsim.core.errors import ExtractError


def _need(module: str, pkg: str):
    try:
        return __import__(module)
    except ImportError as e:
        raise ExtractError(f"{pkg} 가 설치되어 있지 않습니다: pip install 'docsim[formats]'") from e


# ─────────────────────────── docx ───────────────────────────


def extract_docx(path: Path) -> str:
    _need("docx", "python-docx")
    from docx import Document
    from docx.oxml.ns import qn

    try:
        doc = Document(str(path))
    except Exception as e:  # noqa: BLE001
        raise ExtractError(f"docx 를 열 수 없습니다: {path.name} ({type(e).__name__})") from e
    lines: list[str] = []
    # 본문 순서대로 문단/표를 훑는다
    for el in doc.element.body.iterchildren():
        if el.tag == qn("w:p"):
            lines.append("".join(t.text or "" for t in el.iter(qn("w:t"))))
        elif el.tag == qn("w:tbl"):
            for row in el.iter(qn("w:tr")):
                cells = ["".join(t.text or "" for t in c.iter(qn("w:t"))) for c in row.iter(qn("w:tc"))]
                lines.append(" ".join(cells))
    return "\n".join(lines)


# ─────────────────────────── pdf ───────────────────────────


def _pdf_pages_pypdf(path: Path) -> list[str]:
    _need("pypdf", "pypdf")
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as e:  # noqa: BLE001
                raise ExtractError(f"암호화된 PDF: {path.name}") from e
        return [p.extract_text() or "" for p in reader.pages]
    except ExtractError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ExtractError(f"pdf 를 읽을 수 없습니다: {path.name} ({type(e).__name__})") from e


def extract_pdf(path: Path, ocr=None, progress=None) -> str:
    """텍스트 레이어 우선 (pypdfium2 → pypdf). 텍스트가 없는 페이지는 OCR 폴백 (config extract.ocr)."""
    from docsim.core.ocr import describe_ocr, ocr_png, pick_engine

    pages: list[str] | None = None
    pdf = None
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(str(path))
        pages = []
        for i in range(len(pdf)):
            tp = pdf[i].get_textpage()
            pages.append(tp.get_text_bounded() or "")
            tp.close()
    except ImportError:
        pages = None
    except Exception as e:  # noqa: BLE001
        if "password" in str(e).lower():
            raise ExtractError(f"암호화된 PDF: {path.name}") from e
        pages = None
    if pages is None:
        pages = _pdf_pages_pypdf(path)

    if ocr is not None and ocr.enabled:
        need = [i for i, t in enumerate(pages) if len(t.strip()) < ocr.min_chars_per_page]
        if need:
            engine = pick_engine(ocr)
            if engine is None:
                raise ExtractError(
                    f"pdf {len(need)}/{len(pages)} 페이지에 텍스트 레이어가 없습니다 (스캔 이미지). {describe_ocr(ocr)}: {path.name}"
                )
            try:
                import pypdfium2 as pdfium
            except ImportError as e:
                raise ExtractError("OCR 렌더링에 pypdfium2 가 필요합니다: pip install 'docsim[ocr]'") from e
            if pdf is None:
                pdf = pdfium.PdfDocument(str(path))
            import io
            scale = ocr.dpi / 72.0
            for k, i in enumerate(need):
                if progress is not None:
                    progress("ocr", (k + 0.2) / len(need), f"OCR {k + 1}/{len(need)} 페이지 렌더링 ({engine})")
                bitmap = pdf[i].render(scale=scale)
                buf = io.BytesIO()
                bitmap.to_pil().save(buf, format="PNG")
                if progress is not None:
                    progress("ocr", (k + 0.5) / len(need), f"OCR {k + 1}/{len(need)} 페이지 인식 중 ({engine})")
                pages[i] = ocr_png(buf.getvalue(), engine, ocr.languages)
            if progress is not None:
                progress("ocr", 1.0, f"OCR 완료 ({len(need)} 페이지)")
    if pdf is not None:
        pdf.close()

    text = "\n".join(pages)
    if not text.strip():
        hint = describe_ocr(ocr) if ocr is not None else "OCR 비활성 (config extract.ocr)"
        raise ExtractError(f"pdf 에서 텍스트를 추출하지 못했습니다 (스캔 이미지?). {hint}: {path.name}")
    return text


# ─────────────────────────── hwpx ───────────────────────────


def extract_hwpx(path: Path) -> str:
    try:
        zf = zipfile.ZipFile(str(path))
    except zipfile.BadZipFile as e:
        raise ExtractError(f"hwpx(zip) 형식이 아닙니다: {path.name}") from e
    with zf:
        names = sorted(
            (n for n in zf.namelist() if re.match(r"Contents/section\d+\.xml$", n)),
            key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[-1]).group(1)),
        )
        if not names:
            raise ExtractError(f"hwpx 에 Contents/section*.xml 이 없습니다: {path.name}")
        paras: list[str] = []
        for n in names:
            try:
                root = ET.fromstring(zf.read(n))
            except ET.ParseError as e:
                raise ExtractError(f"hwpx 섹션 XML 파싱 실패: {path.name}/{n}") from e
            for p in root.iter():
                if p.tag.endswith("}p") or p.tag == "p":
                    texts = [t.text or "" for t in p.iter() if (t.tag.endswith("}t") or t.tag == "t")]
                    paras.append("".join(texts))
    return "\n".join(paras)


# ─────────────────────────── hwp (5.0, OLE) ───────────────────────────

_HWPTAG_PARA_TEXT = 0x010 + 51          # 67
# 인라인/확장 컨트롤 문자: 뒤따르는 7개 wchar(14바이트)를 함께 건너뛴다
_CTRL_EXTENDED = {1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}


def _iter_records(data: bytes):
    pos, n = 0, len(data)
    while pos + 4 <= n:
        (hdr,) = struct.unpack_from("<I", data, pos)
        pos += 4
        tag = hdr & 0x3FF
        size = (hdr >> 20) & 0xFFF
        if size == 0xFFF:
            (size,) = struct.unpack_from("<I", data, pos)
            pos += 4
        yield tag, data[pos:pos + size]
        pos += size


def parse_hwp_section(data: bytes) -> list[str]:
    """압축 해제된 BodyText/Section 스트림 → 문단 텍스트 목록."""
    paras: list[str] = []
    for tag, payload in _iter_records(data):
        if tag != _HWPTAG_PARA_TEXT:
            continue
        out: list[str] = []
        i, n = 0, len(payload) - 1
        while i < n:
            code = payload[i] | (payload[i + 1] << 8)
            if code in _CTRL_EXTENDED:
                i += 16
                continue
            if code < 32:
                if code in (9,):
                    out.append(" ")
                elif code in (10, 13):
                    out.append("\n")
                i += 2
                continue
            i += 2
            # 서로게이트 쌍 처리
            if 0xD800 <= code <= 0xDBFF and i + 1 < len(payload):
                low = payload[i] | (payload[i + 1] << 8)
                if 0xDC00 <= low <= 0xDFFF:
                    out.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
                    i += 2
                    continue
            out.append(chr(code))
        paras.append("".join(out))
    return paras


def extract_hwp(path: Path) -> str:
    _need("olefile", "olefile")
    import olefile

    if not olefile.isOleFile(str(path)):
        raise ExtractError(f"hwp(OLE) 형식이 아닙니다 (hwp 3.0 이하 또는 손상): {path.name}")
    with olefile.OleFileIO(str(path)) as ole:
        if not ole.exists("FileHeader"):
            raise ExtractError(f"hwp FileHeader 가 없습니다: {path.name}")
        header = ole.openstream("FileHeader").read()
        if not header.startswith(b"HWP Document File"):
            raise ExtractError(f"hwp 시그니처 불일치: {path.name}")
        flags = struct.unpack_from("<I", header, 36)[0]
        compressed = bool(flags & 0x1)
        if flags & 0x2:
            raise ExtractError(f"암호화된 hwp: {path.name}")
        if flags & 0x4:
            raise ExtractError(f"배포용(DRM) hwp 는 지원하지 않습니다: {path.name}")
        sections = sorted(
            (e for e in ole.listdir() if len(e) == 2 and e[0] == "BodyText" and e[1].startswith("Section")),
            key=lambda e: int(re.sub(r"\D", "", e[1]) or 0),
        )
        if not sections:
            raise ExtractError(f"hwp BodyText 섹션이 없습니다: {path.name}")
        paras: list[str] = []
        for e in sections:
            raw = ole.openstream("/".join(e)).read()
            if compressed:
                try:
                    raw = zlib.decompress(raw, -15)
                except zlib.error as ex:
                    raise ExtractError(f"hwp 섹션 압축 해제 실패: {path.name}/{e[1]}") from ex
            paras.extend(parse_hwp_section(raw))
    return "\n".join(paras)
