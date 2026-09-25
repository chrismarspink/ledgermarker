import React from 'react'

// C. 분류·온톨로지 — (1) BRM 업무분류(brmPath) 트리맵 × 등급 비율,
// (2) 법적 근거(정보공개법 9조 호수) 막대 + 동적 태그(basisKeywords) 공기 네트워크,
// (3) LM 스키마(클래스·관계) 정적 도해 + 데이터에서 만든 JSON-LD 미리보기.
// 원장에 이미 있는 경로형·목록형 필드를 그대로 트리·그래프로 쓴다. 트리플스토어 없음.

const NAVY = '#1a2b4a', OK = '#1e7d46', WARN = '#b07a00', BAD = '#b02a2a'
const MUTED = '#6b7280', LINE = '#e5e7eb', INK = '#111827'
const GRADE_COLOR = { C: BAD, S: WARN, O: OK }
const GRADE_NAME = { C: 'C 비밀', S: 'S 민감', O: 'O 공개' }
// 정보공개법 제9조 제1항 각 호 — 화면 표기용 요약(근거 필드 basisClause 1..8의 뜻)
const CLAUSE_NAME = { 1: '법령상 비밀', 2: '국가안보·통일·외교', 3: '국민 생명·안전', 4: '재판·수사', 5: '의사결정 과정', 6: '개인정보', 7: '경영·영업 비밀', 8: '부동산 투기 등' }

export default function Taxonomy({ data }) {
  const model = React.useMemo(() => buildModel(data.events), [data.events])
  if (!data.events.length) {
    return <div className="card"><p className="hint">원장이 비어 있습니다 — 생성/폐기 화면에서 라벨을 발급하거나 샘플을 로딩하세요.</p></div>
  }
  return (
    <>
      <div className="card">
        <h2>C-1. 탁소노미 — BRM 업무분류(brmPath) × 등급</h2>
        <p className="lv-sub">넓이 = 문서 수 · 아래 띠 = 현재 등급 비율(C/S/O) · 원장의 경로형 필드를 그대로 트리로 쓴다. 칸을 가리키면 문서 목록.</p>
        <Treemap docs={model.docList} />
        <div className="lv-legend">
          <span><i style={swatch(BAD)} />C 비밀</span><span><i style={swatch(WARN)} />S 민감</span><span><i style={swatch(OK)} />O 공개</span>
          <span><i style={swatch('#e5e7eb')} />등급 없음(폐기 등)</span>
          <span>문서 {model.docList.length}건 · 분류 {model.brm.length}개{model.unclassified ? ` · 미분류 ${model.unclassified}건` : ''}</span>
        </div>
      </div>

      <div className="card">
        <h2>C-2. 법적 근거(정보공개법 9조 호수) · 동적 태그</h2>
        <p className="lv-sub">basisClause 막대(문서 단위) · basisKeywords 공기(같은 문서에 함께 붙은 태그) 네트워크</p>
        <div className="lv-row">
          <ClauseBars docs={model.docList} />
          <TagNetwork docs={model.docList} />
        </div>
      </div>

      <div className="card">
        <h2>C-3. 온톨로지 — LM 스키마(클래스·관계)</h2>
        <p className="lv-sub">트리플스토어 없이 문서화 + JSON-LD 내보내기. 실선 = 원장 필드로 이미 성립하는 관계 · 점선 = 분류 축(위 트리맵·막대의 데이터) · 주황 = 2단계에서 추가되는 관측 로그(기관 간 이동)</p>
        <Schema />
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: NAVY, fontWeight: 700 }}>JSON-LD 미리보기 (브라우저에서 생성 · 문서 {Math.min(3, model.docList.length)}건 · 행 {Math.min(6, data.events.length)}건)</summary>
          <pre style={{ fontSize: 11, background: '#fafbfc', border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, overflowX: 'auto', margin: '8px 0 0' }}>
            {JSON.stringify(buildJsonLd(model, data.events), null, 2)}
          </pre>
          <p className="hint" style={{ margin: '6px 0 0' }}>사람 식별자(actor)는 내보내지 않는다 — 원장에 PII를 넣지 않는 원칙과 같은 이유.</p>
        </details>
      </div>
    </>
  )
}

