"""문단/문장 → 토큰 예산 청크 + 오버랩.

입력은 core.normalize 출력이다 (R1). 정규화가 개행을 공백으로 접기 때문에 문단 경계(\\n\\n)는 남아 있지 않다.
따라서 문장 경계만으로 분해한다. 청크 토큰 수가 모델 max_seq_length 를 넘으면 에러다 (R5, 조용한 절단 금지).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from docsim.core.errors import ChunkTooLongError, ConfigError

# 문장 종결부호(. ! ? 。) 뒤 공백, 또는 닫는 괄호/따옴표 뒤 공백에서 분리
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?。])\s+|(?<=[.!?。][\"'”’)\]])\s+")


@dataclass(frozen=True)
class Chunk:
    text: str
    token_count: int    # 특수 토큰 포함, 모델에 들어가는 실제 길이


def split_sentences(norm_text: str) -> list[str]:
    parts = [p.strip() for p in _SENT_SPLIT_RE.split(norm_text)]
    return [p for p in parts if p]


def _split_long_sentence(sent: str, budget: int, count_tokens: Callable[[str], int]) -> list[str]:
    """예산을 넘는 문장을 단어 경계로 나눈다. 단어 하나가 예산을 넘으면 글자 단위로 나눈다."""
    words = sent.split(" ")
    pieces: list[str] = []
    cur: list[str] = []
    for w in words:
        cand = " ".join(cur + [w])
        if count_tokens(cand) <= budget:
            cur.append(w)
            continue
        if cur:
            pieces.append(" ".join(cur))
            cur = []
        if count_tokens(w) <= budget:
            cur = [w]
        else:
            # 공백 없는 초장문 토큰열: 글자 단위로 채운다
            buf = ""
            for ch in w:
                if count_tokens(buf + ch) <= budget:
                    buf += ch
                else:
                    if buf:
                        pieces.append(buf)
                    buf = ch
            if buf:
                cur = [buf]
    if cur:
        pieces.append(" ".join(cur))
    return pieces


def chunk(norm_text: str, max_tokens: int, overlap_ratio: float,
          count_tokens: Callable[[str], int], model_max_seq: int,
          count_tokens_batch: Callable[[list[str]], list[int]] | None = None) -> list[Chunk]:
    """
    1. 문장 단위로 분해
    2. 토큰 예산까지 탐욕적으로 채운다
    3. overlap_ratio 만큼 겹쳐 다음 청크 시작

    count_tokens 는 특수 토큰을 포함한 실제 입력 길이를 반환해야 한다.
    """
    if max_tokens > model_max_seq:
        raise ConfigError(                        # ★ R5 — 조용한 절단 금지
            f"chunk_tokens({max_tokens}) > model max_seq_length({model_max_seq}). "
            f"초과분은 경고 없이 잘립니다."
        )
    if max_tokens < 4:
        raise ConfigError(f"embed.chunk_tokens 가 너무 작습니다: {max_tokens}")
    if not (0.0 <= overlap_ratio < 1.0):
        raise ConfigError(f"embed.overlap_ratio 는 [0, 1) 이어야 합니다: {overlap_ratio}")
    if not norm_text:
        return []

    # 문장별 토큰 수 (문장 하나가 예산을 넘으면 쪼갠다). 배치 카운터가 있으면 한 번에 센다.
    sents = split_sentences(norm_text)
    counts = count_tokens_batch(sents) if count_tokens_batch is not None else [count_tokens(s) for s in sents]
    units: list[tuple[str, int]] = []
    for s, n in zip(sents, counts):
        if n <= max_tokens:
            units.append((s, n))
        else:
            for piece in _split_long_sentence(s, max_tokens, count_tokens):
                units.append((piece, count_tokens(piece)))

    # 특수 토큰은 청크당 한 번만 들어가므로 문장별 토큰 수 합은 과대추정 → 실제 길이로 최종 검증
    specials = count_tokens("")  # [CLS] [SEP]
    overlap_budget = int(max_tokens * overlap_ratio)
    chunks: list[Chunk] = []
    i = 0
    n_units = len(units)
    while i < n_units:
        j = i
        used = specials
        while j < n_units and used + (units[j][1] - specials) <= max_tokens:
            used += units[j][1] - specials
            j += 1
        if j == i:  # 방어: 단일 유닛이 예산 초과 (split 로직상 발생하지 않아야 함)
            j = i + 1
        text = " ".join(u[0] for u in units[i:j])
        actual = count_tokens(text)
        if actual > model_max_seq:
            raise ChunkTooLongError(
                f"청크 토큰 수 {actual} > max_seq_length {model_max_seq} (청크 #{len(chunks)}, 문장 {j - i}개). "
                f"조용히 자르지 않습니다 (R5)."
            )
        if actual > max_tokens:
            # 토크나이저 경계 효과로 예산을 살짝 넘긴 경우: 마지막 유닛을 빼서 재시도
            if j - i > 1:
                j -= 1
                text = " ".join(u[0] for u in units[i:j])
                actual = count_tokens(text)
            if actual > model_max_seq:
                raise ChunkTooLongError(f"청크 토큰 수 {actual} > max_seq_length {model_max_seq} (R5).")
        chunks.append(Chunk(text=text, token_count=actual))
        if j >= n_units:
            break
        # 오버랩: 끝에서부터 overlap_budget 토큰만큼 문장을 되감는다 (반드시 전진)
        back = j
        acc = 0
        while back - 1 > i and acc + (units[back - 1][1] - specials) <= overlap_budget:
            back -= 1
            acc += units[back][1] - specials
        i = max(back, i + 1)
    return chunks
