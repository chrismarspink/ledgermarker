"""문서빈도(DF) 테이블 — 코퍼스에서 cutoff×N 문서 이상에 나타나는 슁글 해시. 공문 서식 억제용.

파일 형식(.bin): 4바이트 헤더 길이(uint32 LE) + JSON 헤더 + uint32 LE 해시 배열(정렬).
"""

from __future__ import annotations

import hashlib
import json
import struct
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np

from docsim.core.errors import ConfigError, SchemaError, VersionMismatchError
from docsim.engines.shingle.fingerprint import make_shingles

_MAGIC = b"DSDF"


@dataclass
class DFTable:
    hashes: set[int]
    df_version: str
    n_docs: int
    cutoff: float
    k: int
    key_id: str
    created_at: str

    def check_compatible(self, k: int, key_id: str) -> None:
        if self.k != k:
            raise VersionMismatchError(f"DF 테이블 k={self.k} 와 config shingle.k={k} 불일치")
        if self.key_id != key_id:
            raise VersionMismatchError(f"DF 테이블 key_id={self.key_id} 와 config hmac_key_id={key_id} 불일치")

    def save(self, path: str | Path) -> None:
        arr = np.array(sorted(self.hashes), dtype="<u4")
        header = json.dumps({
            "df_version": self.df_version, "n_docs": self.n_docs, "cutoff": self.cutoff,
            "k": self.k, "key_id": self.key_id, "created_at": self.created_at, "n_hashes": int(arr.size),
        }).encode("utf-8")
        with open(path, "wb") as f:
            f.write(_MAGIC)
            f.write(struct.pack("<I", len(header)))
            f.write(header)
            f.write(arr.tobytes())

    @classmethod
    def load(cls, path: str | Path) -> "DFTable":
        with open(path, "rb") as f:
            if f.read(4) != _MAGIC:
                raise SchemaError(f"DF 테이블 형식이 아닙니다: {path}")
            (hlen,) = struct.unpack("<I", f.read(4))
            header = json.loads(f.read(hlen).decode("utf-8"))
            arr = np.frombuffer(f.read(), dtype="<u4")
        if arr.size != header["n_hashes"]:
            raise SchemaError(f"DF 테이블 손상: 해시 수 {arr.size} != 헤더 {header['n_hashes']}")
        return cls(
            hashes=set(int(x) for x in arr), df_version=header["df_version"], n_docs=int(header["n_docs"]),
            cutoff=float(header["cutoff"]), k=int(header["k"]), key_id=header["key_id"], created_at=header["created_at"],
        )


def build_df(norm_texts: Iterable[str], k: int, key: bytes, key_id: str, cutoff: float) -> DFTable:
    """정규화 텍스트 반복자 → DF 테이블. 원문은 보관하지 않고 슁글 해시 빈도만 센다."""
    if not (0.0 < cutoff <= 1.0):
        raise ConfigError(f"df.cutoff 는 (0, 1] 이어야 합니다: {cutoff}")
    counter: Counter[int] = Counter()
    n = 0
    for t in norm_texts:
        n += 1
        counter.update(make_shingles(t, k, key))
    if n == 0:
        raise ConfigError("DF 테이블을 만들 코퍼스가 비어 있습니다")
    threshold = cutoff * n
    hashes = {h for h, c in counter.items() if c > threshold}
    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    digest = hashlib.sha256(np.array(sorted(hashes), dtype="<u4").tobytes()).hexdigest()[:12]
    df_version = f"df-{n}docs-c{cutoff:g}-{digest}"
    return DFTable(hashes=hashes, df_version=df_version, n_docs=n, cutoff=cutoff, k=k, key_id=key_id, created_at=created)
