"""docsim CLI 진입점."""

from __future__ import annotations

import logging
import platform
import sys
from pathlib import Path

import click

from docsim import __version__
from docsim.core.config import Config
from docsim.core.errors import DocsimError
from docsim.core.normalize import NORM_VERSION


def _load_cfg(ctx: click.Context) -> Config:
    return Config.load(ctx.obj.get("config_path"))


@click.group()
@click.option("--config", "config_path", type=click.Path(), default=None, help="config.yaml 경로")
@click.option("-v", "--verbose", is_flag=True, help="INFO 로그 출력")
@click.version_option(__version__)
@click.pass_context
def main(ctx: click.Context, config_path: str | None, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = config_path
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")


# ───────────────────────────── doctor ─────────────────────────────


@main.command()
@click.pass_context
def doctor(ctx: click.Context) -> None:
    """환경 검증 리포트. max_seq_length 를 실측해 출력한다 (R5)."""
    import numpy as np

    cfg = _load_cfg(ctx)
    click.echo("docsim doctor\n")

    click.echo("[환경]")
    click.echo(f"  Python            {platform.python_version()}")
    try:
        import sentence_transformers
        click.echo(f"  sentence-transformers  {sentence_transformers.__version__}")
    except Exception as e:  # noqa: BLE001
        click.echo(f"  sentence-transformers  미설치 ({type(e).__name__})")
    click.echo(f"  numpy             {np.__version__}")
    try:
        import torch
        click.echo(f"  torch             {torch.__version__}")
    except Exception:  # noqa: BLE001
        click.echo("  torch             미설치")
    click.echo(f"  config            {cfg.path}")

    click.echo("\n[정규화]")
    click.echo(f"  norm_version      {NORM_VERSION}")
    if cfg.get("norm_version") != NORM_VERSION:
        click.echo(f"  ⚠ config.norm_version={cfg.get('norm_version')} 이 코드의 {NORM_VERSION} 와 다릅니다")

    model_id = cfg.get("embed.model_id")
    chunk_tokens = int(cfg.get("embed.chunk_tokens"))
    click.echo(f"\n[모델] {model_id}")
    ok = True
    try:
        from docsim.engines.embed.model import load_model
        lm = load_model(model_id, min_margin=float(cfg.get("embed.sbert_gate_margin")), torch_threads=int(cfg.get("embed.torch_threads")), device=str(cfg.get("embed.device")))
        click.echo(f"  로드              OK (device={lm.device})")
        click.echo(f"  차원              {lm.dim}")
        click.echo(f"  max_seq_length    {lm.max_seq_length}          ← ★ 실측값. 하드코딩 아님 (R5)")
        click.echo(
            f"  SBERT 검증        OK           ← ★ §4.2 게이트 통과 "
            f"(pos={lm.probe.pos_mean:.3f} neg={lm.probe.neg_mean:.3f} margin={lm.probe.margin:.3f})"
        )
        if lm.max_seq_length <= 128:
            click.echo(
                f"  ⚠ max_seq_length={lm.max_seq_length} — 청크 토큰 수를 이 값 이하로 설정해야 합니다.\n"
                f"    초과 입력은 경고 없이 잘립니다. config.embed.chunk_tokens 를 확인하십시오."
            )
        if chunk_tokens > lm.max_seq_length:
            ok = False
            click.echo(f"  ✗ embed.chunk_tokens={chunk_tokens} > max_seq_length={lm.max_seq_length} (R5 위반, 기동 거부됨)")
    except DocsimError as e:
        ok = False
        click.echo(f"  로드              실패 — {type(e).__name__}: {e}")
    except Exception as e:  # noqa: BLE001
        ok = False
        click.echo(f"  로드              실패 — {type(e).__name__}: {e}")

    mu_path = cfg.resolve_path("embed.mu_path")
    if mu_path is not None and mu_path.is_file():
        try:
            from docsim.engines.embed.centering import load_mu
            mu, meta = load_mu(mu_path)
            click.echo(f"  mu 파일           {mu_path} (mu_version={meta.get('mu_version')}, n_chunks={meta.get('n_chunks')})")
        except NotImplementedError:
            click.echo(f"  mu 파일           {mu_path} (존재, 검증은 Phase 2)")
        except DocsimError as e:
            click.echo(f"  mu 파일           손상 — {e}")
    else:
        click.echo(f"  mu 파일           없음         ← Phase 2에서 생성 필요 (embed 엔진은 기동 거부, R6)")

    click.echo("\n[추출]")
    try:
        from docsim.core.extract import ocr_settings_from
        from docsim.core.ocr import describe_ocr
        click.echo(f"  스캔 PDF          {describe_ocr(ocr_settings_from(cfg))}")
    except DocsimError as e:
        click.echo(f"  스캔 PDF          설정 오류 — {e}")
    for mod, pkg in (("docx", "python-docx"), ("pypdf", "pypdf"), ("pypdfium2", "pypdfium2"), ("olefile", "olefile")):
        try:
            __import__(mod)
            click.echo(f"  {pkg:<18}OK")
        except ImportError:
            click.echo(f"  {pkg:<18}미설치")

    click.echo("\n[설정]")
    for key in ("shingle.k", "shingle.minhash.perms", "shingle.minhash.seed", "shingle.df.enabled",
                "embed.chunk_tokens", "embed.overlap_ratio", "embed.quant.store_int8",
                "embed.rerank.enabled", "embed.boilerplate.enabled", "registry.lsh.bands", "registry.lsh.rows"):
        click.echo(f"  {key:<26} {cfg.get(key)}")
    bands, rows, perms = int(cfg.get("registry.lsh.bands")), int(cfg.get("registry.lsh.rows")), int(cfg.get("shingle.minhash.perms"))
    if bands * rows != perms:
        ok = False
        click.echo(f"  ✗ registry.lsh.bands*rows={bands * rows} != minhash.perms={perms}")
    import os
    from docsim.engines.shingle.fingerprint import KEY_ENV
    if os.environ.get(KEY_ENV) or cfg.get("shingle.hmac_key_file"):
        click.echo(f"  HMAC 키           OK ({KEY_ENV} 또는 hmac_key_file)")
    else:
        click.echo(f"  ⚠ HMAC 키 없음 — {KEY_ENV} 환경변수 또는 shingle.hmac_key_file 필요 (shingle 엔진 기동 불가)")

    sys.exit(0 if ok else 1)


def _cli_entry() -> None:
    try:
        main(obj={})
    except DocsimError as e:
        click.echo(f"오류 [{type(e).__name__}]: {e}", err=True)
        sys.exit(2)


# ───────────────────────────── Phase 2: mu ─────────────────────────────


@main.command("build-mu")
@click.argument("corpus_dir", type=click.Path(exists=True, file_okay=False))
@click.option("-o", "output", type=click.Path(), required=True, help="mu.npy 출력 경로 (mu.meta.json 이 함께 생성됨)")
@click.option("--max-docs", type=int, default=None, help="코퍼스 앞부분만 사용")
@click.pass_context
def build_mu(ctx: click.Context, corpus_dir: str, output: str, max_docs: int | None) -> None:
    """코퍼스 전체를 청킹·인코딩 → L2 정규화 → 차원별 평균 mu 산출 (R6)."""
    import numpy as np

    from docsim.core.extract import extract_text
    from docsim.core.normalize import normalize
    from docsim.engines.embed.centering import bit_balance, compute_mu, save_mu
    from docsim.engines.embed.chunk import chunk
    from docsim.engines.embed.model import load_model
    from docsim.pipeline import iter_corpus_files

    cfg = _load_cfg(ctx)
    lm = load_model(str(cfg.get("embed.model_id")), float(cfg.get("embed.sbert_gate_margin")), torch_threads=int(cfg.get("embed.torch_threads")), device=str(cfg.get("embed.device")))
    click.echo(f"모델 {lm.model_id}: dim={lm.dim} max_seq_length={lm.max_seq_length} (실측)")
    chunk_tokens, overlap = int(cfg.get("embed.chunk_tokens")), float(cfg.get("embed.overlap_ratio"))
    all_vecs: list[np.ndarray] = []
    n_docs = 0
    for i, path in enumerate(iter_corpus_files(corpus_dir)):
        if max_docs is not None and i >= max_docs:
            break
        norm = normalize(extract_text(path, cfg))
        chunks = chunk(norm, chunk_tokens, overlap, lm.count_tokens, lm.max_seq_length)
        if not chunks:
            continue
        all_vecs.append(lm.encode([c.text for c in chunks]))
        n_docs += 1
        if n_docs % 50 == 0:
            click.echo(f"  {n_docs} 문서 / {sum(v.shape[0] for v in all_vecs)} 청크 인코딩", err=True)
    if not all_vecs:
        raise DocsimError("코퍼스에서 청크를 하나도 만들지 못했습니다")
    vecs = np.concatenate(all_vecs, axis=0)
    warnings: list[str] = []
    mu = compute_mu(vecs, int(cfg.get("embed.mu.min_chunks_reject")), int(cfg.get("embed.mu.min_chunks_warn")), warnings)
    meta = save_mu(output, mu, lm.model_id, n_chunks=vecs.shape[0], n_docs=n_docs)
    for w in warnings:
        click.echo(f"  ⚠ {w}")
    click.echo(f"mu 저장: {output}  mu_version={meta['mu_version']}  n_docs={n_docs}  n_chunks={vecs.shape[0]}")
    stats = bit_balance(vecs, mu, float(cfg.get("embed.bit_balance.saturation_low")), float(cfg.get("embed.bit_balance.saturation_high")))
    _echo_bit_balance(stats, float(cfg.get("embed.bit_balance.max_saturated_ratio")))


def _echo_bit_balance(stats: dict, max_ratio: float) -> bool:
    ok = stats["saturated_ratio"] <= max_ratio
    click.echo(f"  차원별 1-비율 분포: p5={stats['p5']:.2f} p50={stats['p50']:.2f} p95={stats['p95']:.2f}   {'OK' if 0.3 < stats['p50'] < 0.7 else '⚠ 치우침'}")
    click.echo(f"  포화 차원(<low or >high): {stats['saturated']} / {stats['dim']} ({stats['saturated_ratio']:.1%})      {'OK' if ok else '⚠ mu 가 잘못되었거나 코퍼스가 편향됨'}")
    return ok


@main.command("check-mu")
@click.argument("mu_path", type=click.Path(exists=True, dir_okay=False))
@click.option("--corpus", "corpus_dir", type=click.Path(exists=True, file_okay=False), default=None,
              help="검증에 쓸 코퍼스 (생략 시 mu 를 만든 코퍼스와 동일하다고 가정하지 않고 메타만 출력)")
@click.option("--max-docs", type=int, default=200)
@click.pass_context
def check_mu(ctx: click.Context, mu_path: str, corpus_dir: str | None, max_docs: int) -> None:
    """이진화 후 차원별 1-비율 분포를 검사한다. 포화 차원 비율이 기준을 넘으면 종료코드 1."""
    import numpy as np

    from docsim.core.extract import extract_text
    from docsim.core.normalize import normalize
    from docsim.engines.embed.centering import bit_balance, load_mu
    from docsim.engines.embed.chunk import chunk
    from docsim.engines.embed.model import load_model
    from docsim.pipeline import iter_corpus_files

    cfg = _load_cfg(ctx)
    mu, meta = load_mu(mu_path)
    click.echo(f"mu_version={meta['mu_version']} model_id={meta['model_id']} dim={meta['dim']} n_chunks={meta['n_chunks']} created={meta.get('created_at')}")
    if corpus_dir is None:
        click.echo("  --corpus 가 없어 비율 검사는 생략합니다")
        return
    lm = load_model(str(cfg.get("embed.model_id")), float(cfg.get("embed.sbert_gate_margin")), torch_threads=int(cfg.get("embed.torch_threads")), device=str(cfg.get("embed.device")))
    if lm.model_id != meta["model_id"]:
        raise DocsimError(f"mu 의 model_id={meta['model_id']} 와 현재 모델 {lm.model_id} 불일치")
    vecs = []
    for i, path in enumerate(iter_corpus_files(corpus_dir)):
        if i >= max_docs:
            break
        chunks = chunk(normalize(extract_text(path, cfg)), int(cfg.get("embed.chunk_tokens")), float(cfg.get("embed.overlap_ratio")), lm.count_tokens, lm.max_seq_length)
        if chunks:
            vecs.append(lm.encode([c.text for c in chunks]))
    stats = bit_balance(np.concatenate(vecs), mu, float(cfg.get("embed.bit_balance.saturation_low")), float(cfg.get("embed.bit_balance.saturation_high")))
    ok = _echo_bit_balance(stats, float(cfg.get("embed.bit_balance.max_saturated_ratio")))
    sys.exit(0 if ok else 1)


# ───────────────────────────── 서버 ─────────────────────────────


@main.command()
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=8765, show_default=True, type=int)
@click.option("--engine", type=click.Choice(["shingle", "embed", "both"]), default="both", show_default=True)
@click.pass_context
def serve(ctx: click.Context, host: str, port: int, engine: str) -> None:
    """선택적 HTTP 서버. 기동 시 R4/R5/R6 게이트를 통과해야 한다."""
    from docsim.server import serve as _serve
    _serve(_load_cfg(ctx), host, port, engine)


