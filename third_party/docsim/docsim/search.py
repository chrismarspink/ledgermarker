"""폴더에서 유사 문서 찾기 — 질의 파일 1개 vs 폴더 안의 지원 포맷 파일 전부.

폴더 파일의 지문은 (경로, 수정시각, 크기) 키로 캐시한다 (search.cache_dir). 지문만 저장하고 원문은 저장하지 않는다 (R10).
정렬: 유사도순 = 판정 우선순위(동일 > 개정판/추가 > 발췌 > 재작성 > 일부 유사 > 무관) → max(자카드, 코사인). 날짜순 = 수정일.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path

from docsim.core.config import Config
from docsim.core.errors import DocsimError
from docsim.core.extract import SUPPORTED_SUFFIXES
from docsim.core.schema import Fingerprint, load_fingerprint, save_fingerprint
from docsim.pipeline import Pipeline, compare_fingerprints
from docsim.report.verdict import judge

log = logging.getLogger("docsim.search")

RELATION_RANK = {"identical": 0, "revision": 1, "added": 1, "excerpt": 2, "rewrite": 3, "partial": 4, "unrelated": 5, "insufficient": 6}


@dataclass
class SearchRow:
    path: str               # 폴더 기준 상대 경로
    name: str
    relation: str
    label: str
    direction: str | None
    confidence: str
    summary: str
    jaccard: float | None
    containment: float | None
    cosine: float | None
    identical: bool
    mtime: str              # ISO8601
    mtime_ts: float
    size: int
    sim_key: float          # 정렬용 (표시는 개별 수치로)
    rank_sim: int = 0
    rank_date: int = 0


@dataclass
class SearchResult:
    query: str
    folder: str
    n_files: int
    n_compared: int
    n_cached: int
    skipped: list[str]      # 추출 실패 파일 (경로 + 사유)
    rows: list[SearchRow]

    def as_dict(self) -> dict:
        return {"query": self.query, "folder": self.folder, "n_files": self.n_files, "n_compared": self.n_compared,
                "n_cached": self.n_cached, "skipped": self.skipped, "rows": [asdict(r) for r in self.rows]}


def scan_folder(folder: str | Path, recursive: bool, max_files: int, exclude: Path | None = None) -> list[Path]:
    root = Path(folder).expanduser()
    if not root.is_dir():
        raise DocsimError(f"폴더가 없습니다: {root}")
    it = root.rglob("*") if recursive else root.glob("*")
    files = []
    for p in it:
        if not p.is_file() or p.name.startswith(".") or p.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        if exclude is not None and p.resolve() == exclude.resolve():
            continue
        files.append(p)
        if len(files) >= max_files:
            break
    files.sort(key=lambda p: str(p).lower())
    return files


class FolderFingerprinter:
    """폴더 파일 지문 생성 + 디스크 캐시."""

    def __init__(self, cfg: Config, pipe: Pipeline, lock=None):
        self.cfg = cfg
        self.pipe = pipe
        self.lock = lock
        cd = cfg.get("search.cache_dir")
        self.cache_dir = Path(str(cd)).expanduser() if cd else None
        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.hits = 0

    def _key(self, p: Path) -> Path | None:
        if self.cache_dir is None:
            return None
        st = p.stat()
        sig = f"{p.resolve()}|{st.st_mtime_ns}|{st.st_size}|{self.cfg.get('norm_version')}|{self.cfg.get('embed.model_id')}"
        return self.cache_dir / (hashlib.sha256(sig.encode("utf-8")).hexdigest()[:32] + ".fp.json")

    def fingerprint(self, p: Path, progress=None) -> Fingerprint:
        key = self._key(p)
        if key is not None and key.is_file():
            try:
                fp = load_fingerprint(key)
                self.hits += 1
                return replace(fp, doc_id=p.name)
            except DocsimError:
                key.unlink(missing_ok=True)
        if self.lock is not None:
            with self.lock:
                fp = self.pipe.fingerprint_file(p, p.name, progress)
        else:
            fp = self.pipe.fingerprint_file(p, p.name, progress)
        if key is not None:
            try:
                save_fingerprint(fp, key)
            except OSError as e:  # noqa: PERF203
                log.warning("지문 캐시 저장 실패: %s", e)
        return fp


def search(query_fp: Fingerprint, query_name: str, folder: str | Path, files: list[Path], ff: FolderFingerprinter,
           cfg: Config, engine: str = "both", progress=None, hide_unrelated: bool = False) -> SearchResult:
    root = Path(folder).expanduser()
    rows: list[SearchRow] = []
    skipped: list[str] = []
    n = len(files)
    for i, p in enumerate(files):
        if progress:
            progress(i / max(n, 1), f"{i + 1}/{n} {p.name}")
        try:
            fp = ff.fingerprint(p)
            r = compare_fingerprints(query_fp, fp, cfg, engine)
        except DocsimError as e:
            skipped.append(f"{p.relative_to(root)}: {type(e).__name__}: {e}")
            continue
        v = judge(r, query_fp, fp, cfg)
        relation = v.relation if v else ("identical" if r.identical else "insufficient")
        if hide_unrelated and relation == "unrelated":
            continue
        s, e = r.shingle, r.embed
        j = s.jaccard if s else None
        c = max(s.containment_a_in_b, s.containment_b_in_a) if s else None
        cos = e.max_cosine if e else None
        st = p.stat()
        sim_key = max(x for x in (j, cos, 0.0) if x is not None)
        rows.append(SearchRow(
            path=str(p.relative_to(root)), name=p.name, relation=relation,
            label=(v.label if v else relation), direction=(v.direction if v else None),
            confidence=(v.confidence if v else "-"), summary=(v.summary if v else ""),
            jaccard=j, containment=c, cosine=cos, identical=r.identical,
            mtime=datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"), mtime_ts=st.st_mtime, size=st.st_size,
            sim_key=sim_key,
        ))
    if progress:
        progress(1.0, f"{n} 파일 비교 완료")
    by_sim = sorted(rows, key=lambda r: (RELATION_RANK.get(r.relation, 9), -r.sim_key, -r.mtime_ts))
    for k, r in enumerate(by_sim, 1):
        r.rank_sim = k
    for k, r in enumerate(sorted(rows, key=lambda r: -r.mtime_ts), 1):
        r.rank_date = k
    return SearchResult(query=query_name, folder=str(root), n_files=n, n_compared=len(rows) + (len(skipped)),
                        n_cached=ff.hits, skipped=skipped, rows=by_sim)
