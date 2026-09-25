"""서식(boilerplate) 청크 판정 — 서식 중심 벡터 집합과의 최대 코사인이 threshold 이상이면 서식."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from docsim.core.errors import ConfigError


def load_centroids(path: str | Path | None) -> np.ndarray:
    if path is None:
        raise ConfigError("embed.boilerplate.enabled=true 이지만 centroid_path 가 없습니다")
    p = Path(path)
    if not p.is_file():
        raise ConfigError(f"서식 중심 벡터 파일이 없습니다: {p}")
    c = np.load(p).astype(np.float32)
    if c.ndim == 1:
        c = c[None, :]
    norms = np.linalg.norm(c, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return c / norms


def mark_boilerplate(vecs: np.ndarray, centroids: np.ndarray | None, threshold: float) -> np.ndarray:
    """(n, dim) L2 정규화 벡터 → (n,) bool. centroids 가 None 이면 전부 False."""
    n = vecs.shape[0]
    if centroids is None or n == 0:
        return np.zeros(n, dtype=bool)
    sims = vecs @ centroids.T            # (n, m)
    return sims.max(axis=1) >= threshold