# ───────────────────────────── Phase 3: compare / fingerprint / compare-fp ─────────────────────────────

_ENGINE_OPT = click.option("--engine", type=click.Choice(["shingle", "embed", "both"]), default="both", show_default=True)


def _emit(result, fp_a, fp_b, as_json: bool, cfg) -> None:
    import json as _json

    from docsim.report.render import render_text, result_to_dict
    from docsim.report.verdict import judge
    v = judge(result, fp_a, fp_b, cfg)
    if as_json:
        click.echo(_json.dumps(result_to_dict(result, v), ensure_ascii=False, indent=2))
    else:
        click.echo(render_text(result, fp_a, fp_b, v))


@main.command()
@click.argument("file_a", type=click.Path(exists=True, dir_okay=False))
@click.argument("file_b", type=click.Path(exists=True, dir_okay=False))
@_ENGINE_OPT
@click.option("--json", "as_json", is_flag=True, help="기계 판독용 JSON 출력")
@click.pass_context
def compare(ctx: click.Context, file_a: str, file_b: str, engine: str, as_json: bool) -> None:
    """두 문서를 직접 비교한다. 종합 점수는 출력하지 않는다."""
    from docsim.pipeline import Pipeline, compare_fingerprints

    cfg = _load_cfg(ctx)
    pipe = Pipeline.start(cfg, engine)
    fa, fb = pipe.fingerprint_file(file_a), pipe.fingerprint_file(file_b)
    _emit(compare_fingerprints(fa, fb, cfg, engine), fa, fb, as_json, cfg)


