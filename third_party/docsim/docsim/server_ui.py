"""웹 UI 렌더링 — 인라인 CSS/SVG 만 사용 (폐쇄망, 외부 리소스 없음). 서버 로직은 server.py."""

from __future__ import annotations

import html

from docsim.core.schema import CompareResult, Fingerprint

_CSS = """
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2430;--muted:#6b7480;--line:#e3e6ea;--a:#2563eb;--b:#7c3aed;--c:#0d9488;--ok:#15803d;--warn:#b45309;--bad:#9ca3af}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:14px}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:22px}
header h1{font-size:22px;margin:0;letter-spacing:-.3px}header h1 span{color:var(--muted);font-weight:400;font-size:14px;margin-left:10px}
.meta{color:var(--muted);font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.drop{border:1.5px dashed #c9ced6;border-radius:12px;padding:16px;background:#fafbfc}
.drop h3{margin:0 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.drop input[type=file]{width:100%;font-size:13px}
details{margin-top:8px}details summary{cursor:pointer;color:var(--muted);font-size:12px}
textarea{width:100%;height:7rem;margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:13px;font-family:inherit}
.actions{display:flex;align-items:center;gap:14px;margin-top:16px}
select{border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13px;background:#fff}
button{background:var(--ink);color:#fff;border:0;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer}button:hover{opacity:.9}
.note{color:var(--muted);font-size:12px}
.verdict{margin-top:18px;display:flex;gap:18px;align-items:flex-start;border-left:6px solid var(--ok)}
.verdict.mid{border-left-color:var(--warn)}.verdict.low{border-left-color:var(--bad)}
.verdict .lab{font-size:20px;font-weight:700;letter-spacing:-.2px}.verdict .sum{margin-top:6px;line-height:1.55}
.chip{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;background:#eef2ff;color:#3730a3;margin-left:8px;vertical-align:middle}
.chip.dir{background:#ecfdf5;color:#065f46}
.gauges{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px}
.gauge{text-align:center;padding:18px 10px 14px}
.gauge svg{width:150px;height:150px;display:block;margin:0 auto}
.gauge .val{font-size:26px;font-weight:700;letter-spacing:-.5px}.gauge .val small{font-size:14px;font-weight:600;color:var(--muted)}
.gauge .name{margin-top:8px;font-weight:600}.gauge .sub{color:var(--muted);font-size:12px;margin-top:2px}
.engines{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.eng h3{margin:0 0 12px;font-size:14px;display:flex;align-items:center;gap:8px}
.eng h3 i{display:inline-block;width:10px;height:10px;border-radius:3px}
table.kv{width:100%;border-collapse:collapse}table.kv td{padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
table.kv td:first-child{color:var(--muted);width:46%}table.kv td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
table.kv tr:last-child td{border-bottom:0}
.docs{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.doc .id{font-weight:700;word-break:break-all}.doc .st{color:var(--muted);font-size:12px;margin-top:4px}
.warn{margin-top:16px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:12px;padding:12px 16px;font-size:13px}
.warn li{margin:2px 0}
pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:12px;overflow-x:auto;font-size:12px;white-space:pre-wrap;line-height:1.45}
.err{margin-top:18px;border-left:6px solid #dc2626;color:#991b1b}
.prog{margin-top:18px}.prog .top{display:flex;justify-content:space-between;align-items:baseline;font-size:13px}
.prog .stage{font-weight:700}.prog .pct{font-variant-numeric:tabular-nums;color:var(--muted)}
.bar{height:10px;background:#edf0f3;border-radius:999px;overflow:hidden;margin:10px 0 8px}
.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:999px;transition:width .25s ease}
.prog .detail{color:var(--muted);font-size:12px;min-height:16px}
.steps{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.steps span{font-size:11px;padding:2px 8px;border-radius:999px;background:#f1f3f6;color:#8a929c}
.steps span.on{background:#e0e7ff;color:#3730a3;font-weight:600}.steps span.ok{background:#dcfce7;color:#166534}
.tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--line)}
.tabs button{background:none;color:var(--muted);border:0;border-bottom:2px solid transparent;border-radius:0;padding:10px 16px;font-weight:600;font-size:14px}
.tabs button.on{color:var(--ink);border-bottom-color:var(--ink)}
.field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}
.field input[type=text],.field input[type=number]{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:14px;font-family:inherit;color:var(--ink)}
.opts{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:13px;color:var(--muted)}
table.res{width:100%;border-collapse:collapse;font-size:13px}table.res th{text-align:left;color:var(--muted);font-weight:600;padding:8px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
table.res td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}table.res tr:last-child td{border-bottom:0}
table.res td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}table.res .name{font-weight:600;word-break:break-all}
table.res .sub{color:var(--muted);font-size:12px}table.res tr.unrelated td{color:#8a929c}table.res tr.unrelated .name{font-weight:500}
.rel{display:inline-block;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap}
.rel.identical,.rel.revision,.rel.added{background:#dcfce7;color:#166534}.rel.excerpt{background:#e0f2fe;color:#075985}.rel.rewrite{background:#ede9fe;color:#5b21b6}
.rel.partial{background:#fef3c7;color:#92400e}.rel.unrelated,.rel.insufficient{background:#f1f3f6;color:#6b7480}
.sortbar{display:flex;gap:8px;align-items:center;margin:0 0 12px;font-size:13px;color:var(--muted)}
.sortbar button{background:#f1f3f6;color:var(--ink);padding:6px 12px;font-size:13px;border-radius:8px}.sortbar button.on{background:var(--ink);color:#fff}
.mini{height:6px;background:#edf0f3;border-radius:999px;overflow:hidden;width:90px;display:inline-block;vertical-align:middle;margin-left:6px}.mini i{display:block;height:100%;border-radius:999px}
.help{line-height:1.65;font-size:14px}.help h1{font-size:22px;margin:.2em 0 .6em}.help h2{font-size:17px;margin:1.6em 0 .5em;padding-top:.6em;border-top:1px solid var(--line)}
.help h3{font-size:14.5px;margin:1.2em 0 .4em}.help table{border-collapse:collapse;width:100%;font-size:13px;margin:.6em 0}.help th,.help td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
.help th{background:#f6f7f9}.help code{background:#f1f3f6;padding:1px 5px;border-radius:4px;font-size:12.5px}.help pre code{background:none;padding:0}.help pre{font-size:12.5px}
.help ul,.help ol{padding-left:1.4em}.help li{margin:.15em 0}.help hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}.help p{margin:.5em 0}
button[disabled]{opacity:.5;cursor:default}
footer{margin-top:28px;color:var(--muted);font-size:12px}
@media (max-width:760px){.grid2,.gauges,.engines,.docs{grid-template-columns:1fr}}
"""

