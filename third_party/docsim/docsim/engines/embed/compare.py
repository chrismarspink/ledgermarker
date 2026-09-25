"""엔진 B 비교 — 해밍 전수 → 추정 코사인 → (선택) int8 재정렬 → ★ max 집계 (R7).

문서 평균 벡터를 만들지 않는다. 청크쌍의 최대 코사인만 문서 점수로 쓴다.
"""

from __future__ import annotations

import math

import numpy as np

from docsim.core.config import Config
from docsim.core.errors import VersionMismatchError
from docsim.core.schema import ChunkPair, EmbedFingerprint, EmbedResult
from docsim.engines.embed.fingerprint import dequantize_int8

POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)

HAMMING_ONLY_WARNING = "embed 코사인은 해밍 추정치 (int8 미저장 또는 재정렬 비활성)"
NO_CHUNKS_WARNING = "embed: 비교할 청크가 없음 (서식 제외 후 0개)"


def hamming_matrix(a_bits: np.ndarray, b_bits: np.ndarray) -> np.ndarray:
    """(na, nbytes) × (nb, nbytes) uint8 → (na, nb) 해밍 거리 (XOR + popcount 룩업)."""
    if a_bits.shape[0] == 0 or b_bits.shape[0] == 0:
        return np.zeros((a_bits.shape[0], b_bits.shape[0]), dtype=np.int32)
    x = np.bitwise_xor(a_bits[:, None, :], b_bits[None, :, :])
    return POPCOUNT[x].sum(axis=-1, dtype=np.int32)


def hamming_to_cosine(h: np.ndarray, dim: int) -> np.ndarray:
    """cos ≈ cos(pi * hamming / dim)"""
    return np.cos(np.pi * h.astype(np.float64) / dim)


def _stack_bits(fp: EmbedFingerprint, keep: list[int]) -> np.ndarray:
    return np.stack([np.frombuffer(fp.chunks[i].binary, dtype=np.uint8) for i in keep]) if keep else np.zeros((0, fp.dim // 8), np.uint8)


def compare(a: EmbedFingerprint, b: EmbedFingerprint, cfg: Config, warnings: list[str]) -> EmbedResult:
    """
    1. is_boilerplate 청크 제외
    2. 전 쌍 해밍 거리
    3. 해밍 → 추정 코사인
    4. 상위 topk 쌍만 int8 로 재정렬 (rerank=True 이고 int8 이 저장된 경우)
    5. ★ R7 — max 집계. 평균 내지 않는다
    """
    if a.model_id != b.model_id or a.mu_version != b.mu_version or a.dim != b.dim:
        raise VersionMismatchError("embed 지문 파라미터 불일치 (model_id/mu_version/dim)")
    topk = int(cfg.get("embed.rerank.topk"))
    rerank = bool(cfg.get("embed.rerank.enabled"))
    n_top_pairs = int(cfg.get("embed.top_pairs"))

    keep_a = [c.index for c in a.chunks if not c.is_boilerplate]
    keep_b = [c.index for c in b.chunks if not c.is_boilerplate]
    excluded = (len(a.chunks) - len(keep_a)) + (len(b.chunks) - len(keep_b))
    if not keep_a or not keep_b:
        warnings.append(NO_CHUNKS_WARNING)
        return EmbedResult(max_cosine=0.0, top_pairs=[], chunks_compared=0, boilerplate_excluded=excluded)

    ham = hamming_matrix(_stack_bits(a, keep_a), _stack_bits(b, keep_b))       # (na, nb)
    est = hamming_to_cosine(ham, a.dim)
    n_pairs = est.size
    flat_order = np.argsort(-est, axis=None, kind="stable")
    k = min(topk, n_pairs)
    cand = flat_order[:k]
    ai, bi = np.unravel_index(cand, est.shape)

    have_int8 = all(a.chunks[i].int8 is not None for i in keep_a) and all(b.chunks[i].int8 is not None for i in keep_b)
    if rerank and have_int8:
        va = dequantize_int8(np.stack([np.frombuffer(a.chunks[keep_a[i]].int8, dtype=np.int8) for i in ai]))
        vb = dequantize_int8(np.stack([np.frombuffer(b.chunks[keep_b[j]].int8, dtype=np.int8) for j in bi]))
        cos = np.einsum("ij,ij->i", va, vb).astype(np.float64)
    else:
        warnings.append(HAMMING_ONLY_WARNING)
        cos = est[ai, bi]

    order = np.argsort(-cos, kind="stable")
    pairs = [
        ChunkPair(a_index=keep_a[int(ai[o])], b_index=keep_b[int(bi[o])], cosine=float(cos[o]), hamming=int(ham[ai[o], bi[o]]))
        for o in order[:n_top_pairs]
    ]
    max_cos = float(cos[order[0]]) if len(order) else 0.0      # ★ R7 max 집계
    if not math.isfinite(max_cos):
        max_cos = 0.0
    return EmbedResult(max_cosine=max_cos, top_pairs=pairs, chunks_compared=n_pairs, boilerplate_excluded=excluded)