@main.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "output", type=click.Path(), default=None, help="출력 경로 (기본: <파일명>.fp.json)")
@click.option("--doc-id", default=None, help="문서 ID (기본: 파일명 stem)")
@_ENGINE_OPT
@click.option("--unsafe-dump-text", is_flag=True, help="디버그 전용: 정규화 원문을 <출력>.text.txt 로 덤프 (R10 예외)")
@click.pass_context
def fingerprint(ctx: click.Context, file: str, output: str | None, doc_id: str | None, engine: str, unsafe_dump_text: bool) -> None:
    """문서 → 지문 파일. 원문은 저장하지 않는다 (R10)."""
    from docsim.core.extract import extract_text
    from docsim.core.normalize import normalize
    from docsim.core.schema import save_fingerprint
    from docsim.pipeline import Pipeline

    cfg = _load_cfg(ctx)
    pipe = Pipeline.start(cfg, engine)
    src = Path(file)
    out = Path(output) if output else src.with_suffix(".fp.json")
    fp = pipe.fingerprint_file(src, doc_id)
    save_fingerprint(fp, out)
    click.echo(f"지문 저장: {out}  (doc_id={fp.doc_id}, 정규화 {fp.norm_len:,}자"
               + (f", 슁글 {fp.shingle.shingle_count:,}" if fp.shingle else "")
               + (f", 청크 {len(fp.embed.chunks)}" if fp.embed else "") + ")")
    if unsafe_dump_text or bool(cfg.get("output.unsafe_dump_text")):
        dump = out.with_suffix(".text.txt")
        dump.write_text(normalize(extract_text(src, cfg)), encoding="utf-8")
        click.echo(f"⚠ UNSAFE: 정규화 원문을 {dump} 에 덤프했습니다. 디버그 후 반드시 삭제하십시오 (R10).", err=True)


