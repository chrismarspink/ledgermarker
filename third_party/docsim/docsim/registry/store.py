"""지문 저장/조회. 디렉터리에 {doc_id}.fp.json 만 쌓인다. 원문은 저장하지 않는다 (R10)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from docsim.core.config import Config
from docsim.core.errors import SchemaError
from docsim.core.schema import Fingerprint, load_fingerprint, save_fingerprint
from docsim.registry.index import RegistryIndex

FP_SUFFIX = ".fp.json"
_SAFE_ID = re.compile(r"[^A-Za-z0-9._\-가-힣]+")


def safe_doc_id(doc_id: str) -> str:
    s = _SAFE_ID.sub("_", doc_id).strip("._")
    if not s:
        raise SchemaError("doc_id 가 비어 있습니다")
    return s


@dataclass
class QueryRow:
    doc_id: str
    rank_a: int | None          # 엔진 A 순위 (LSH 후보 중), None 이면 A 미검출
    rank_b: int | None          # 엔진 B 순위, None 이면 B 미검출
    jaccard: float | None
    containment: float | None   # max(q⊆d, d⊆q)
    cosine: float | None
    identical: bool


class RegistryStore:
    def __init__(self, path: str | Path):
        self.dir = Path(path)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._index: RegistryIndex | None = None

    # ───────── 저장 ─────────

    def fp_path(self, doc_id: str) -> Path:
        return self.dir / f"{safe_doc_id(doc_id)}{FP_SUFFIX}"

    def add(self, fps: list[Fingerprint]) -> None:
        idx = self.index
        idx.add(fps)                       # 버전 검증 → 실패 시 파일도 쓰지 않는다
        for fp in fps:
            save_fingerprint(fp, self.fp_path(fp.doc_id))
        idx.save(self.dir)

    def iter_fingerprints(self) -> Iterator[Fingerprint]:
        for p in sorted(self.dir.glob(f"*{FP_SUFFIX}")):
            yield load_fingerprint(p)

    def reindex(self) -> RegistryIndex:
        idx = RegistryIndex.empty()
        fps = list(self.iter_fingerprints())
        if fps:
            idx.add(fps)
        idx.save(self.dir)
        self._index = idx
        return idx

    @property
    def index(self) -> RegistryIndex:
        if self._index is None:
            self._index = RegistryIndex.load(self.dir)
        return self._index

    def stats(self) -> dict[str, Any]:
        idx = self.index
        files = list(self.dir.glob(f"*{FP_SUFFIX}"))
        non_fp = [p.name for p in self.dir.iterdir() if p.is_file() and not p.name.endswith(FP_SUFFIX) and not p.name.startswith("_index")]
        return {
            "path": str(self.dir),
            "fingerprint_files": len(files),
            "indexed_docs": len(idx.doc_ids),
            "indexed_chunks": int(idx.chunk_bits.shape[0]) if idx.chunk_bits is not None else 0,
            "int8_stored": idx.chunk_int8 is not None,
            "bytes_on_disk": sum(p.stat().st_size for p in self.dir.iterdir() if p.is_file()),
            "sig": idx.meta.get("sig"),
            "non_fingerprint_files": non_fp,     # 반드시 비어 있어야 한다 (원문 없음)
        }

    # ───────── 질의 ─────────

    def query(self, fp: Fingerprint, cfg: Config, top: int) -> list[QueryRow]:
        """두 엔진을 각각 질의하고 결과를 나란히 합친다. 정렬은 min(rank_A, rank_B) — 점수를 합치지 않는다."""
        idx = self.index
        a_hits = idx.query_shingle(fp, cfg, top) if fp.shingle is not None else []
        b_hits = idx.query_embed(fp, cfg, top) if fp.embed is not None else []
        rank_a = {h.doc_idx: (r + 1, h) for r, h in enumerate(a_hits)}
        rank_b = {h.doc_idx: (r + 1, h) for r, h in enumerate(b_hits)}
        rows: list[QueryRow] = []
        for di in set(rank_a) | set(rank_b):
            ra, ha = rank_a.get(di, (None, None))
            rb, hb = rank_b.get(di, (None, None))
            if ha is None and fp.shingle is not None and idx.minhash is not None:
                ha = idx.shingle_estimate(fp, di)
            if hb is None and fp.embed is not None and idx.chunk_bits is not None:
                hb = idx.embed_estimate(fp, di)
            rows.append(QueryRow(
                doc_id=idx.doc_ids[di], rank_a=ra, rank_b=rb,
                jaccard=(ha.jaccard if ha else None),
                containment=(max(ha.containment_q_in_d, ha.containment_d_in_q) if ha else None),
                cosine=(hb.max_cosine if hb else None),
                identical=(idx.hash_norm[di] == fp.hash_norm),
            ))
        big = 10 ** 9
        rows.sort(key=lambda r: (min(r.rank_a or big, r.rank_b or big), r.rank_a or big, r.rank_b or big))
        return rows[:top]
