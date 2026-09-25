"""레지스트리 색인 — 엔진 A: LSH 밴딩, 엔진 B: 이진 해밍 전수 탐색 (ANN 라이브러리 없음).

두 엔진의 색인은 같은 파일에 나란히 저장되지만 서로 참조하지 않는다. 원문은 없다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from docsim.core.config import Config
from docsim.core.errors import ConfigError, SchemaError, VersionMismatchError
from docsim.core.schema import Fingerprint

INDEX_NPZ = "_index.npz"
INDEX_META = "_index.meta.json"

_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)
_BAND_MULT = np.uint64(0x9E3779B97F4A7C15)


def band_keys(minhash: np.ndarray, bands: int, rows: int) -> np.ndarray:
    """(N, perms) uint32 → (N, bands) uint64. 밴드 내 r개 값을 순서 의존적으로 접는다 (결정론)."""
    if minhash.shape[1] != bands * rows:
        raise ConfigError(f"registry.lsh.bands*rows={bands * rows} != minhash perms={minhash.shape[1]}")
    mh = minhash.astype(np.uint64).reshape(minhash.shape[0], bands, rows)
    key = np.full((minhash.shape[0], bands), 1469598103934665603, dtype=np.uint64)   # FNV offset
    with np.errstate(over="ignore"):
        for r in range(rows):
            key = (key ^ mh[:, :, r]) * _BAND_MULT
    return key


@dataclass
class ShingleHit:
    doc_idx: int
    jaccard: float
    containment_q_in_d: float
    containment_d_in_q: float
    lsh_candidate: bool


@dataclass
class EmbedHit:
    doc_idx: int
    max_cosine: float
    q_chunk: int
    d_chunk: int
    hamming: int


@dataclass
class RegistryIndex:
    meta: dict[str, Any]
    doc_ids: list[str]
    hash_norm: list[str]
    minhash: np.ndarray | None          # (N, perms) uint32
    shingle_count: np.ndarray | None    # (N,) int64
    chunk_bits: np.ndarray | None       # (M, dim/8) uint8
    chunk_doc: np.ndarray | None        # (M,) int32
    chunk_index: np.ndarray | None      # (M,) int32  문서 내 청크 번호
    chunk_int8: np.ndarray | None       # (M, dim) int8 또는 None
    _bands: np.ndarray | None = field(default=None, repr=False)

    # ───────── 생성/버전 ─────────

    @staticmethod
    def _sig(fp: Fingerprint) -> dict[str, Any]:
        sig: dict[str, Any] = {"schema_version": fp.schema_version, "norm_version": fp.norm_version}
        if fp.shingle is not None:
            s = fp.shingle
            sig["shingle"] = {"k": s.k, "perms": len(s.minhash), "seed": s.seed, "key_id": s.key_id, "df_version": s.df_version}
        else:
            sig["shingle"] = None
        if fp.embed is not None:
            e = fp.embed
            sig["embed"] = {"model_id": e.model_id, "dim": e.dim, "mu_version": e.mu_version}
        else:
            sig["embed"] = None
        return sig

    @classmethod
    def empty(cls) -> "RegistryIndex":
        return cls(meta={"n_docs": 0, "sig": None}, doc_ids=[], hash_norm=[], minhash=None, shingle_count=None,
                   chunk_bits=None, chunk_doc=None, chunk_index=None, chunk_int8=None)

    def check_sig(self, fp: Fingerprint) -> None:
        sig = self._sig(fp)
        if self.meta.get("sig") is None:
            self.meta["sig"] = sig
            return
        if self.meta["sig"] != sig:
            raise VersionMismatchError(
                f"레지스트리 버전과 지문 버전이 다릅니다 (R9). 레지스트리={self.meta['sig']} 지문={sig}. "
                f"재색인(reindex)하거나 같은 설정으로 지문을 만드십시오."
            )

    def add(self, fps: list[Fingerprint]) -> None:
        for fp in fps:
            self.check_sig(fp)
        existing = {d: i for i, d in enumerate(self.doc_ids)}
        dup = [fp.doc_id for fp in fps if fp.doc_id in existing]
        if dup:
            raise SchemaError(f"이미 색인된 doc_id: {dup[:5]}{'...' if len(dup) > 5 else ''} — 먼저 remove/reindex 하십시오")
        base = len(self.doc_ids)
        self.doc_ids.extend(fp.doc_id for fp in fps)
        self.hash_norm.extend(fp.hash_norm for fp in fps)
        if self.meta["sig"]["shingle"] is not None:
            mh = np.array([fp.shingle.minhash for fp in fps], dtype=np.uint32)
            sc = np.array([fp.shingle.shingle_count for fp in fps], dtype=np.int64)
            self.minhash = mh if self.minhash is None else np.concatenate([self.minhash, mh])
            self.shingle_count = sc if self.shingle_count is None else np.concatenate([self.shingle_count, sc])
            self._bands = None
        if self.meta["sig"]["embed"] is not None:
            bits, docs, idxs, q = [], [], [], []
            want_int8 = self.chunk_int8 is not None or self.chunk_bits is None
            for i, fp in enumerate(fps):
                for c in fp.embed.chunks:
                    if c.is_boilerplate:
                        continue
                    bits.append(np.frombuffer(c.binary, dtype=np.uint8))
                    docs.append(base + i)
                    idxs.append(c.index)
                    if want_int8:
                        if c.int8 is None:
                            want_int8 = False
                        else:
                            q.append(np.frombuffer(c.int8, dtype=np.int8))
            if bits:
                nb = np.stack(bits)
                nd = np.array(docs, dtype=np.int32)
                ni = np.array(idxs, dtype=np.int32)
                self.chunk_bits = nb if self.chunk_bits is None else np.concatenate([self.chunk_bits, nb])
                self.chunk_doc = nd if self.chunk_doc is None else np.concatenate([self.chunk_doc, nd])
                self.chunk_index = ni if self.chunk_index is None else np.concatenate([self.chunk_index, ni])
                if want_int8 and len(q) == len(bits):
                    nq = np.stack(q)
                    self.chunk_int8 = nq if self.chunk_int8 is None else np.concatenate([self.chunk_int8, nq])
                else:
                    self.chunk_int8 = None      # 일부라도 int8 이 없으면 재정렬 불가 → 전체 해밍 추정
        self.meta["n_docs"] = len(self.doc_ids)

    # ───────── 저장/적재 ─────────

    def save(self, reg_dir: str | Path) -> None:
        d = Path(reg_dir)
        arrays: dict[str, np.ndarray] = {}
        for name in ("minhash", "shingle_count", "chunk_bits", "chunk_doc", "chunk_index", "chunk_int8"):
            v = getattr(self, name)
            if v is not None:
                arrays[name] = v
        np.savez(d / INDEX_NPZ, **arrays)
        meta = dict(self.meta)
        meta["doc_ids"] = self.doc_ids
        meta["hash_norm"] = self.hash_norm
        (d / INDEX_META).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, reg_dir: str | Path) -> "RegistryIndex":
        d = Path(reg_dir)
        if not (d / INDEX_META).is_file():
            return cls.empty()
        meta = json.loads((d / INDEX_META).read_text(encoding="utf-8"))
        doc_ids = meta.pop("doc_ids")
        hash_norm = meta.pop("hash_norm")
        arrays: dict[str, np.ndarray] = {}
        if (d / INDEX_NPZ).is_file():
            with np.load(d / INDEX_NPZ) as z:
                arrays = {k: z[k] for k in z.files}
        return cls(meta=meta, doc_ids=doc_ids, hash_norm=hash_norm,
                   minhash=arrays.get("minhash"), shingle_count=arrays.get("shingle_count"),
                   chunk_bits=arrays.get("chunk_bits"), chunk_doc=arrays.get("chunk_doc"),
                   chunk_index=arrays.get("chunk_index"), chunk_int8=arrays.get("chunk_int8"))

    # ───────── 엔진 A 질의 (LSH) ─────────

    def query_shingle(self, fp: Fingerprint, cfg: Config, top: int) -> list[ShingleHit]:
        from docsim.engines.shingle.compare import containment

        if self.minhash is None or fp.shingle is None or len(self.doc_ids) == 0:
            return []
        self.check_sig(fp)
        bands, rows = int(cfg.get("registry.lsh.bands")), int(cfg.get("registry.lsh.rows"))
        if self._bands is None:
            self._bands = band_keys(self.minhash, bands, rows)
        q = np.array(fp.shingle.minhash, dtype=np.uint32)[None, :]
        qk = band_keys(q, bands, rows)[0]
        cand = np.nonzero((self._bands == qk[None, :]).any(axis=1))[0]
        if cand.size == 0:
            return []
        j = (self.minhash[cand] == q).mean(axis=1)
        order = np.argsort(-j, kind="stable")[:top]
        hits = []
        for o in order:
            di = int(cand[o])
            cq, cd, _ = containment(float(j[o]), fp.shingle.shingle_count, int(self.shingle_count[di]))
            hits.append(ShingleHit(doc_idx=di, jaccard=float(j[o]), containment_q_in_d=cq, containment_d_in_q=cd, lsh_candidate=True))
        return hits

    def shingle_estimate(self, fp: Fingerprint, doc_idx: int) -> ShingleHit:
        """LSH 후보가 아닌 문서에 대한 사후 추정 (표시용). LSH 를 우회하는 탐색이 아니다."""
        from docsim.engines.shingle.compare import containment

        q = np.array(fp.shingle.minhash, dtype=np.uint32)
        j = float((self.minhash[doc_idx] == q).mean())
        cq, cd, _ = containment(j, fp.shingle.shingle_count, int(self.shingle_count[doc_idx]))
        return ShingleHit(doc_idx=doc_idx, jaccard=j, containment_q_in_d=cq, containment_d_in_q=cd, lsh_candidate=False)

    # ───────── 엔진 B 질의 (해밍 전수) ─────────

    def query_embed(self, fp: Fingerprint, cfg: Config, top: int) -> list[EmbedHit]:
        from docsim.engines.embed.compare import hamming_to_cosine
        from docsim.engines.embed.fingerprint import dequantize_int8

        if self.chunk_bits is None or fp.embed is None or len(self.doc_ids) == 0:
            return []
        self.check_sig(fp)
        qchunks = [c for c in fp.embed.chunks if not c.is_boilerplate]
        if not qchunks:
            return []
        dim = fp.embed.dim
        n_docs = len(self.doc_ids)
        best_ham = np.full(n_docs, dim + 1, dtype=np.int32)
        best_q = np.zeros(n_docs, dtype=np.int32)
        best_c = np.zeros(n_docs, dtype=np.int64)
        for qi, c in enumerate(qchunks):
            qb = np.frombuffer(c.binary, dtype=np.uint8)
            ham = _POPCOUNT[np.bitwise_xor(self.chunk_bits, qb[None, :])].sum(axis=1, dtype=np.int32)   # (M,)
            # 문서별 최소 해밍 (= 최대 코사인): 정렬 후 첫 등장
            order = np.lexsort((ham, self.chunk_doc))
            docs_sorted = self.chunk_doc[order]
            first = np.ones(order.size, dtype=bool)
            first[1:] = docs_sorted[1:] != docs_sorted[:-1]
            sel = order[first]
            d = self.chunk_doc[sel]
            better = ham[sel] < best_ham[d]
            best_ham[d[better]] = ham[sel][better]
            best_q[d[better]] = qi
            best_c[d[better]] = sel[better]
        valid = np.nonzero(best_ham <= dim)[0]
        est = hamming_to_cosine(best_ham[valid], dim)
        rerank = bool(cfg.get("embed.rerank.enabled")) and self.chunk_int8 is not None and all(c.int8 is not None for c in qchunks)
        topk = int(cfg.get("embed.rerank.topk"))
        order = np.argsort(-est, kind="stable")
        if rerank:
            cand_docs = valid[order[:max(top, min(topk, order.size))]]
            qv = dequantize_int8(np.stack([np.frombuffer(c.int8, dtype=np.int8) for c in qchunks]))   # (nq, dim)
            hits = []
            for di in cand_docs:
                rows = np.nonzero(self.chunk_doc == di)[0]
                dv = dequantize_int8(self.chunk_int8[rows])                                        # (nd, dim)
                sims = qv @ dv.T
                qi, ci = np.unravel_index(int(np.argmax(sims)), sims.shape)
                row = rows[ci]
                qb = np.frombuffer(qchunks[qi].binary, dtype=np.uint8)
                h = int(_POPCOUNT[np.bitwise_xor(self.chunk_bits[row], qb)].sum())
                hits.append(EmbedHit(doc_idx=int(di), max_cosine=float(sims[qi, ci]), q_chunk=qchunks[qi].index,
                                     d_chunk=int(self.chunk_index[row]), hamming=h))
            hits.sort(key=lambda h: -h.max_cosine)
            return hits[:top]
        hits = []
        for o in order[:top]:
            di = int(valid[o])
            hits.append(EmbedHit(doc_idx=di, max_cosine=float(est[o]), q_chunk=qchunks[best_q[di]].index,
                                 d_chunk=int(self.chunk_index[best_c[di]]), hamming=int(best_ham[di])))
        return hits

    def embed_estimate(self, fp: Fingerprint, doc_idx: int) -> EmbedHit | None:
        """특정 문서 하나에 대한 엔진 B 점수 (표시용)."""
        from docsim.engines.embed.compare import hamming_to_cosine
        from docsim.engines.embed.fingerprint import dequantize_int8

        if self.chunk_bits is None or fp.embed is None:
            return None
        qchunks = [c for c in fp.embed.chunks if not c.is_boilerplate]
        rows = np.nonzero(self.chunk_doc == doc_idx)[0]
        if not qchunks or rows.size == 0:
            return None
        qb = np.stack([np.frombuffer(c.binary, dtype=np.uint8) for c in qchunks])
        ham = _POPCOUNT[np.bitwise_xor(qb[:, None, :], self.chunk_bits[rows][None, :, :])].sum(axis=-1, dtype=np.int32)
        if self.chunk_int8 is not None and all(c.int8 is not None for c in qchunks):
            qv = dequantize_int8(np.stack([np.frombuffer(c.int8, dtype=np.int8) for c in qchunks]))
            sims = qv @ dequantize_int8(self.chunk_int8[rows]).T
        else:
            sims = hamming_to_cosine(ham, fp.embed.dim)
        qi, ci = np.unravel_index(int(np.argmax(sims)), sims.shape)
        return EmbedHit(doc_idx=doc_idx, max_cosine=float(sims[qi, ci]), q_chunk=qchunks[qi].index,
                        d_chunk=int(self.chunk_index[rows[ci]]), hamming=int(ham[qi, ci]))