@main.command("compare-fp")
@click.argument("fp_a", type=click.Path(exists=True, dir_okay=False))
@click.argument("fp_b", type=click.Path(exists=True, dir_okay=False))
@_ENGINE_OPT
@click.option("--json", "as_json", is_flag=True, help="기계 판독용 JSON 출력")
@click.pass_context
def compare_fp(ctx: click.Context, fp_a: str, fp_b: str, engine: str, as_json: bool) -> None:
    """지문끼리 비교한다 — 원문 불필요. 버전이 다르면 계산 없이 에러 (R9)."""
    from docsim.core.schema import load_fingerprint
    from docsim.pipeline import compare_fingerprints

    cfg = _load_cfg(ctx)
    fa, fb = load_fingerprint(fp_a), load_fingerprint(fp_b)
    _emit(compare_fingerprints(fa, fb, cfg, engine), fa, fb, as_json, cfg)


# ───────────────────────────── Phase 4: registry ─────────────────────────────


@main.group()
def registry() -> None:
    """지문 레지스트리 (1:N 조회). 원문은 저장하지 않는다."""


def _reg_opt(f):
    return click.option("--registry", "reg_path", type=click.Path(), default=None,
                        help="레지스트리 디렉터리 (기본: config registry.path)")(f)


def _store(ctx: click.Context, reg_path: str | None):
    from docsim.registry.store import RegistryStore
    cfg = _load_cfg(ctx)
    path = Path(reg_path) if reg_path else cfg.resolve_path("registry.path")
    return cfg, RegistryStore(path)


