"""엔진 A — 문자 k-gram → HMAC → MinHash.

이 모듈은 다른 엔진을 참조하지 않는다 (R2). 입력은 core.normalize 의 출력이다 (R1).
"""

from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

import numpy as np

from docsim.core.config import Config
from docsim.core.errors import ConfigError, KeyMissingError
from docsim.core.schema import ShingleFingerprint

KEY_ENV = "DOCSIM_HMAC_KEY"

# 범용 해싱용 메르센 소수. 상수가 아니라 알고리즘 정의의 일부다.
_MERSENNE_P = (1 << 61) - 1
_U32 = (1 << 32)


def load_key(cfg: Config) -> bytes:
    """HMAC 키: 환경변수 DOCSIM_HMAC_KEY > config.shingle.hmac_key_file. 없으면 에러 (조용한 기본키 없음)."""
    env = os.environ.get(KEY_ENV)
    if env:
        return env.encode("utf-8")
    key_file = cfg.resolve_path("shingle.hmac_key_file")
    if key_file is not None:
        if not key_file.is_file():
            raise KeyMissingError(f"shingle.hmac_key_file 이 없습니다: {key_file}")
        data = Path(key_file).read_bytes().strip()
        if not data:
            raise KeyMissingError(f"키 파일이 비어 있습니다: {key_file}")
        return data
    raise KeyMissingError(
        f"HMAC 키가 없습니다. {KEY_ENV} 환경변수를 설정하거나 config.shingle.hmac_key_file 을 지정하십시오."
    )


def make_shingles(norm_text: str, k: int, key: bytes) -> set[int]:
    """문자 k-gram → HMAC-SHA256(key, shingle)[:4] → uint32 집합.

    텍스트 길이가 k 미만이면 텍스트 전체를 하나의 슁글로 본다 (빈 집합을 만들지 않는다).
    """
    if k < 1:
        raise ConfigError(f"shingle.k 는 1 이상이어야 합니다: {k}")
    n = len(norm_text)
    if n == 0:
        return set()
    grams = [norm_text] if n < k else (norm_text[i:i + k] for i in range(n - k + 1))
    out: set[int] = set()
    digest_size = 4
    for g in grams:
        d = hmac.new(key, g.encode("utf-8"), hashlib.sha256).digest()[:digest_size]
        out.add(int.from_bytes(d, "big"))
    return out


def _perm_params(perms: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """a_i ∈ [1, 2^32), b_i ∈ [0, 2^32). seed 로 결정론적 생성 — 저장하지 않고 매번 재생성한다.

    a, b 를 32비트로 제한하면 a*x + b < 2^64 이므로 uint64 안에서 오버플로 없이 계산된다.
    """
    rng = np.random.default_rng(seed)
    a = rng.integers(1, _U32, size=perms, dtype=np.uint64)
    b = rng.integers(0, _U32, size=perms, dtype=np.uint64)
    return a, b


def minhash(shingles: set[int], perms: int, seed: int) -> list[int]:
    """범용 해싱 h_i(x) = ((a_i*x + b_i) mod P) mod 2^32, P = 2^61-1."""
    if perms < 1:
        raise ConfigError(f"minhash.perms 는 1 이상이어야 합니다: {perms}")
    if not shingles:
        return [_U32 - 1] * perms
    x = np.fromiter(shingles, dtype=np.uint64, count=len(shingles))
    a, b = _perm_params(perms, seed)
    out = np.empty(perms, dtype=np.uint64)
    P = np.uint64(_MERSENNE_P)
    mask32 = np.uint64(_U32 - 1)
    for i in range(perms):
        h = (a[i] * x + b[i]) % P
        h &= mask32
        out[i] = h.min()
    return [int(v) for v in out]


def build_shingle_fingerprint(norm_text: str, cfg: Config, key: bytes, df_table=None) -> ShingleFingerprint:
    """정규화 텍스트 → ShingleFingerprint. df_table 이 주어지면 고빈도 슁글을 제외한다."""
    k = int(cfg.get("shingle.k"))
    perms = int(cfg.get("shingle.minhash.perms"))
    seed = int(cfg.get("shingle.minhash.seed"))
    key_id = str(cfg.get("shingle.hmac_key_id"))
    shingles = make_shingles(norm_text, k, key)
    df_version = None
    if df_table is not None:
        df_table.check_compatible(k=k, key_id=key_id)
        shingles = shingles - df_table.hashes
        df_version = df_table.df_version
    return ShingleFingerprint(
        minhash=minhash(shingles, perms, seed),
        shingle_count=len(shingles),      # ★ R3
        k=k,
        key_id=key_id,
        df_version=df_version,
        seed=seed,
    )