// ---- (1) 트리맵 ----
function Treemap({ docs }) {
  const W = 860, H = 260
  const groups = new Map()
  for (const d of docs) {
    const key = d.brmPath || '(미분류)'
    if (!groups.has(key)) groups.set(key, { key, docs: [] })
    groups.get(key).docs.push(d)
  }
  const items = [...groups.values()].map((g) => ({ ...g, value: g.docs.length })).sort((a, b) => b.value - a.value)
  const cells = squarify(items, 0, 0, W, H)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="BRM 트리맵" style={{ display: 'block' }}>
      {cells.map((c) => {
        const grades = c.docs.map((d) => d.grade).filter(Boolean)
        const revoked = c.docs.filter((d) => d.status === 'revoked' || d.status === 'destroyed').length
        const parts = ['C', 'S', 'O'].map((g) => ({ g, n: grades.filter((x) => x === g).length })).filter((p) => p.n)
        const barW = Math.max(0, c.w - 24), pad = 12
        let off = 0
        const big = c.w >= 96 && c.h >= 56, mid = c.w >= 56 && c.h >= 36
        const title = c.key.replace('/', ' / ')
        const label = big && title.length > c.w / 8 ? title.slice(0, Math.floor(c.w / 8) - 1) + '…' : title
        return (
          <g key={c.key}>
            <title>{`${c.key} · ${c.docs.length}건${revoked ? ` (폐기·파기 ${revoked})` : ''}\n${c.docs.map((d) => `${d.grade || '-'} ${d.filename || d.docGuid.slice(0, 8)}${d.status !== 'valid' ? ` [${d.status}]` : ''}`).join('\n')}`}</title>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="6" fill="#eef1f6" stroke="#fff" strokeWidth="3" />
            {mid && <text x={c.x + pad} y={c.y + 22} fontSize={big ? 13 : 11} fontWeight="700" fill={NAVY}>{big ? label : title.split(' / ').pop()}</text>}
            {big && <text x={c.x + pad} y={c.y + 40} fontSize="11" fill={MUTED}>{c.docs.length}건{revoked ? ` · ${revoked}건 폐기` : parts.length === 1 ? ` · 전부 ${GRADE_NAME[parts[0].g].slice(2)}` : ''}</text>}
            {!big && mid && <text x={c.x + pad} y={c.y + 36} fontSize="10" fill={MUTED}>{c.docs.length}건</text>}
            {c.h >= 30 && grades.length > 0 && parts.map((p) => {
              const w = (p.n / grades.length) * barW, x = c.x + pad + off
              off += w
              return <rect key={p.g} x={x} y={c.y + c.h - 18} width={Math.max(0, w - 1)} height="8" fill={GRADE_COLOR[p.g]} />
            })}
          </g>
        )
      })}
    </svg>
  )
}

// 정사각화(squarified) 트리맵: 긴 변을 따라 줄을 채우며 종횡비가 나빠지기 직전에 줄을 끊는다.
function squarify(items, x, y, w, h) {
  const out = []
  const total = items.reduce((s, i) => s + i.value, 0)
  if (!total || w <= 0 || h <= 0) return out
  let rest = items.map((i) => ({ ...i, area: (i.value / total) * w * h }))
  let rx = x, ry = y, rw = w, rh = h
  while (rest.length) {
    const vertical = rw >= rh
    const side = vertical ? rh : rw
    let row = [rest[0]], best = worst(row, side), i = 1
    while (i < rest.length) {
      const cand = row.concat(rest[i]), wr = worst(cand, side)
      if (wr <= best) { row = cand; best = wr; i++ } else break
    }
    rest = rest.slice(row.length)
    const thick = row.reduce((s, r) => s + r.area, 0) / side
    let off = 0
    for (const r of row) {
      const len = r.area / thick
      out.push(vertical ? { ...r, x: rx, y: ry + off, w: thick, h: len } : { ...r, x: rx + off, y: ry, w: len, h: thick })
      off += len
    }
    if (vertical) { rx += thick; rw -= thick } else { ry += thick; rh -= thick }
  }
  return out
}
function worst(row, side) {
  const s = row.reduce((a, r) => a + r.area, 0), s2 = s * s, w2 = side * side
  let mx = 0
  for (const r of row) mx = Math.max(mx, (w2 * r.area) / s2, s2 / (w2 * r.area))
  return mx
}