@registry.command("add")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, dir_okay=True))
@_reg_opt
@_ENGINE_OPT
@click.option("--batch", type=int, default=200, show_default=True, help="색인 저장 단위")
@click.pass_context
def registry_add(ctx: click.Context, files: tuple[str, ...], reg_path: str | None, engine: str, batch: int) -> None:
    """파일(또는 디렉터리)들의 지문을 만들어 레지스트리에 추가한다."""
    from docsim.pipeline import Pipeline, iter_corpus_files

    cfg, store = _store(ctx, reg_path)
    pipe = Pipeline.start(cfg, engine)
    paths: list[Path] = []
    for f in files:
        p = Path(f)
        paths.extend(iter_corpus_files(p) if p.is_dir() else [p])
    done = 0
    buf = []
    for p in paths:
        buf.append(pipe.fingerprint_file(p))
        if len(buf) >= batch:
            store.add(buf); done += len(buf); buf = []
            click.echo(f"  {done}/{len(paths)} 색인", err=True)
    if buf:
        store.add(buf); done += len(buf)
    click.echo(f"레지스트리 {store.dir}: {done} 문서 추가 (총 {len(store.index.doc_ids)})")


@registry.command("reindex")
@_reg_opt
@click.pass_context
def registry_reindex(ctx: click.Context, reg_path: str | None) -> None:
    """디렉터리의 지문 파일들로 색인을 다시 만든다."""
    _, store = _store(ctx, reg_path)
    idx = store.reindex()
    click.echo(f"재색인 완료: {len(idx.doc_ids)} 문서")


@registry.command("stats")
@_reg_opt
@click.pass_context
def registry_stats(ctx: click.Context, reg_path: str | None) -> None:
    """레지스트리 통계."""
    import json as _json
    _, store = _store(ctx, reg_path)
    click.echo(_json.dumps(store.stats(), ensure_ascii=False, indent=2))


@registry.command("query")
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@_reg_opt
@_ENGINE_OPT
@click.option("--top", type=int, default=10, show_default=True)
@click.option("--json", "as_json", is_flag=True)
@click.pass_context
def registry_query(ctx: click.Context, file: str, reg_path: str | None, engine: str, top: int, as_json: bool) -> None:
    """새 문서를 레지스트리와 1:N 비교한다. 두 엔진 결과를 나란히 보여준다."""
    import json as _json
    import time
    from dataclasses import asdict

    from docsim.pipeline import Pipeline

    cfg, store = _store(ctx, reg_path)
    pipe = Pipeline.start(cfg, engine)
    fp = pipe.fingerprint_file(file)
    t0 = time.perf_counter()
    rows = store.query(fp, cfg, top)
    dt = time.perf_counter() - t0
    if as_json:
        click.echo(_json.dumps({"query": fp.doc_id, "elapsed_sec": dt, "rows": [asdict(r) for r in rows]}, ensure_ascii=False, indent=2))
        return
    click.echo(f"질의: {Path(file).name}   (레지스트리 {len(store.index.doc_ids)} 문서, 색인 질의 {dt * 1000:.0f} ms)\n")
    click.echo(f"{'순위':<4} {'문서ID':<24} {'엔진A 자카드':>12} {'엔진A 포함도':>12} {'엔진B 코사인':>12}")
    for i, r in enumerate(rows, 1):
        j = f"{r.jaccard:.3f}" if r.jaccard is not None else "-"
        c = f"{r.containment:.3f}" if r.containment is not None else "-"
        e = f"{r.cosine:.3f}" if r.cosine is not None else "-"
        tag = ""
        if r.rank_a is None and r.rank_b is not None:
            tag = "  ← 엔진B만 검출"
        elif r.rank_b is None and r.rank_a is not None:
            tag = "  ← 엔진A만 검출"
        if r.identical:
            tag += "  (동일)"
        click.echo(f"{i:<4} {r.doc_id:<24} {j:>12} {c:>12} {e:>12}{tag}")
    click.echo("\n※ 순서는 두 엔진 각각의 순위 중 더 좋은 것 기준. 종합 점수는 없다.")


