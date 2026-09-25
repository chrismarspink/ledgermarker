"""최상위 오케스트레이션 — 두 엔진을 각각 호출하고 결과를 나란히 담는다. 엔진끼리는 여기서도 섞지 않는다."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from docsim.core.config import Config
from docsim.core.errors import ConfigError
from docsim.core.extract import extract_text
from docsim.core.normalize import NORM_VERSION, hash_norm, normalize
from docsim.core.schema import SCHEMA_VERSION, CompareResult, Fingerprint, check_compatible

log = logging.getLogger("docsim")

ENGINES = ("shingle", "embed", "both")


def _engines(engine: str) -> tuple[bool, bool]:
    if engine not in ENGINES:
        raise ConfigError(f"--engine 은 {ENGINES} 중 하나여야 합니다: {engine}")
    return engine in ("shingle", "both"), engine in ("embed", "both")


@dataclass
class Pipeline:
    """엔진 컨텍스트를 한 번 기동해 여러 문서에 재사용한다."""

    cfg: Config
    use_shingle: bool
    use_embed: bool
    _key: bytes | None = None
    _df_table: object = None
    _embed: object = None

    @classmethod
    def start(cls, cfg: Config, engine: str = "both") -> "Pipeline":
        us, ue = _engines(engine)
        p = cls(cfg=cfg, use_shingle=us, use_embed=ue)
        if us:
            from docsim.engines.shingle.df import DFTable
            from docsim.engines.shingle.fingerprint import load_key
            p._key = load_key(cfg)
            if bool(cfg.get("shingle.df.enabled")):
                path = cfg.resolve_path("shingle.df.table")
                if path is None:
                    raise ConfigError("shingle.df.enabled=true 이지만 shingle.df.table 이 없습니다")
                p._df_table = DFTable.load(path)
        if ue:
            from docsim.engines.embed.fingerprint import EmbedEngine
            p._embed = EmbedEngine(cfg)          # 여기서 R4/R5/R6 게이트가 실행된다
        return p

    @property
    def embed_engine(self):
        return self._embed

    def fingerprint_text(self, raw_text: str, doc_id: str, progress=None) -> Fingerprint:
        """progress(stage, frac, detail) — stage ∈ normalize | shingle | embed."""
        def report(stage, frac, detail=""):
            if progress is not None:
                progress(stage, frac, detail)

        report("normalize", 0.0, "정규화")
        norm = normalize(raw_text)
        shingle_fp = embed_fp = None
        if self.use_shingle:
            from docsim.engines.shingle.fingerprint import build_shingle_fingerprint
            report("shingle", 0.0, f"엔진 A 지문 ({len(norm):,}자)")
            shingle_fp = build_shingle_fingerprint(norm, self.cfg, self._key, self._df_table)
            report("shingle", 1.0, f"엔진 A 지문 완료 (슁글 {shingle_fp.shingle_count:,})")
        if self.use_embed:
            bs = int(self.cfg.get("server.encode_batch_size"))
            report("embed", 0.0, "엔진 B 청킹")
            embed_fp = self._embed.fingerprint(
                norm, progress=lambda d, n: report("embed", d / max(n, 1), f"엔진 B 인코딩 {d}/{n} 청크"), batch_size=bs)
            report("embed", 1.0, f"엔진 B 지문 완료 (청크 {len(embed_fp.chunks)})")
        return Fingerprint(
            doc_id=doc_id,
            schema_version=SCHEMA_VERSION,
            norm_version=NORM_VERSION,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            hash_norm=hash_norm(norm),
            norm_len=len(norm),
            shingle=shingle_fp,
            embed=embed_fp,
        )

    def fingerprint_file(self, path: str | Path, doc_id: str | None = None, progress=None) -> Fingerprint:
        p = Path(path)
        return self.fingerprint_text(extract_text(p, self.cfg, progress), doc_id or p.stem, progress)


def compare_fingerprints(a: Fingerprint, b: Fingerprint, cfg: Config, engine: str = "both") -> CompareResult:
    """지문 두 개 → CompareResult. 원문 불필요. 버전 불일치는 계산 전에 에러 (R9)."""
    us, ue = _engines(engine)
    if cfg.get("norm_version") != a.norm_version:
        raise ConfigError(f"config.norm_version={cfg.get('norm_version')} 과 지문 norm_version={a.norm_version} 불일치")
    check_compatible(a, b)
    warnings: list[str] = []
    shingle_res = embed_res = None
    if us:
        if a.shingle is None or b.shingle is None:
            warnings.append("shingle 지문이 한쪽 이상 없음 — 엔진 A 생략")
        else:
            from docsim.engines.shingle.compare import compare as shingle_compare
            shingle_res = shingle_compare(a.shingle, b.shingle, cfg, warnings)
    if ue:
        if a.embed is None or b.embed is None:
            warnings.append("embed 지문이 한쪽 이상 없음 — 엔진 B 생략")
        else:
            from docsim.engines.embed.compare import compare as embed_compare
            embed_res = embed_compare(a.embed, b.embed, cfg, warnings)
    return CompareResult(
        doc_a=a.doc_id, doc_b=b.doc_id, identical=(a.hash_norm == b.hash_norm),
        shingle=shingle_res, embed=embed_res, warnings=warnings,
    )


def iter_corpus_files(corpus_dir: str | Path) -> Iterable[Path]:
    from docsim.core.extract import SUPPORTED_SUFFIXES
    root = Path(corpus_dir)
    if not root.is_dir():
        raise ConfigError(f"코퍼스 디렉터리가 없습니다: {root}")
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES:
            yield p
