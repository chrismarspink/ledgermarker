"""중심화 벡터 mu 산출/적재 (R6). mu.npy + mu.meta.json"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from docsim.core.errors import ConfigError, MuMissingError, SchemaError, VersionMismatchError


def meta_path_for(mu_path: str | Path) -> Path:
    p = Path(mu_path)
    return p.with_name(p.stem + ".meta.json")


def compute_mu(vecs: np.ndarray, min_reject: int, min_warn: int, warnings: list[str]) -> np.ndarray:
    """L2 정규화된 청크 벡터 (n, dim) → 차원별 평균. 표본 부족 시 거부/경고.

    ※ 이것은 코퍼스 전체의 중심이며 문서 평균 벡터가 아니다 (R7 과 무관).
    """
    n = int(vecs.shape[0])
    if n < min_reject:
        raise ConfigError(f"mu 표본 부족: 청크 {n}개 < 최소 {min_reject}개. 코퍼스를 늘리십시오.")
    if n < min_warn:
        warnings.append(f"mu 표본이 적습니다: 청크 {n}개 < 권장 {min_warn}개")
    return vecs.astype(np.float64).mean(axis=0).astype(np.float32)


def save_mu(mu_path: str | Path, mu: np.ndarray, model_id: str, n_chunks: int, n_docs: int) -> dict[str, Any]:
    mu = np.asarray(mu, dtype=np.float32)
    digest = hashlib.sha256(mu.tobytes()).hexdigest()[:12]
    meta = {
        "mu_version": f"mu-{digest}",
        "model_id": model_id,
        "dim": int(mu.shape[0]),
        "n_chunks": int(n_chunks),
        "n_docs": int(n_docs),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    np.save(mu_path, mu)
    meta_path_for(mu_path).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def load_mu(mu_path: str | Path | None, expect_model_id: str | None = None, expect_dim: int | None = None
            ) -> tuple[np.ndarray, dict[str, Any]]:
    """mu 가 없으면 MuMissingError. 조용히 sign(x) 로 폴백하지 않는다 (R6)."""
    if mu_path is None:
        raise MuMissingError("config.embed.mu_path 가 비어 있습니다. `docsim build-mu` 로 생성하십시오 (R6).")
    p = Path(mu_path)
    if not p.is_file():
        raise MuMissingError(f"mu 파일이 없습니다: {p}. `docsim build-mu <corpus_dir> -o {p}` 로 생성하십시오 (R6).")
    mp = meta_path_for(p)
    if not mp.is_file():
        raise MuMissingError(f"mu 메타 파일이 없습니다: {mp} (mu_version 을 알 수 없어 기동 거부)")
    mu = np.load(p)
    meta = json.loads(mp.read_text(encoding="utf-8"))
    for k in ("mu_version", "model_id", "dim", "n_chunks"):
        if k not in meta:
            raise SchemaError(f"mu.meta.json 에 '{k}' 누락")
    if mu.ndim != 1 or mu.shape[0] != int(meta["dim"]):
        raise SchemaError(f"mu 형상 {mu.shape} 이 메타 dim={meta['dim']} 과 다릅니다")
    if expect_model_id is not None and meta["model_id"] != expect_model_id:
        raise VersionMismatchError(f"mu 는 model_id={meta['model_id']} 로 만들어졌으나 현재 모델은 {expect_model_id}")
    if expect_dim is not None and int(meta["dim"]) != expect_dim:
        raise VersionMismatchError(f"mu dim={meta['dim']} 이 모델 차원 {expect_dim} 과 다릅니다")
    return mu.astype(np.float32), meta


def bit_balance(vecs: np.ndarray, mu: np.ndarray, low: float, high: float) -> dict[str, Any]:
    """이진화 후 차원별 1-비율 분포. 포화 차원(<low 또는 >high) 비율이 크면 mu 가 잘못됐거나 코퍼스가 편향된 것."""
    bits = (vecs - mu) > 0
    ratio = bits.mean(axis=0)
    saturated = int(((ratio < low) | (ratio > high)).sum())
    return {
        "p5": float(np.percentile(ratio, 5)),
        "p50": float(np.percentile(ratio, 50)),
        "p95": float(np.percentile(ratio, 95)),
        "saturated": saturated,
        "dim": int(ratio.shape[0]),
        "saturated_ratio": saturated / ratio.shape[0],
    }