# ───────────────────────────── 도구: 폴더에서 유사 문서 찾기 ─────────────────────────────


@main.command("search")
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.argument("folder", type=click.Path(exists=True, file_okay=False))
@click.option("--top", type=int, default=None, help="표시 건수 (기본: config search.default_top)")
@click.option("--sort", "sort_by", type=click.Choice(["sim", "date"]), default="sim", show_default=True)
@click.option("--no-recursive", is_flag=True)
@click.option("--hide-unrelated", is_flag=True)
@_ENGINE_OPT
@click.option("--json", "as_json", is_flag=True)
@click.pass_context
def search_cmd(ctx: click.Context, file: str, folder: str, top: int | None, sort_by: str, no_recursive: bool,
               hide_unrelated: bool, engine: str, as_json: bool) -> None:
    """파일 하나와 폴더 안의 문서들을 비교해 유사도순/날짜순으로 나열한다."""
    import json as _json

    from docsim.pipeline import Pipeline
    from docsim.search import FolderFingerprinter, scan_folder, search

    cfg = _load_cfg(ctx)
    pipe = Pipeline.start(cfg, engine)
    src = Path(file)
    files = scan_folder(folder, not no_recursive, int(cfg.get("search.max_files")), exclude=src)
    if not files:
        raise DocsimError(f"폴더에 지원 포맷 파일이 없습니다: {folder}")
    q_fp = pipe.fingerprint_file(src)
    ff = FolderFingerprinter(cfg, pipe)
    res = search(q_fp, src.name, folder, files, ff, cfg, engine, hide_unrelated=hide_unrelated,
                 progress=lambda fr, d: click.echo(f"\r  {fr * 100:5.1f}%  {d:<60}", nl=False, err=True))
    click.echo("", err=True)
    n = top if top is not None else int(cfg.get("search.default_top"))
    rows = res.rows if sort_by == "sim" else sorted(res.rows, key=lambda r: r.rank_date)
    rows = rows[:n]
    if as_json:
        d = res.as_dict()
        d["rows"] = [r for r in d["rows"] if any(r["path"] == x.path for x in rows)]
        click.echo(_json.dumps(d, ensure_ascii=False, indent=2))
        return
    click.echo(f"질의: {src.name}   폴더: {res.folder}   ({res.n_files} 파일, 캐시 {res.n_cached}, 실패 {len(res.skipped)})\n")
    click.echo(f"{'#':<4}{'파일':<40}{'판정':<22}{'문자':>7}{'의미':>7}{'포함':>7}  {'수정일':<19}")
    for r in rows:
        f = lambda x: f"{x * 100:5.1f}%" if x is not None else "    -"
        click.echo(f"{(r.rank_sim if sort_by == 'sim' else r.rank_date):<4}{r.path[:39]:<40}{(r.label + (' ' + r.direction if r.direction else ''))[:21]:<22}"
                   f"{f(r.jaccard):>7}{f(r.cosine):>7}{f(r.containment):>7}  {r.mtime.replace('T', ' ')}")
    for x in res.skipped[:10]:
        click.echo(f"  ! {x}", err=True)


# ───────────────────────────── Phase 5: eval ─────────────────────────────


@main.command("eval")
@click.argument("pairs", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "out_dir", type=click.Path(), required=True, help="리포트 출력 디렉터리")
@_ENGINE_OPT
@click.option("--seed", type=int, default=None, help="재현용 seed (리포트에 기록)")
@click.pass_context
def eval_cmd(ctx: click.Context, pairs: str, out_dir: str, engine: str, seed: int | None) -> None:
    """페어 데이터셋(jsonl) 평가 → 리포트 4종 (분포 / ROC·PR / FPR별 임계값 / 엔진별 고유 검출)."""
    from docsim.eval.harness import run

    rep = run(pairs, out_dir, _load_cfg(ctx), engine, seed)
    for w in rep["warnings"]:
        click.echo(f"⚠ {w}", err=True)
    click.echo((Path(out_dir) / "report.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    _cli_entry()