// ---- (2) 근거 호수 막대 ----
function ClauseBars({ docs }) {
  const W = 400, H = 210, base = 150, x0 = 26, gap = 46, bw = 24
  const counts = Array.from({ length: 8 }, (_, i) => docs.filter((d) => d.basisClause === i + 1).length)
  const none = docs.filter((d) => !d.basisClause).length
  const max = Math.max(1, ...counts)
  const top = counts.map((n, i) => ({ n, c: i + 1 })).filter((t) => t.n).sort((a, b) => b.n - a.n).slice(0, 2)
  return (
    <div>
      <div className="viz-h" style={{ marginTop: 0 }}>근거 호수별 문서 수</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="근거 호수 막대">
        <line x1={x0 - 10} y1={base} x2={x0 + gap * 8} y2={base} stroke={LINE} />
        {counts.map((n, i) => {
          const h = (n / max) * 110, x = x0 + i * gap
          return (
            <g key={i}>
              <title>{`${i + 1}호 ${CLAUSE_NAME[i + 1]} · ${n}건`}</title>
              <rect x={x} y={base - h} width={bw} height={h} rx="3" fill={NAVY} />
              {n > 0 && <text x={x + bw / 2} y={base - h - 5} fontSize="11" fill={INK} textAnchor="middle">{n}</text>}
              <text x={x + bw / 2} y={base + 16} fontSize="10" fill={MUTED} textAnchor="middle">{i + 1}호</text>
            </g>
          )
        })}
        <text x={x0 - 10} y={base + 40} fontSize="11" fill={MUTED}>
          {top.length ? `${top.map((t) => `${t.c}호(${CLAUSE_NAME[t.c]})`).join('·')}가 다수` : '근거 호수가 기록된 문서가 없습니다'}
          {none ? ` · 근거 없음 ${none}건(주로 O 공개)` : ''}
        </text>
      </svg>
    </div>
  )
}

// ---- (2) 태그 공기 네트워크 ----
function TagNetwork({ docs }) {
  const W = 400, H = 230, cx = 200, cy = 112, rx = 118, ry = 68
  const freq = new Map(), co = new Map()
  for (const d of docs) {
    const tags = [...new Set(d.basisKeywords || [])]
    for (const t of tags) freq.set(t, (freq.get(t) || 0) + 1)
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
      const k = [tags[i], tags[j]].sort().join(' ')
      co.set(k, (co.get(k) || 0) + 1)
    }
  }
  const nodes = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, n]) => ({ tag, n }))
  if (!nodes.length) return <div><div className="viz-h" style={{ marginTop: 0 }}>태그 공기 네트워크</div><p className="hint">basisKeywords가 기록된 문서가 없습니다.</p></div>
  const maxN = nodes[0].n
  nodes.forEach((nd, i) => {
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2
    nd.x = cx + rx * Math.cos(a); nd.y = cy + ry * Math.sin(a)
    nd.r = 8 + 14 * Math.sqrt(nd.n / maxN); nd.a = a
  })
  const idx = new Map(nodes.map((n) => [n.tag, n]))
  const edges = [...co.entries()].map(([k, n]) => { const [a, b] = k.split(' '); return { a: idx.get(a), b: idx.get(b), n } }).filter((e) => e.a && e.b).sort((a, b) => b.n - a.n)
  const maxCo = edges[0]?.n || 1
  const best = edges[0]
  return (
    <div>
      <div className="viz-h" style={{ marginTop: 0 }}>태그 공기 네트워크 (크기 = 빈도, 선 굵기 = 함께 쓰인 횟수)</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="태그 네트워크">
        {edges.map((e, i) => (
          <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={NAVY} strokeOpacity={0.25 + 0.6 * (e.n / maxCo)} strokeWidth={1 + 3 * (e.n / maxCo)}>
            <title>{`${e.a.tag} + ${e.b.tag} · 함께 ${e.n}회`}</title>
          </line>
        ))}
        {nodes.map((nd) => {
          const out = Math.cos(nd.a), lx = nd.x + (nd.r + 4) * Math.cos(nd.a), ly = nd.y + (nd.r + 4) * Math.sin(nd.a) + 4
          return (
            <g key={nd.tag}>
              <title>{`${nd.tag} · ${nd.n}건`}</title>
              <circle cx={nd.x} cy={nd.y} r={nd.r} fill={NAVY} fillOpacity={0.35 + 0.65 * (nd.n / maxN)} />
              <text x={lx} y={ly} fontSize="10" fill={INK} textAnchor={Math.abs(out) < 0.3 ? 'middle' : out > 0 ? 'start' : 'end'}>{nd.tag} {nd.n}</text>
            </g>
          )
        })}
        <text x={8} y={H - 6} fontSize="10" fill={MUTED}>{best ? `굵은 선 = 자주 함께 붙는 태그 (${best.a.tag} + ${best.b.tag}, ${best.n}회)` : '함께 쓰인 태그 쌍이 아직 없습니다'}</text>
      </svg>
    </div>
  )
}

