"""이미지 → 텍스트 OCR. 스캔 PDF / 이미지 전용 PDF 폴백용.

백엔드 (config extract.ocr.engine):
  vision     macOS Vision 프레임워크 (오프라인, 한국어 지원, pyobjc-framework-Vision)
  tesseract  tesseract CLI (해당 언어 traineddata 가 설치돼 있어야 함)
  auto       vision → tesseract 순서로 사용 가능한 것
원문 이미지는 메모리에만 있고 디스크에 남기지 않는다 (R10). tesseract 는 임시 파일을 쓰고 즉시 삭제한다.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass

from docsim.core.errors import ExtractError

# BCP-47 (Vision) → tesseract 언어 코드
_TESS_LANG = {"ko-KR": "kor", "ko": "kor", "en-US": "eng", "en": "eng", "ja-JP": "jpn", "zh-Hans": "chi_sim", "zh-Hant": "chi_tra"}


@dataclass
class OcrSettings:
    enabled: bool
    engine: str            # auto | vision | tesseract | none
    dpi: int
    languages: list[str]
    min_chars_per_page: int


def vision_available() -> bool:
    if sys.platform != "darwin":
        return False
    try:
        import Vision  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def tesseract_available(languages: list[str]) -> bool:
    exe = shutil.which("tesseract")
    if not exe:
        return False
    try:
        out = subprocess.run([exe, "--list-langs"], capture_output=True, text=True, timeout=20).stdout
    except Exception:  # noqa: BLE001
        return False
    have = set(out.split()[1:]) if out else set()
    need = {_TESS_LANG.get(l, l) for l in languages}
    return need <= have


def pick_engine(settings: OcrSettings) -> str | None:
    if not settings.enabled or settings.engine == "none":
        return None
    if settings.engine == "vision":
        return "vision" if vision_available() else None
    if settings.engine == "tesseract":
        return "tesseract" if tesseract_available(settings.languages) else None
    if vision_available():
        return "vision"
    if tesseract_available(settings.languages):
        return "tesseract"
    return None


def _ocr_vision(png: bytes, languages: list[str]) -> str:
    import Vision
    from Foundation import NSData

    data = NSData.dataWithBytes_length_(png, len(png))
    handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setUsesLanguageCorrection_(True)
    try:
        req.setRecognitionLanguages_(languages)
    except Exception:  # noqa: BLE001
        pass
    ok, err = handler.performRequests_error_([req], None)
    if not ok:
        raise ExtractError(f"Vision OCR 실패: {err}")
    lines = []
    for obs in req.results() or []:
        cands = obs.topCandidates_(1)
        if not cands:
            continue
        bb = obs.boundingBox()
        # Vision 좌표계는 좌하단 원점 → 위에서 아래, 왼쪽에서 오른쪽 순서로 정렬
        lines.append((-round(bb.origin.y + bb.size.height, 2), bb.origin.x, cands[0].string()))
    lines.sort()
    return "\n".join(t for _, _, t in lines)


def _ocr_tesseract(png: bytes, languages: list[str]) -> str:
    exe = shutil.which("tesseract")
    langs = "+".join(dict.fromkeys(_TESS_LANG.get(l, l) for l in languages))
    fd, tmp = tempfile.mkstemp(suffix=".png", prefix="docsim-ocr-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(png)
        r = subprocess.run([exe, tmp, "stdout", "-l", langs, "--psm", "6"], capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise ExtractError(f"tesseract 실패 (code {r.returncode})")
        return r.stdout
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def ocr_png(png: bytes, engine: str, languages: list[str]) -> str:
    if engine == "vision":
        return _ocr_vision(png, languages)
    if engine == "tesseract":
        return _ocr_tesseract(png, languages)
    raise ExtractError(f"알 수 없는 OCR 엔진: {engine}")


def describe_ocr(settings: OcrSettings) -> str:
    eng = pick_engine(settings)
    if eng is None:
        why = "비활성" if not settings.enabled or settings.engine == "none" else "사용 가능한 백엔드 없음 (macOS Vision: pyobjc-framework-Vision / tesseract: 언어 데이터)"
        return f"OCR 없음 — {why}"
    return f"OCR {eng} (dpi={settings.dpi}, 언어={','.join(settings.languages)})"
