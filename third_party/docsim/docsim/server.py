"""선택적 HTTP 서버 (표준 라이브러리만 사용, 폐쇄망 고려).

  GET  /              브라우저용 비교 UI — 파일 선택(txt/md/docx/pdf/hwpx/hwp) 또는 텍스트, 진행률 표시
  POST /jobs          비교 작업 시작 (multipart file_a/file_b 또는 a/b 텍스트, engine) → {"job_id"}
  GET  /jobs/<id>     진행 상태 {"state","stage","percent","detail","elapsed_sec", "result": {...}}
  POST /compare       동기 비교 (JSON {"a","b","engine"} 또는 multipart) → 비교 결과 + 판정 JSON
  POST /fingerprint   JSON {"text","doc_id"} 또는 multipart(file) → 지문 JSON (원문 미포함)
  GET  /health        상태

업로드 파일은 임시 파일로 추출한 뒤 즉시 삭제한다. 원문은 로그/디스크에 남기지 않는다 (R10).
작업 결과(렌더된 HTML/JSON)는 메모리에 server.job_ttl_sec 동안만 보관한다.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

from docsim.core.config import Config
from docsim.core.errors import DocsimError, ExtractError
from docsim.core.extract import SUPPORTED_SUFFIXES, extract_text
from docsim.core.schema import fingerprint_to_dict
from docsim.pipeline import Pipeline, compare_fingerprints
from docsim.report.render import render_text, result_to_dict
from docsim.report.verdict import judge
from docsim.search import FolderFingerprinter, scan_folder, search as folder_search
from docsim.server_ui import render_error, render_help, render_page, render_result, render_search_result

log = logging.getLogger("docsim.server")

_ACCEPT = ",".join(sorted(SUPPORTED_SUFFIXES))

# 단계별 진행률 구간 (%)
_STAGES = {"extract_a": (2, 30), "extract_b": (2, 30), "fp_a": (30, 60), "fp_b": (60, 90), "compare": (90, 100)}


@dataclass
class Job:
    id: str
    state: str = "running"          # running | done | error
    stage: str = "queued"
    percent: float = 0.0
    detail: str = "대기 중"
    started: float = field(default_factory=time.perf_counter)
    finished: float | None = None
    result_html: str | None = None
    result_json: dict | None = None
    error: str | None = None

    def snapshot(self) -> dict:
        end = self.finished or time.perf_counter()
        d = {"job_id": self.id, "state": self.state, "stage": self.stage, "percent": round(self.percent, 1),
             "detail": self.detail, "elapsed_sec": round(end - self.started, 2)}
        if self.state == "done":
            d["result"] = {"html": self.result_html, "json": self.result_json}
        if self.state == "error":
            d["error"] = self.error
        return d


class _State:
    def __init__(self, cfg: Config, engine: str):
        self.cfg = cfg
        self.engine = engine
        self.pipe = Pipeline.start(cfg, engine)     # R4/R5/R6 게이트는 여기서 실행된다
        self.lock = threading.Lock()                # 모델 인코딩 직렬화
        self.jobs: dict[str, Job] = {}
        self.jobs_lock = threading.Lock()
        self.job_ttl = float(cfg.get("server.job_ttl_sec"))
        # 지문 캐시: hash_norm → Fingerprint. 원문은 저장하지 않는다 (R10). 같은 문서를 반복 비교할 때 인코딩을 건너뛴다.
        self.fp_cache: "OrderedDict[str, object]" = OrderedDict()
        self.fp_cache_max = int(cfg.get("server.fingerprint_cache_size"))

    def _fingerprint_cached(self, text: str, name: str, progress=None):
        from dataclasses import replace

        from docsim.core.normalize import hash_norm, normalize
        key = hash_norm(normalize(text))
        hit = self.fp_cache.get(key)
        if hit is not None:
            self.fp_cache.move_to_end(key)
            if progress:
                progress("embed", 1.0, "캐시된 지문 재사용")
            return replace(hit, doc_id=name)
        fp = self.pipe.fingerprint_text(text, name, progress)
        if self.fp_cache_max > 0:
            self.fp_cache[key] = fp
            while len(self.fp_cache) > self.fp_cache_max:
                self.fp_cache.popitem(last=False)
        return fp

    # ───────── 동기 비교 ─────────

    def compare_texts(self, a: str, b: str, engine: str, name_a: str = "A", name_b: str = "B", progress=None):
        # 지문 생성 내부 단계 가중치: normalize 0~2%, shingle 2~10%, embed 10~100%
        weights = {"normalize": (0.0, 0.02), "shingle": (0.02, 0.10), "embed": (0.10, 1.0)}

        def sub(key):
            if progress is None:
                return None
            lo, hi = _STAGES[key]

            def cb(stage, frac, detail):
                w0, w1 = weights.get(stage, (0.0, 1.0))
                progress(lo + (hi - lo) * (w0 + (w1 - w0) * frac), detail)
            return cb

        with self.lock:
            fa = self._fingerprint_cached(a, name_a, sub("fp_a"))
            fb = self._fingerprint_cached(b, name_b, sub("fp_b"))
        if progress:
            progress(_STAGES["compare"][0], "두 엔진 비교")
        r = compare_fingerprints(fa, fb, self.cfg, engine)
        return r, fa, fb, judge(r, fa, fb, self.cfg)

    # ───────── 비동기 작업 ─────────

    def _gc(self) -> None:
        now = time.perf_counter()
        with self.jobs_lock:
            for k in [k for k, j in self.jobs.items() if j.finished and now - j.finished > self.job_ttl]:
                del self.jobs[k]

    def start_job(self, form: dict, engine: str, kind: str = "compare") -> Job:
        self._gc()
        job = Job(id=uuid.uuid4().hex[:12])
        with self.jobs_lock:
            self.jobs[job.id] = job
        target = self._run_search_job if kind == "search" else self._run_job
        threading.Thread(target=target, args=(job, form, engine), daemon=True).start()
        return job

    def _run_search_job(self, job: Job, form: dict, engine: str) -> None:
        """질의 파일 1개 vs 폴더 — 유사도순/날짜순 목록."""
        def set_progress(pct, detail, stage=None):
            job.percent = max(job.percent, min(100.0, pct))
            job.detail = detail
            if stage:
                job.stage = stage

        def _field(name, default=""):
            return form.get(name, (None, default.encode()))[1].decode("utf-8", errors="replace").strip()

        try:
            folder = _field("folder")
            if not folder:
                raise ExtractError("폴더 경로를 입력하십시오 (서버가 실행되는 컴퓨터의 경로)")
            recursive = _field("recursive") in ("1", "on", "true")
            hide_unrelated = _field("hide_unrelated") in ("1", "on", "true")
            top = int(_field("top") or self.cfg.get("search.default_top"))
            set_progress(2, "폴더 스캔", "extract")
            files = scan_folder(folder, recursive, int(self.cfg.get("search.max_files")))
            if not files:
                raise ExtractError(f"폴더에 지원 포맷 파일이 없습니다: {folder}")
            set_progress(4, f"{len(files)} 파일 발견 · 질의 문서 추출", "extract")
            q_text, q_name = _doc_from_form(form, "file", "text", "질의", self.cfg,
                                            lambda st, fr, d: set_progress(4 + 8 * fr, f"질의 문서: {d}", "extract"))
            set_progress(12, "질의 문서 지문 생성", "fingerprint")
            with self.lock:
                q_fp = self._fingerprint_cached(q_text, q_name, lambda st, fr, d: set_progress(12 + 8 * fr, d, "fingerprint"))
            ff = FolderFingerprinter(self.cfg, self.pipe, lock=self.lock)
            res = folder_search(q_fp, q_name, folder, files, ff, self.cfg, engine,
                                progress=lambda fr, d: set_progress(20 + 76 * fr, f"폴더 비교 {d}", "compare"),
                                hide_unrelated=hide_unrelated)
            res.rows = res.rows[:top] if top > 0 else res.rows
            set_progress(97, "결과 렌더링", "render")
            job.result_json = res.as_dict()
            job.result_html = render_search_result(res)
            job.percent, job.detail, job.stage, job.state = 100.0, f"완료 — {res.n_files} 파일 중 {len(res.rows)} 표시", "done", "done"
        except DocsimError as e:
            job.state, job.stage, job.error, job.detail = "error", "error", f"{type(e).__name__}: {e}", "오류"
        except Exception as e:  # noqa: BLE001
            log.exception("search job failed")
            job.state, job.stage, job.error, job.detail = "error", "error", f"{type(e).__name__}: {e}", "오류"
        finally:
            job.finished = time.perf_counter()

    def _run_job(self, job: Job, form: dict, engine: str) -> None:
        def set_progress(pct: float, detail: str, stage: str | None = None):
            job.percent = max(job.percent, min(100.0, pct))
            job.detail = detail
            if stage:
                job.stage = stage

        def extract_progress(key, label):
            lo, hi = _STAGES[key]
            return lambda stage, frac, detail: set_progress(lo + (hi - lo) * frac, f"문서 {label}: {detail}", "extract")

        try:
            set_progress(_STAGES["extract_a"][0], "문서 A / B 텍스트 추출 (병렬)", "extract")
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=2) as ex:
                fa_ = ex.submit(_doc_from_form, form, "file_a", "a", "A", self.cfg, extract_progress("extract_a", "A"))
                fb_ = ex.submit(_doc_from_form, form, "file_b", "b", "B", self.cfg, extract_progress("extract_b", "B"))
                (a, na), (b, nb) = fa_.result(), fb_.result()
            set_progress(_STAGES["fp_a"][0], "지문 생성 대기 (모델 큐)", "fingerprint")
            r, fa, fb, v = self.compare_texts(a, b, engine, na, nb,
                                              progress=lambda pct, detail: set_progress(pct, detail, "fingerprint" if pct < 90 else "compare"))
            set_progress(96, "결과 렌더링", "render")
            text_report = render_text(r, fa, fb, v)
            js = result_to_dict(r, v)
            job.result_json = js
            job.result_html = render_result(r, fa, fb, v, text_report, json.dumps(js, ensure_ascii=False, indent=2))
            job.percent, job.detail, job.stage, job.state = 100.0, "완료", "done", "done"
        except DocsimError as e:
            job.state, job.stage, job.error, job.detail = "error", "error", f"{type(e).__name__}: {e}", "오류"
        except Exception as e:  # noqa: BLE001
            log.exception("job failed")
            job.state, job.stage, job.error, job.detail = "error", "error", f"{type(e).__name__}: {e}", "오류"
        finally:
            job.finished = time.perf_counter()

    def get_job(self, job_id: str) -> Job | None:
        with self.jobs_lock:
            return self.jobs.get(job_id)


def _text_from_upload(filename: str, data: bytes, cfg, progress=None) -> str:
    """업로드 바이트 → 텍스트. 임시 파일로 추출하고 즉시 삭제한다 (R10)."""
    suffix = Path(filename).suffix.lower() or ".txt"
    if suffix not in SUPPORTED_SUFFIXES:
        raise ExtractError(f"지원하지 않는 형식: {suffix} (지원: {_ACCEPT})")
    fd, tmp = tempfile.mkstemp(suffix=suffix, prefix="docsim-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return extract_text(tmp, cfg, progress)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _parse_multipart(content_type: str, body: bytes) -> dict[str, tuple[str | None, bytes]]:
    """name → (filename, bytes). 표준 라이브러리 email 파서 사용."""
    msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
    out: dict[str, tuple[str | None, bytes]] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True) or b""
        out[str(name)] = (part.get_filename(), payload)
    return out


def _doc_from_form(form: dict, file_key: str, text_key: str, label: str, cfg, progress=None) -> tuple[str, str]:
    """(텍스트, 표시 이름). 파일이 있으면 파일, 없으면 텍스트."""
    fname, data = form.get(file_key, (None, b""))
    if fname and data:
        return _text_from_upload(fname, data, cfg, progress), Path(fname).stem
    _, tdata = form.get(text_key, (None, b""))
    text = tdata.decode("utf-8", errors="replace")
    if not text.strip():
        raise ExtractError(f"문서 {label}: 파일을 선택하거나 텍스트를 입력하십시오")
    return text, label


def make_handler(state: _State):
    class Handler(BaseHTTPRequestHandler):
        server_version = "docsim/0.1"

        def log_message(self, fmt, *args):  # 요청 본문/원문/파일명은 로그에 남기지 않는다 (R10)
            p = self.path.split("?")[0]
            if not p.startswith("/jobs/"):
                log.info("%s %s", self.command, p)

        def _send(self, code: int, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj):
            self._send(code, json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8"), "application/json; charset=utf-8")

        def _page(self, a="", b="", engine="both", result=""):
            emb = state.pipe.embed_engine
            body = render_page(model=str(state.cfg.get("embed.model_id")), norm=str(state.cfg.get("norm_version")),
                               mu=(emb.mu_version if emb is not None else "-"), accept=_ACCEPT, a=a, b=b, engine=engine, result=result)
            self._send(200, body.encode("utf-8"), "text/html; charset=utf-8")

        def _read_body(self) -> bytes:
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _form(self, raw: bytes) -> dict[str, tuple[str | None, bytes]]:
            ctype = self.headers.get("Content-Type", "")
            if ctype.startswith("multipart/form-data"):
                return _parse_multipart(ctype, raw)
            if ctype.startswith("application/json"):
                d = json.loads(raw or b"{}")
                return {k: (None, str(v).encode("utf-8")) for k, v in d.items()}
            return {k: (None, v[0].encode("utf-8")) for k, v in parse_qs(raw.decode("utf-8"), keep_blank_values=True).items()}

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/health":
                emb = state.pipe.embed_engine
                self._json(200, {
                    "status": "ok", "engine": state.engine, "norm_version": state.cfg.get("norm_version"),
                    "model_id": state.cfg.get("embed.model_id") if emb else None,
                    "max_seq_length": emb.lm.max_seq_length if emb else None,
                    "mu_version": emb.mu_version if emb else None,
                    "verdict_enabled": bool(state.cfg.get("verdict.enabled")),
                    "jobs_running": sum(1 for j in state.jobs.values() if j.state == "running"),
                })
            elif path.startswith("/jobs/"):
                job = state.get_job(path[len("/jobs/"):])
                if job is None:
                    self._json(404, {"error": "unknown job"})
                else:
                    self._json(200, job.snapshot())
            elif path == "/help":
                doc = Path(__file__).resolve().parents[1] / "docs" / "DEVELOPER.md"
                md = doc.read_text(encoding="utf-8") if doc.is_file() else "# 도움말\n\ndocs/DEVELOPER.md 가 없습니다."
                self._send(200, render_help(md).encode("utf-8"), "text/html; charset=utf-8")
            elif path == "/":
                self._page()
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            raw = self._read_body()
            try:
                form = self._form(raw)
                engine = form.get("engine", (None, state.engine.encode()))[1].decode("utf-8") or state.engine
                if path == "/jobs":
                    kind = form.get("kind", (None, b"compare"))[1].decode("utf-8") or "compare"
                    job = state.start_job(form, engine, kind)
                    self._json(202, job.snapshot())
                elif path == "/compare":
                    a, na = _doc_from_form(form, "file_a", "a", "A", state.cfg)
                    b, nb = _doc_from_form(form, "file_b", "b", "B", state.cfg)
                    r, _, _, v = state.compare_texts(a, b, engine, na, nb)
                    self._json(200, result_to_dict(r, v))
                elif path == "/fingerprint":
                    text, name = _doc_from_form(form, "file", "text", "doc", state.cfg)
                    _, did = form.get("doc_id", (None, b""))
                    with state.lock:
                        fp = state.pipe.fingerprint_text(text, did.decode("utf-8") or name)
                    self._json(200, fingerprint_to_dict(fp))
                elif path == "/":
                    # JS 없는 클라이언트용 동기 폼
                    try:
                        a, na = _doc_from_form(form, "file_a", "a", "A", state.cfg)
                        b, nb = _doc_from_form(form, "file_b", "b", "B", state.cfg)
                    except ExtractError as e:
                        self._page(engine=engine, result=render_error(str(e)))
                        return
                    r, fa, fb, v = state.compare_texts(a, b, engine, na, nb)
                    text_report = render_text(r, fa, fb, v)
                    json_report = json.dumps(result_to_dict(r, v), ensure_ascii=False, indent=2)
                    self._page(engine=engine, result=render_result(r, fa, fb, v, text_report, json_report))
                else:
                    self._json(404, {"error": "not found"})
            except DocsimError as e:
                if path == "/":
                    self._page(result=render_error(f"{type(e).__name__}: {e}"))
                else:
                    self._json(400, {"error": type(e).__name__, "message": str(e)})
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as e:
                self._json(400, {"error": "BadRequest", "message": str(e)})

    return Handler


def serve(cfg: Config, host: str, port: int, engine: str) -> None:
    state = _State(cfg, engine)
    httpd = ThreadingHTTPServer((host, port), make_handler(state))
    emb = state.pipe.embed_engine
    print(f"docsim 서버 기동: http://{host}:{port}/  engine={engine}"
          + (f"  model={emb.model_id} max_seq_length={emb.lm.max_seq_length} mu={emb.mu_version}" if emb else ""), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