// ---- (3) 스키마 도해 (정적) ----
function Schema() {
  const W = 880, H = 330
  const box = (x, y, w, title, sub, kind) => {
    const dark = kind === 'core', dashed = kind === 'axis' || kind === 'obs', orange = kind === 'obs'
    const stroke = orange ? WARN : dark ? NAVY : dashed ? MUTED : NAVY
    return (
      <g key={title}>
        <rect x={x} y={y} width={w} height="52" rx="10" fill={dark ? NAVY : dashed ? '#fff' : '#eef1f6'} stroke={stroke} strokeDasharray={dashed ? '4 3' : undefined} />
        <text x={x + w / 2} y={y + 22} fontSize="12" fontWeight="700" textAnchor="middle" fill={dark ? '#fff' : orange ? WARN : dashed ? MUTED : INK}>{title}</text>
        <text x={x + w / 2} y={y + 39} fontSize="10" textAnchor="middle" fill={dark ? '#c3cad6' : orange ? WARN : MUTED}>{sub}</text>
      </g>
    )
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="온톨로지 스키마" style={{ display: 'block' }}>
      <defs><marker id="lvArrC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={NAVY} /></marker></defs>
      {box(470, 24, 150, 'Label', 'CMS 서명 · 평문 등급', 'plain')}
      {box(700, 24, 160, 'Treaty (협정)', 'gradeMap · notAfter', 'plain')}
      {box(20, 118, 150, 'Document', 'docGuid · rootDocId', 'core')}
      {box(220, 118, 170, 'Event (원장 행)', 'ISSUE·DERIVE·REGRADE·REVOKE·DESTROY', 'core')}
      {box(470, 118, 150, 'Grade', '순서형 C > S > O', 'plain')}
      {box(700, 118, 160, 'Issuer (기관)', 'issuerOrgId · CA', 'plain')}
      {box(20, 228, 150, 'BRM Category', 'brmPath 계층', 'axis')}
      {box(220, 228, 170, 'LegalBasis · Tag', 'basisClause(9조) · basisKeywords', 'axis')}
      {box(470, 228, 150, 'Checkpoint', '머클 루트 · 서명', 'plain')}
      {box(700, 228, 160, 'Observation', '타 기관 게이트 통과 (2단계)', 'obs')}
      <g stroke={NAVY} strokeWidth="1.5" fill="none" markerEnd="url(#lvArrC)">
        <path d="M170,144 L220,144" />
        <path d="M60,118 C60,78 130,78 130,118" strokeDasharray="5 3" />
        <path d="M305,118 C305,50 380,50 470,50" />
        <path d="M390,144 L470,144" />
        <path d="M330,170 C330,254 400,254 470,254" />
        <path d="M390,132 C470,92 610,92 700,140" />
        <path d="M780,118 L780,76" />
        <path d="M700,62 C650,62 620,84 585,118" />
      </g>
      <g stroke={MUTED} strokeWidth="1.2" fill="none" strokeDasharray="3 3">
        <path d="M95,228 L95,170" /><path d="M260,228 L260,170" />
      </g>
      <path d="M780,228 L780,170" stroke={WARN} strokeWidth="1.2" fill="none" strokeDasharray="3 3" />
      <g fontSize="10" fill={NAVY}>
        <text x="195" y="136" textAnchor="middle">hasVersion</text>
        <text x="95" y="80" textAnchor="middle">derivedFrom (edit·convert·merge·extract)</text>
        <text x="400" y="42" textAnchor="middle">carries</text>
        <text x="430" y="136" textAnchor="middle">gradedAs</text>
        <text x="400" y="246" textAnchor="middle">sealedBy</text>
        <rect x="520" y="90" width="50" height="14" rx="7" fill="#fff" /><text x="545" y="101" textAnchor="middle">issuedBy</text>
        <text x="786" y="100">partyOf</text>
        <rect x="601" y="79" width="118" height="14" rx="7" fill="#fff" /><text x="660" y="90" textAnchor="middle">translatedBy(gradeMap)</text>
      </g>
      <g fontSize="10" fill={MUTED}>
        <text x="90" y="203" textAnchor="end">classifiedAs</text>
        <text x="255" y="203" textAnchor="end">justifiedBy · taggedWith</text>
        <text x="786" y="203" fill={WARN}>observedAt</text>
      </g>
      <text x="20" y={H - 8} fontSize="10" fill={MUTED}>Grade는 순서형이라 협정 gradeMap은 같은 단계 이하로만 번역된다 · C는 내부 전용(번역 대상 아님) · Checkpoint는 Event 구간(fromSeq~toSeq)을 머클 루트로 봉인</text>
    </svg>
  )
}

