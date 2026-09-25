"""단일 정규화 경로 (R1). 두 엔진은 모두 이 함수의 출력을 입력으로 받는다.

로직을 바꾸면 NORM_VERSION 을 반드시 올린다 (R9). 이전 지문은 전부 무효가 된다.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

NORM_VERSION = "norm-1.0"

# 제로폭 문자: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM/ZWNBSP
_ZERO_WIDTH_RE = re.compile("[\u200b\u200c\u200d\ufeff]")
# 연속 공백/탭/개행(유니코드 공백 포함) → 단일 공백
_WS_RE = re.compile(r"\s+")


def _fullwidth_to_halfwidth(text: str) -> str:
    """전각 영숫자·기호(U+FF01~FF5E) → 반각. NFKC 가 대부분 처리하지만 명시적으로 보장한다."""
    out = []
    for ch in text:
        cp = ord(ch)
        if 0xFF01 <= cp <= 0xFF5E:
            out.append(chr(cp - 0xFEE0))
        else:
            out.append(ch)
    return "".join(out)


def normalize(text: str) -> str:
    """단일 정규화 경로 (R1).

    1. 유니코드 NFKC 정규화
    2. 제로폭 문자 제거 (U+200B~200D, U+FEFF)
    3. 전각 영숫자 → 반각
    4. 연속 공백/탭/개행 → 단일 공백
    5. 앞뒤 공백 제거
    ※ 소문자화 하지 않는다 (한국어에 무의미, 영문 고유명사 정보 손실)
    ※ 형태소 분석 하지 않는다 (의존성 금지)
    """
    text = unicodedata.normalize("NFKC", text)
    text = _ZERO_WIDTH_RE.sub("", text)
    text = _fullwidth_to_halfwidth(text)
    text = _WS_RE.sub(" ", text)
    return text.strip()


def hash_norm(norm_text: str) -> str:
    """정규화 텍스트의 sha256 hex — 동일성 판정용."""
    return hashlib.sha256(norm_text.encode("utf-8")).hexdigest()
