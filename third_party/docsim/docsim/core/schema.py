"""지문(Fingerprint) 스키마 + 직렬화 + 검증. 파일에 저장되는 유일한 산출물. 원문은 여기에 없다 (R10).

직렬화: JSON, 바이너리 필드는 base64. 파일명 {doc_id}.fp.json
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from docsim.core.errors import SchemaError, VersionMismatchError

SCHEMA_VERSION = 1


# ─────────────────────────── 지문 ───────────────────────────


@dataclass(frozen=True)
class ShingleFingerprint:
    minhash: list[int]          # uint32 × N (config: minhash.perms)
    shingle_count: int          # ★ R3 — 생략 금지
    k: int                      # 사용된 k-gram 크기
    key_id: str                 # HMAC 키 식별자
    df_version: str | None      # DF 컷오프 적용 시
    seed: int                   # MinHash 순열 seed (다르면 비교 불가)


@dataclass(frozen=True)
class ChunkFingerprint:
    index: int
    binary: bytes               # packbits, dim/8 바이트 (768d → 96B)
    int8: bytes | None          # 재정렬용, 저장 정책에 따라 생략 가능
    token_count: int
    is_boilerplate: bool


@dataclass(frozen=True)
class EmbedFingerprint:
    chunks: list[ChunkFingerprint]
    model_id: str
    dim: int
    mu_version: str             # ★ R6
    max_seq_length: int         # ★ R5 — 실측값 기록


@dataclass(frozen=True)
class Fingerprint:
    doc_id: str
    schema_version: int         # 현재 1
    norm_version: str           # ★ R1/R9
    created_at: str             # ISO8601
    hash_norm: str              # sha256 of normalized text — 동일성 판정용
    norm_len: int
    shingle: ShingleFingerprint | None
    embed: EmbedFingerprint | None


# ─────────────────────────── 비교 결과 ───────────────────────────


@dataclass
class ShingleResult:
    jaccard: float              # MinHash 추정치
    jaccard_stderr: float       # 1/sqrt(perms)
    containment_a_in_b: float   # A ⊆ B
    containment_b_in_a: float   # B ⊆ A
    estimated_intersection: int


@dataclass
class ChunkPair:
    a_index: int
    b_index: int
    cosine: float
    hamming: int


@dataclass
class EmbedResult:
    max_cosine: float           # ★ R7 — max 집계
    top_pairs: list[ChunkPair]  # 상위 N쌍, 설명용
    chunks_compared: int
    boilerplate_excluded: int


@dataclass
class CompareResult:
    doc_a: str
    doc_b: str
    identical: bool             # hash_norm 일치
    shingle: ShingleResult | None
    embed: EmbedResult | None
    warnings: list[str] = field(default_factory=list)
    # ※ overall_score 를 만들지 않는다. 두 엔진을 하나의 숫자로 합치지 않는다.


# ─────────────────────────── 직렬화 ───────────────────────────


def _b64(b: bytes | None) -> str | None:
    return None if b is None else base64.b64encode(b).decode("ascii")


def _unb64(s: str | None) -> bytes | None:
    return None if s is None else base64.b64decode(s)


def fingerprint_to_dict(fp: Fingerprint) -> dict[str, Any]:
    d: dict[str, Any] = {
        "doc_id": fp.doc_id,
        "schema_version": fp.schema_version,
        "norm_version": fp.norm_version,
        "created_at": fp.created_at,
        "hash_norm": fp.hash_norm,
        "norm_len": fp.norm_len,
        "shingle": None,
        "embed": None,
    }
    if fp.shingle is not None:
        s = fp.shingle
        d["shingle"] = {
            "minhash": list(int(x) for x in s.minhash),
            "shingle_count": int(s.shingle_count),
            "k": int(s.k),
            "key_id": s.key_id,
            "df_version": s.df_version,
            "seed": int(s.seed),
        }
    if fp.embed is not None:
        e = fp.embed
        d["embed"] = {
            "model_id": e.model_id,
            "dim": int(e.dim),
            "mu_version": e.mu_version,
            "max_seq_length": int(e.max_seq_length),
            "chunks": [
                {
                    "index": int(c.index),
                    "binary": _b64(c.binary),
                    "int8": _b64(c.int8),
                    "token_count": int(c.token_count),
                    "is_boilerplate": bool(c.is_boilerplate),
                }
                for c in e.chunks
            ],
        }
    return d


def _require(d: dict[str, Any], key: str, where: str) -> Any:
    if key not in d:
        raise SchemaError(f"{where}: 필수 필드 '{key}' 누락")
    return d[key]


def fingerprint_from_dict(d: dict[str, Any]) -> Fingerprint:
    where = "Fingerprint"
    sv = _require(d, "schema_version", where)
    if sv != SCHEMA_VERSION:
        raise VersionMismatchError(f"schema_version {sv} 는 지원하지 않습니다 (현재 {SCHEMA_VERSION})")
    shingle = None
    if d.get("shingle") is not None:
        s = d["shingle"]
        w = "ShingleFingerprint"
        if s.get("shingle_count") is None:
            raise SchemaError(f"{w}: 'shingle_count' 는 필수입니다 (R3)")
        shingle = ShingleFingerprint(
            minhash=[int(x) for x in _require(s, "minhash", w)],
            shingle_count=int(s["shingle_count"]),
            k=int(_require(s, "k", w)),
            key_id=str(_require(s, "key_id", w)),
            df_version=s.get("df_version"),
            seed=int(_require(s, "seed", w)),
        )
    embed = None
    if d.get("embed") is not None:
        e = d["embed"]
        w = "EmbedFingerprint"
        chunks = []
        for c in _require(e, "chunks", w):
            chunks.append(
                ChunkFingerprint(
                    index=int(_require(c, "index", "ChunkFingerprint")),
                    binary=_unb64(_require(c, "binary", "ChunkFingerprint")),
                    int8=_unb64(c.get("int8")),
                    token_count=int(_require(c, "token_count", "ChunkFingerprint")),
                    is_boilerplate=bool(_require(c, "is_boilerplate", "ChunkFingerprint")),
                )
            )
        embed = EmbedFingerprint(
            chunks=chunks,
            model_id=str(_require(e, "model_id", w)),
            dim=int(_require(e, "dim", w)),
            mu_version=str(_require(e, "mu_version", w)),
            max_seq_length=int(_require(e, "max_seq_length", w)),
        )
    return Fingerprint(
        doc_id=str(_require(d, "doc_id", where)),
        schema_version=int(sv),
        norm_version=str(_require(d, "norm_version", where)),
        created_at=str(_require(d, "created_at", where)),
        hash_norm=str(_require(d, "hash_norm", where)),
        norm_len=int(_require(d, "norm_len", where)),
        shingle=shingle,
        embed=embed,
    )


def save_fingerprint(fp: Fingerprint, path: str | Path) -> None:
    Path(path).write_text(json.dumps(fingerprint_to_dict(fp), ensure_ascii=False), encoding="utf-8")


def load_fingerprint(path: str | Path) -> Fingerprint:
    with open(path, "r", encoding="utf-8") as f:
        return fingerprint_from_dict(json.load(f))


# ─────────────────────────── 버전 검증 (R9) ───────────────────────────


def check_compatible(a: Fingerprint, b: Fingerprint) -> None:
    """비교 가능한 지문 쌍인지 검증. 하나라도 다르면 에러. 추정해서 계산하지 않는다."""
    if a.schema_version != b.schema_version:
        raise VersionMismatchError(f"schema_version 불일치: {a.schema_version} vs {b.schema_version}")
    if a.norm_version != b.norm_version:
        raise VersionMismatchError(f"norm_version 불일치: {a.norm_version} vs {b.norm_version}")
    if a.shingle is not None and b.shingle is not None:
        sa, sb = a.shingle, b.shingle
        if sa.k != sb.k:
            raise VersionMismatchError(f"shingle.k 불일치: {sa.k} vs {sb.k}")
        if len(sa.minhash) != len(sb.minhash):
            raise VersionMismatchError(f"minhash perms 불일치: {len(sa.minhash)} vs {len(sb.minhash)}")
        if sa.seed != sb.seed:
            raise VersionMismatchError(f"minhash seed 불일치: {sa.seed} vs {sb.seed}")
        if sa.key_id != sb.key_id:
            raise VersionMismatchError(f"hmac key_id 불일치: {sa.key_id} vs {sb.key_id}")
        if sa.df_version != sb.df_version:
            raise VersionMismatchError(f"df_version 불일치: {sa.df_version} vs {sb.df_version}")
    if a.embed is not None and b.embed is not None:
        ea, eb = a.embed, b.embed
        if ea.model_id != eb.model_id:
            raise VersionMismatchError(f"model_id 불일치: {ea.model_id} vs {eb.model_id}")
        if ea.mu_version != eb.mu_version:
            raise VersionMismatchError(f"mu_version 불일치: {ea.mu_version} vs {eb.mu_version}")
        if ea.dim != eb.dim:
            raise VersionMismatchError(f"dim 불일치: {ea.dim} vs {eb.dim}")