// ---- JSON-LD ----
function buildJsonLd(model, events) {
  const urnDoc = (g) => `urn:lm:doc:${g}`, urnEv = (s) => `urn:lm:event:${s}`, urnOrg = (o) => `urn:lm:org:${o}`
  const docs = model.docList.slice(0, 3).map((d) => {
    const o = { '@id': urnDoc(d.docGuid), '@type': 'Document', docGuid: d.docGuid, rootDocId: urnDoc(d.rootDocId), issuedBy: urnOrg(d.issuerOrg), gradedAs: d.grade || null }
    if (d.parent) o.derivedFrom = { '@id': urnDoc(d.parent.docGuid), transform: d.transform }
    if (d.brmPath) o.classifiedAs = d.brmPath
    if (d.basisClause) o.justifiedBy = `정보공개법 제9조 제1항 제${d.basisClause}호`
    if (d.basisKeywords?.length) o.taggedWith = d.basisKeywords
    o.hasVersion = d.events.map((e) => urnEv(e.seq))
    return o
  })
  const evs = events.slice(0, 6).map((e) => ({
    '@id': urnEv(e.seq), '@type': 'Event', seq: e.seq, eventType: e.eventType, document: urnDoc(e.docGuid),
    contentHash: e.contentHash, prevHash: e.prevHash || null, rowHash: e.rowHash, createdAt: e.createdAt,
    ...(e.grade ? { gradedAs: e.grade } : {}), ...(e.revokedRef ? { refersTo: urnEv(e.revokedRef) } : {})
  }))
  return {
    '@context': {
      lm: 'https://ledgermarker.innotium.com/ns#', xsd: 'http://www.w3.org/2001/XMLSchema#',
      Document: 'lm:Document', Event: 'lm:Event', docGuid: 'lm:docGuid', seq: 'lm:seq', eventType: 'lm:eventType',
      rootDocId: { '@id': 'lm:rootDocId', '@type': '@id' }, derivedFrom: { '@id': 'lm:derivedFrom', '@type': '@id' },
      hasVersion: { '@id': 'lm:hasVersion', '@type': '@id' }, document: { '@id': 'lm:document', '@type': '@id' },
      issuedBy: { '@id': 'lm:issuedBy', '@type': '@id' }, refersTo: { '@id': 'lm:refersTo', '@type': '@id' },
      gradedAs: 'lm:gradedAs', classifiedAs: 'lm:classifiedAs', justifiedBy: 'lm:justifiedBy', taggedWith: 'lm:taggedWith', transform: 'lm:transform',
      contentHash: 'lm:contentHash', prevHash: 'lm:prevHash', rowHash: 'lm:rowHash', createdAt: { '@id': 'lm:createdAt', '@type': 'xsd:dateTime' }
    },
    '@graph': [...docs, ...evs]
  }
}

// ---- 데이터 정리 ----
function buildModel(events) {
  const docs = new Map(), byHash = new Map()
  for (const e of events) {
    let d = docs.get(e.docGuid)
    if (!d) {
      d = { docGuid: e.docGuid, filename: e.filename, issuerOrg: e.issuerOrg, rootDocId: e.rootDocId || e.docGuid, parentHash: e.parentHash, transform: e.transform,
        grade: e.grade, status: 'valid', brmPath: e.brmPath, basisClause: e.basisClause, basisKeywords: e.basisKeywords || [], events: [], parent: null }
      docs.set(e.docGuid, d)
    }
    d.events.push(e)
    if (e.contentHash && !byHash.has(e.contentHash)) byHash.set(e.contentHash, d)
    if (e.filename && !d.filename) d.filename = e.filename
    if (e.brmPath && !d.brmPath) d.brmPath = e.brmPath
    if (e.basisClause && !d.basisClause) d.basisClause = e.basisClause
    if (e.basisKeywords?.length && !d.basisKeywords.length) d.basisKeywords = e.basisKeywords
    if (e.eventType === 'REGRADE') d.grade = e.grade
    if (e.eventType === 'REVOKE') d.status = 'revoked'
    if (e.eventType === 'DESTROY') d.status = 'destroyed'
  }
  for (const d of docs.values()) d.parent = d.parentHash ? byHash.get(d.parentHash) || null : null
  const docList = [...docs.values()]
  const brm = [...new Set(docList.map((d) => d.brmPath).filter(Boolean))]
  return { docList, brm, unclassified: docList.filter((d) => !d.brmPath).length }
}

function swatch(c) { return { display: 'inline-block', width: 14, height: 8, background: c } }
