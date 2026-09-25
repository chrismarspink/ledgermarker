"""엔진 B — 청킹 → 인코딩 → 중심화 → 이진화 (+int8 재정렬용 양자화).

기동 시: SBERT 검증(R4) → max_seq_length 실측(R5) → chunk_tokens 검증(R5) → mu 적재(R6).
어느 하나라도 실패하면 예외로 기동을 거부한다. 이 모듈은 다른 엔진을 참조하지 않는다 (R2).
"""

from __future__ import annotations

import logging

import numpy as np

from docsim.core.config import Config
from docsim.core.errors import ConfigError
from docsim.core.schema import ChunkFingerprint, EmbedFingerprint
from docsim.engines.embed.boilerplate import load_centroids, mark_boilerplate
from docsim.engines.embed.centering import load_mu
from docsim.engines.embed.chunk import chunk
from docsim.engines.embed.model import LoadedModel, load_model

log = logging.getLogger("docsim.embed")


def binarize(vecs: np.ndarray, mu: np.ndarray) -> np.ndarray:
    """★ R6 — mu 를 빼고 부호를 취한다. (n, dim) → (n, dim/8) uint8"""
    if vecs.shape[-1] != mu.shape[-1]:
        raise ConfigError(f"벡터 차원 {vecs.shape[-1]} 과 mu 차원 {mu.shape[-1]} 불일치")
    if vecs.shape[-1] % 8 != 0:
        raise ConfigError(f"차원 {vecs.shape[-1]} 이 8의 배수가 아닙니다")
    return np.packbits((vecs - mu) > 0, axis=-1)


def quantize_int8(vecs: np.ndarray) -> np.ndarray:
    """L2 정규화 벡터 [-1,1] → int8 (×127). 재정렬용."""
    return np.clip(np.round(vecs * 127.0), -127, 127).astype(np.int8)


def dequantize_int8(q: np.ndarray) -> np.ndarray:
    v = q.astype(np.float32) / 127.0
    norms = np.linalg.norm(v, axis=-1, keepdims=True)
    norms[norms == 0] = 1.0
    return v / norms


class EmbedEngine:
    """기동(생성자)에서 모든 게이트를 통과해야 한다."""

    name = "embed"

    def __init__(self, cfg: Config, lm: LoadedModel | None = None):
        self.cfg = cfg
        self.model_id = str(cfg.get("embed.model_id"))
        self.chunk_tokens = int(cfg.get("embed.chunk_tokens"))
        self.overlap_ratio = float(cfg.get("embed.overlap_ratio"))
        self.store_int8 = bool(cfg.get("embed.quant.store_int8"))
        self.lm = lm if lm is not None else load_model(self.model_id, float(cfg.get("embed.sbert_gate_margin")), torch_threads=int(cfg.get("embed.torch_threads")), device=str(cfg.get("embed.device")))
        log.info("embed: model=%s dim=%d max_seq_length=%d (실측)", self.model_id, self.lm.dim, self.lm.max_seq_length)
        if self.chunk_tokens > self.lm.max_seq_length:
            raise ConfigError(                        # ★ R5
                f"chunk_tokens({self.chunk_tokens}) > model max_seq_length({self.lm.max_seq_length}). "
                f"초과분은 경고 없이 잘립니다."
            )
        # ★ R6 — mu 없으면 기동 거부
        self.mu, self.mu_meta = load_mu(cfg.resolve_path("embed.mu_path"), expect_model_id=self.model_id, expect_dim=self.lm.dim)
        self.mu_version = str(self.mu_meta["mu_version"])
        self.centroids = None
        self.bp_threshold = float(cfg.get("embed.boilerplate.threshold"))
        if bool(cfg.get("embed.boilerplate.enabled")):
            self.centroids = load_centroids(cfg.resolve_path("embed.boilerplate.centroid_path"))

    def chunk_text(self, norm_text: str):
        return chunk(norm_text, self.chunk_tokens, self.overlap_ratio, self.lm.count_tokens, self.lm.max_seq_length,
                     count_tokens_batch=getattr(self.lm, "count_tokens_batch", None))

    def encode_chunks(self, norm_text: str, progress=None, batch_size: int = 32) -> tuple[list, np.ndarray]:
        """progress(done, total) 콜백이 있으면 배치마다 호출한다."""
        chunks = self.chunk_text(norm_text)
        texts = [c.text for c in chunks]
        if progress is None or len(texts) <= batch_size:
            vecs = self.lm.encode(texts, batch_size=batch_size)
            if progress is not None:
                progress(len(texts), len(texts))
            return chunks, vecs
        parts = []
        for i in range(0, len(texts), batch_size):
            parts.append(self.lm.encode(texts[i:i + batch_size], batch_size=batch_size))
            progress(min(i + batch_size, len(texts)), len(texts))
        return chunks, np.concatenate(parts, axis=0)

    def fingerprint(self, norm_text: str, progress=None, batch_size: int = 32) -> EmbedFingerprint:
        chunks, vecs = self.encode_chunks(norm_text, progress, batch_size)
        bits = binarize(vecs, self.mu)
        q = quantize_int8(vecs) if self.store_int8 else None
        bp = mark_boilerplate(vecs, self.centroids, self.bp_threshold)
        out = []
        for i, c in enumerate(chunks):
            out.append(ChunkFingerprint(
                index=i,
                binary=bits[i].tobytes(),
                int8=(q[i].tobytes() if q is not None else None),
                token_count=c.token_count,
                is_boilerplate=bool(bp[i]),
            ))
        return EmbedFingerprint(
            chunks=out, model_id=self.model_id, dim=self.lm.dim,
            mu_version=self.mu_version, max_seq_length=self.lm.max_seq_length,
        )
