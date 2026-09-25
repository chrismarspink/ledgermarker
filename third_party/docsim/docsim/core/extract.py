"""파일 → 텍스트. txt/md/docx/pdf/hwpx/hwp. 스캔 PDF 는 OCR 폴백 (config extract.ocr).

추출 실패 시 빈 문자열을 반환하지 않고 ExtractError 를 낸다.
"""

from __future__ import annotations

from pathlib import Path

from docsim.core.errors import ExtractError
from docsim.core.ocr import OcrSettings

TEXT_SUFFIXES = {".txt", ".md", ".text", ".markdown"}
SUPPORTED_SUFFIXES = TEXT_SUFFIXES | {".docx", ".pdf", ".hwpx", ".hwp"}


def ocr_settings_from(cfg) -> OcrSettings | None:
    """config → OcrSettings. cfg 가 None 이면 OCR 비활성 (명시적으로 config 를 넘겨야 켜진다)."""
    if cfg is None:
        return None
    return OcrSettings(
        enabled=bool(cfg.get("extract.ocr.enabled")),
        engine=str(cfg.get("extract.ocr.engine")),
        dpi=int(cfg.get("extract.ocr.dpi")),
        languages=[str(x) for x in cfg.get("extract.ocr.languages")],
        min_chars_per_page=int(cfg.get("extract.ocr.min_chars_per_page")),
    )


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp949", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ExtractError(f"텍스트 인코딩을 판별할 수 없습니다: {path.name}")


def extract_text(path: str | Path, cfg=None, progress=None) -> str:
    """파일에서 원문 텍스트를 추출한다. 정규화는 하지 않는다 (core.normalize 가 담당)."""
    p = Path(path)
    if not p.is_file():
        raise ExtractError(f"파일이 없습니다: {p}")
    suffix = p.suffix.lower()
    if suffix in TEXT_SUFFIXES or suffix == "":
        text = _read_text_file(p)
    elif suffix == ".docx":
        from docsim.core import extract_formats
        text = extract_formats.extract_docx(p)
    elif suffix == ".pdf":
        from docsim.core import extract_formats
        text = extract_formats.extract_pdf(p, ocr_settings_from(cfg), progress)
    elif suffix == ".hwpx":
        from docsim.core import extract_formats
        text = extract_formats.extract_hwpx(p)
    elif suffix == ".hwp":
        from docsim.core import extract_formats
        text = extract_formats.extract_hwp(p)
    else:
        raise ExtractError(f"지원하지 않는 형식: {suffix} ({p.name}). 지원: {sorted(SUPPORTED_SUFFIXES)}")
    if not text.strip():
        raise ExtractError(f"추출된 텍스트가 비어 있습니다: {p.name}")
    return text