PAGE = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>docsim</title><style>{css}</style></head><body><div class="wrap">
<header><h1>docsim <span>두 엔진 나란히 문서 비교</span></h1>
<div class="meta">엔진 A shingle · 엔진 B {model} · {norm} · {mu}</div></header>
<div class="tabs"><button type="button" class="on" data-tab="cmp">두 문서 비교</button><button type="button" data-tab="srch">폴더에서 유사 문서 찾기</button><button type="button" data-tab="help">도움말</button></div>
<form class="card" id="cmp" method="post" action="/" enctype="multipart/form-data">
<div class="grid2">
<div class="drop"><h3>문서 A</h3><input type="file" name="file_a" accept="{accept}">
<details><summary>또는 텍스트 붙여넣기</summary><textarea name="a" placeholder="파일을 선택하지 않았을 때만 사용">{a}</textarea></details></div>
<div class="drop"><h3>문서 B</h3><input type="file" name="file_b" accept="{accept}">
<details><summary>또는 텍스트 붙여넣기</summary><textarea name="b" placeholder="파일을 선택하지 않았을 때만 사용">{b}</textarea></details></div>
</div>
<div class="actions"><label class="note">엔진 <select name="engine"><option {both}>both</option><option {shingle}>shingle</option><option {embed}>embed</option></select></label>
<button type="submit" id="go">비교하기</button><span class="note">지원 {accept} · 파일은 비교 직후 삭제되며 서버에 남지 않습니다</span></div>
</form>
<form class="card" id="srch" hidden enctype="multipart/form-data">
<input type="hidden" name="kind" value="search">
<div class="grid2">
<div class="drop"><h3>찾을 문서 (질의)</h3><input type="file" name="file" accept="{accept}">
<details><summary>또는 텍스트 붙여넣기</summary><textarea name="text" placeholder="파일을 선택하지 않았을 때만 사용"></textarea></details></div>
<div class="drop"><h3>검색할 폴더</h3><label class="field">서버 컴퓨터의 폴더 경로<input type="text" name="folder" id="folder" placeholder="/Users/me/Documents/공문" autocomplete="off"></label>
<div class="opts"><label><input type="checkbox" name="recursive" value="1" checked> 하위 폴더 포함</label>
<label><input type="checkbox" name="hide_unrelated" value="1"> '무관' 숨김</label>
<label>표시 <input type="number" name="top" value="30" min="1" max="500" style="width:70px"> 건</label></div></div>
</div>
<div class="actions"><label class="note">엔진 <select name="engine"><option selected>both</option><option>shingle</option><option>embed</option></select></label>
<button type="submit" id="go2">유사 문서 찾기</button><span class="note">폴더 파일의 지문은 캐시되어 두 번째부터 빠릅니다 (원문은 저장하지 않음)</span></div>
</form>
<div class="card prog" id="prog" hidden>
<div class="top"><span class="stage" id="p-stage">준비</span><span class="pct"><span id="p-pct">0</span>% · <span id="p-el">0.0</span>s</span></div>
<div class="bar"><i id="p-bar"></i></div><div class="detail" id="p-detail"></div>
<div class="steps"><span data-k="upload">업로드</span><span data-k="extract">텍스트 추출 / OCR</span><span data-k="fingerprint">지문 생성 (엔진 A · B)</span><span data-k="compare">비교</span><span data-k="render">판정</span></div>
</div>
<div id="result">{result}</div>
<footer>API · <code>POST /compare</code> (multipart file_a, file_b 또는 JSON a, b) · <code>POST /fingerprint</code> · <code>GET /health</code></footer>
</div>
<script>
(function(){{
  var prog=document.getElementById('prog'),res=document.getElementById('result');
  document.querySelectorAll('.tabs button').forEach(function(b){{b.addEventListener('click',function(){{
    document.querySelectorAll('.tabs button').forEach(function(x){{x.className='';}});b.className='on';
    document.getElementById('cmp').hidden=b.dataset.tab!=='cmp';document.getElementById('srch').hidden=b.dataset.tab!=='srch';
    res.innerHTML='';prog.hidden=true;try{{localStorage.setItem('docsim.tab',b.dataset.tab);}}catch(_){{}}
    if(b.dataset.tab==='help'){{res.innerHTML='<div class="card note">도움말 불러오는 중…</div>';fetch('/help').then(function(r){{return r.text();}}).then(function(h){{res.innerHTML=h;}});}}
  }});}});
  try{{var savedTab=localStorage.getItem('docsim.tab');if(savedTab&&savedTab!=='cmp')document.querySelector('.tabs button[data-tab='+savedTab+']').click();
      var f=localStorage.getItem('docsim.folder');if(f)document.getElementById('folder').value=f;}}catch(_){{}}
  var go=null;
  var bar=document.getElementById('p-bar'),pct=document.getElementById('p-pct'),st=document.getElementById('p-stage'),dt=document.getElementById('p-detail'),el=document.getElementById('p-el');
  var order=['upload','extract','fingerprint','compare','render'],t0=0,timer=null;
  function setStage(k){{document.querySelectorAll('.steps span').forEach(function(s){{var i=order.indexOf(s.dataset.k),j=order.indexOf(k);s.className=i<j?'ok':(i===j?'on':'');}});}}
  function show(p,stage,detail){{bar.style.width=p+'%';pct.textContent=p.toFixed(0);st.textContent=stage;dt.textContent=detail||'';}}
  function tick(){{el.textContent=((performance.now()-t0)/1000).toFixed(1);}}
  var names={{extract:'텍스트 추출',fingerprint:'지문 생성',compare:'비교',render:'판정·렌더링',done:'완료',error:'오류',queued:'대기'}};
  ['cmp','srch'].forEach(function(id){{var form=document.getElementById(id);form.addEventListener('submit',function(ev){{
    if(!window.FormData||!window.XMLHttpRequest)return; ev.preventDefault();
    go=form.querySelector('button[type=submit]');
    var fd=new FormData(form);go.disabled=true;prog.hidden=false;res.innerHTML='';t0=performance.now();clearInterval(timer);timer=setInterval(tick,100);
    try{{if(id==='srch')localStorage.setItem('docsim.folder',document.getElementById('folder').value);}}catch(_){{}}
    setStage('upload');show(0,'업로드','파일 전송 중');
    var xhr=new XMLHttpRequest();xhr.open('POST','/jobs');
    xhr.upload.onprogress=function(e){{if(e.lengthComputable)show(e.loaded/e.total*2,'업로드',(e.loaded/1024).toFixed(0)+' KB / '+(e.total/1024).toFixed(0)+' KB');}};
    xhr.onerror=function(){{fail('네트워크 오류');}};
    xhr.onload=function(){{ if(xhr.status>=300){{try{{fail(JSON.parse(xhr.responseText).message);}}catch(_){{fail('HTTP '+xhr.status);}}return;}} poll(JSON.parse(xhr.responseText).job_id); }};
    xhr.send(fd);
  }});}});
  window.sortRows=function(key,btn){{var tb=document.getElementById('srows');if(!tb)return;var rows=Array.prototype.slice.call(tb.rows);
    rows.sort(function(a,b){{return (+a.dataset[key])-(+b.dataset[key]);}});rows.forEach(function(r,i){{r.cells[0].textContent=i+1;tb.appendChild(r);}});
    document.querySelectorAll('.sortbar button').forEach(function(x){{x.className='';}});btn.className='on';}};
  function poll(id){{
    fetch('/jobs/'+id,{{cache:'no-store'}}).then(function(r){{return r.json();}}).then(function(j){{
      var stage=j.stage==='done'?'render':j.stage; setStage(j.state==='done'?'render':stage);
      show(j.percent,names[j.stage]||j.stage,j.detail);
      if(j.state==='running'){{setTimeout(function(){{poll(id);}},250);return;}}
      clearInterval(timer);tick();go.disabled=false;
      if(j.state==='done'){{document.querySelectorAll('.steps span').forEach(function(s){{s.className='ok';}});res.innerHTML=j.result.html;prog.querySelector('.stage').textContent='완료';}}
      else fail(j.error||'알 수 없는 오류');
    }}).catch(function(e){{fail(String(e));}});
  }}
  function fail(msg){{clearInterval(timer);go.disabled=false;show(100,'오류',msg);bar.style.background='#dc2626';res.innerHTML='<div class="card verdict err"><div><div class="lab">오류</div><div class="sum"></div></div></div>';res.querySelector('.sum').textContent=msg;}}
}})();
</script>
</body></html>"""


def _pct(x: float | None) -> float:
    if x is None:
        return 0.0
    return max(0.0, min(1.0, x)) * 100.0


def _ring(name: str, sub: str, value: float | None, color: str) -> str:
    p = _pct(value)
    r = 62
    circ = 2 * 3.141592653589793 * r
    dash = circ * p / 100.0
    txt = f"{p:.1f}<small>%</small>" if value is not None else "<small>-</small>"
    return f"""<div class="card gauge">
<svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="{r}" fill="none" stroke="#edf0f3" stroke-width="12"/>
<circle cx="75" cy="75" r="{r}" fill="none" stroke="{color}" stroke-width="12" stroke-linecap="round"
 stroke-dasharray="{dash:.2f} {circ:.2f}" transform="rotate(-90 75 75)"/>
<text x="75" y="75" text-anchor="middle" dominant-baseline="central" class="val" font-size="26" font-weight="700" fill="#1c2430">{p:.1f}<tspan font-size="14" fill="#6b7480">%</tspan></text></svg>
<div class="name">{html.escape(name)}</div><div class="sub">{html.escape(sub)}</div></div>"""


def _kv(rows: list[tuple[str, str]]) -> str:
    return '<table class="kv">' + "".join(f"<tr><td>{html.escape(k)}</td><td>{html.escape(v)}</td></tr>" for k, v in rows) + "</table>"


def _doc(label: str, fp: Fingerprint) -> str:
    st = [f"정규화 {fp.norm_len:,}자"]
    if fp.shingle:
        st.append(f"슁글 {fp.shingle.shingle_count:,}")
    if fp.embed:
        st.append(f"청크 {len(fp.embed.chunks)}")
    return f'<div class="card doc"><div class="note">문서 {label}</div><div class="id">{html.escape(fp.doc_id)}</div><div class="st">{" · ".join(st)}</div></div>'


def render_result(r: CompareResult, fa: Fingerprint, fb: Fingerprint, verdict, text_report: str, json_report: str) -> str:
    parts: list[str] = []
    if verdict is not None:
        cls = {"높음": "", "중간": " mid", "낮음": " low"}.get(verdict.confidence, "")
        chips = f'<span class="chip">신뢰도 {html.escape(verdict.confidence)}</span>'
        if verdict.direction:
            chips += f'<span class="chip dir">방향 {html.escape(verdict.direction)}</span>'
        parts.append(f'<div class="card verdict{cls}"><div><div class="lab">{html.escape(verdict.label)}{chips}</div>'
                     f'<div class="sum">{html.escape(verdict.summary)}</div>'
                     f'<div class="note" style="margin-top:8px">규칙 {html.escape(" / ".join(verdict.basis))} · 두 엔진 수치의 규칙 해석이며 합산 점수가 아닙니다</div></div></div>')
    elif r.identical:
        parts.append('<div class="card verdict"><div class="lab">동일 문서</div></div>')

    s, e = r.shingle, r.embed
    cont = max(s.containment_a_in_b, s.containment_b_in_a) if s else None
    parts.append('<div class="gauges">'
                 + _ring("문자 유사도", "엔진 A · 자카드 (조각 일치율)", s.jaccard if s else None, "#2563eb")
                 + _ring("의미 비교", "엔진 B · 최대 코사인 (청크 max)", e.max_cosine if e else None, "#7c3aed")
                 + _ring("포함도", "엔진 A · max(A⊆B, B⊆A)", cont, "#0d9488")
                 + "</div>")

    eng: list[str] = []
    if s:
        eng.append('<div class="card eng"><h3><i style="background:#2563eb"></i>엔진 A · 조각 맞추기 (shingle)</h3>' + _kv([
            ("자카드 (MinHash 추정)", f"{s.jaccard:.3f}  ± {s.jaccard_stderr:.3f}"),
            ("포함도 A ⊆ B", f"{s.containment_a_in_b * 100:.1f}%"),
            ("포함도 B ⊆ A", f"{s.containment_b_in_a * 100:.1f}%"),
            ("추정 교집합", f"{s.estimated_intersection:,} 조각"),
            ("슁글 수 A / B", f"{fa.shingle.shingle_count:,} / {fb.shingle.shingle_count:,}" if fa.shingle and fb.shingle else "-"),
            ("DF 테이블", fa.shingle.df_version if fa.shingle and fa.shingle.df_version else "미적용"),
        ]) + "</div>")
    if e:
        top = " · ".join(f"A{p.a_index}↔B{p.b_index} {p.cosine:.3f}" for p in e.top_pairs[:3]) or "-"
        eng.append('<div class="card eng"><h3><i style="background:#7c3aed"></i>엔진 B · 뜻 비교 (embed)</h3>' + _kv([
            ("최대 코사인", f"{e.max_cosine:.3f}"),
            ("상위 청크쌍", top),
            ("비교 청크쌍", f"{e.chunks_compared:,}"),
            ("서식 청크 제외", f"{e.boilerplate_excluded}"),
            ("청크 수 A / B", f"{len(fa.embed.chunks)} / {len(fb.embed.chunks)}" if fa.embed and fb.embed else "-"),
            ("모델 / max_seq", f"{fa.embed.model_id.split('/')[-1]} / {fa.embed.max_seq_length}" if fa.embed else "-"),
        ]) + "</div>")
    if eng:
        parts.append('<div class="engines">' + "".join(eng) + "</div>")

    parts.append('<div class="docs">' + _doc("A", fa) + _doc("B", fb) + "</div>")
    if r.warnings:
        parts.append('<div class="warn"><b>경고</b><ul>' + "".join(f"<li>{html.escape(w)}</li>" for w in r.warnings) + "</ul></div>")
    parts.append(f'<details style="margin-top:16px"><summary>텍스트 리포트</summary><pre>{html.escape(text_report)}</pre></details>')
    parts.append(f'<details><summary>JSON</summary><pre>{html.escape(json_report)}</pre></details>')
    return "".join(parts)


def render_error(msg: str) -> str:
    return f'<div class="card verdict err"><div><div class="lab">오류</div><div class="sum">{html.escape(msg)}</div></div></div>'


def render_page(*, model: str, norm: str, mu: str, accept: str, a: str = "", b: str = "", engine: str = "both", result: str = "") -> str:
    return PAGE.format(
        css=_CSS, model=html.escape(model), norm=html.escape(norm), mu=html.escape(mu), accept=accept,
        a=html.escape(a), b=html.escape(b), result=result,
        both="selected" if engine == "both" else "", shingle="selected" if engine == "shingle" else "",
        embed="selected" if engine == "embed" else "",
    )


def _pct_cell(v: float | None, color: str) -> str:
    if v is None:
        return '<td class="num">-</td>'
    p = _pct(v)
    return f'<td class="num">{p:.1f}%<span class="mini"><i style="width:{p:.0f}%;background:{color}"></i></span></td>'


def _fmt_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def render_search_result(res) -> str:
    head = (f'<div class="card" style="margin-top:18px"><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">'
            f'<div><b>{html.escape(res.query)}</b> <span class="note">↔ {html.escape(res.folder)}</span></div>'
            f'<div class="note">{res.n_files} 파일 스캔 · 캐시 {res.n_cached} · 표시 {len(res.rows)}' + (f' · 추출 실패 {len(res.skipped)}' if res.skipped else '') + '</div></div>')
    sortbar = ('<div class="sortbar" style="margin-top:12px">정렬 <button type="button" class="on" onclick="sortRows(\'sim\',this)">유사도순</button>'
               '<button type="button" onclick="sortRows(\'date\',this)">날짜순 (최신 먼저)</button>'
               '<span class="note">유사도순 = 판정 우선순위 → 수치. 합산 점수는 없습니다</span></div>')
    rows = []
    for r in res.rows:
        cls = "unrelated" if r.relation in ("unrelated", "insufficient") else ""
        arrow = f' <span class="sub">{html.escape(r.direction)}</span>' if r.direction else ""
        rows.append(
            f'<tr class="{cls}" data-sim="{r.rank_sim}" data-date="{r.rank_date}">'
            f'<td class="num">{r.rank_sim}</td>'
            f'<td><div class="name">{html.escape(r.name)}</div><div class="sub">{html.escape(r.path)}</div></td>'
            f'<td><span class="rel {r.relation}">{html.escape(r.label)}</span>{arrow}<div class="sub">신뢰도 {html.escape(r.confidence)}</div></td>'
            + _pct_cell(r.jaccard, "#2563eb") + _pct_cell(r.cosine, "#7c3aed") + _pct_cell(r.containment, "#0d9488") +
            f'<td class="num">{html.escape(r.mtime.replace("T", " "))}<div class="sub">{_fmt_size(r.size)}</div></td></tr>'
        )
    table = ('<div style="overflow-x:auto"><table class="res"><thead><tr><th>#</th><th>파일</th><th>판정</th>'
             '<th style="text-align:right">문자 유사도</th><th style="text-align:right">의미 비교</th><th style="text-align:right">포함도</th><th style="text-align:right">수정일</th></tr></thead>'
             f'<tbody id="srows">{"".join(rows) or "<tr><td colspan=7 class=note>결과 없음</td></tr>"}</tbody></table></div>')
    skipped = ""
    if res.skipped:
        skipped = '<details style="margin-top:10px"><summary class="note">추출 실패 파일</summary><ul class="note">' + "".join(f"<li>{html.escape(x)}</li>" for x in res.skipped) + "</ul></details>"
    return head + sortbar + table + skipped + "</div>"


# ─────────────────────────── 도움말: 마크다운 → HTML (표준 라이브러리만) ───────────────────────────

import re as _re


def _inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = _re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = _re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = _re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", t)
    return t


def md_to_html(md: str) -> str:
    out: list[str] = []
    lines = md.splitlines()
    i = 0
    in_list: str | None = None

    def close_list():
        nonlocal in_list
        if in_list:
            out.append(f"</{in_list}>")
            in_list = None

    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            close_list()
            j = i + 1
            buf = []
            while j < len(lines) and not lines[j].startswith("```"):
                buf.append(lines[j])
                j += 1
            out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>")
            i = j + 1
            continue
        if ln.startswith("|") and i + 1 < len(lines) and _re.match(r"^\|[\s:|-]+\|$", lines[i + 1]):
            close_list()
            head = [c.strip() for c in ln.strip("|").split("|")]
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].startswith("|"):
                rows.append([c.strip() for c in lines[j].strip("|").split("|")])
                j += 1
            out.append("<table><thead><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table>")
            i = j
            continue
        m = _re.match(r"^(#{1,3})\s+(.*)$", ln)
        if m:
            close_list()
            out.append(f"<h{len(m.group(1))}>{_inline(m.group(2))}</h{len(m.group(1))}>")
        elif _re.match(r"^\s*---+\s*$", ln):
            close_list()
            out.append("<hr>")
        elif _re.match(r"^\s*[-*]\s+", ln):
            if in_list != "ul":
                close_list()
                out.append("<ul>")
                in_list = "ul"
            out.append(f"<li>{_inline(_re.sub(r'^\s*[-*]\s+', '', ln))}</li>")
        elif _re.match(r"^\s*\d+\.\s+", ln):
            if in_list != "ol":
                close_list()
                out.append("<ol>")
                in_list = "ol"
            out.append(f"<li>{_inline(_re.sub(r'^\s*\d+\.\s+', '', ln))}</li>")
        elif not ln.strip():
            close_list()
        else:
            close_list()
            out.append(f"<p>{_inline(ln)}</p>")
        i += 1
    close_list()
    return "".join(out)


def render_help(md: str) -> str:
    return f'<div class="card help" style="margin-top:18px">{md_to_html(md)}</div>'
