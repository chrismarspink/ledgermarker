import React from 'react'
import { Link } from 'react-router-dom'
import cytoscape from 'cytoscape'
import { orgLabel, ORG_NAMES } from '../../lib/orgs.js'

// B. 원장 전체 그래프 — cytoscape. 기관(compound) 안에 문서 노드, 계보 간선(parent→child),
// 아래 척추(spine)는 seq 순 해시체인, 문서↔행은 옅은 점선, 봉인은 방패 노드.
// 힘 기반 배치 대신 좌표를 직접 계산(preset)한다 — 새로고침마다 그림이 흔들리면 안 되므로.

const NAVY = '#1a2b4a', OK = '#1e7d46', WARN = '#b07a00', BAD = '#b02a2a'
const MUTED = '#6b7280', INK = '#111827', FAINT = '#c3cad6'
const GRADE_COLOR = { C: BAD, S: WARN, O: OK }
const GRADE_NAME = { C: 'C 비밀', S: 'S 민감', O: 'O 공개' }
const STATUS_NAME = { valid: '유효', provisional: '잠정', revoked: '폐기됨', destroyed: '파기됨' }
const EVENT_COLOR = { ISSUE: NAVY, DERIVE: NAVY, REGRADE: OK, REVOKE: BAD, DESTROY: INK }

const DOC_W = 140, DOC_H = 46, GX = 156, GY = 62, ORG_PAD = 20, ORG_TITLE = 28, MAX_ROW_W = 1100

export default function LedgerGraph({ data }) {
  const ref = React.useRef()
  const cyRef = React.useRef(null)
  const model = React.useMemo(() => buildModel(data.events), [data.events])
  const [sel, setSel] = React.useState(null)

  React.useEffect(() => {
    if (!ref.current || !model.docList.length) return
    const cy = cytoscape({
      container: ref.current,
      elements: buildElements(model, data.checkpoints),
      layout: { name: 'preset' },
      autoungrabify: true, // 좌표는 계산된 값이 정답이다 — 끌어서 흐트러뜨리지 않게
      wheelSensitivity: 0.2,
      style: [
        { selector: 'node:parent', style: {
          shape: 'round-rectangle', 'background-color': '#fafbfc', 'background-opacity': 1,
          'border-width': 1.5, 'border-color': NAVY, padding: ORG_PAD,
          label: 'data(label)', 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -6,
          'font-size': 13, 'font-weight': 700, color: NAVY
        } },
        { selector: 'node[kind="doc"]', style: {
          shape: 'round-rectangle', width: DOC_W, height: DOC_H,
          'background-color': '#eef1f6', 'border-width': 1.5, 'border-color': NAVY,
          label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 104, 'text-valign': 'center', 'text-halign': 'center',
          'text-margin-x': 14, 'font-size': 11, color: INK, 'line-height': 1.25
        } },
        { selector: 'node[kind="doc"][status="revoked"]', style: { 'background-color': '#fff', 'border-color': BAD, 'border-style': 'dashed', color: BAD } },
        { selector: 'node[kind="doc"][status="destroyed"]', style: { 'background-color': '#f1f1f1', 'border-color': MUTED, color: MUTED } },
        { selector: 'node[kind="doc"][status="provisional"]', style: { 'border-style': 'dotted', 'border-color': WARN } },
        { selector: 'node[kind="doc"].sel', style: { 'background-color': NAVY, color: '#fff', 'border-width': 2.5 } },
        { selector: 'node[kind="badge"]', style: {
          shape: 'round-rectangle', width: 20, height: 20, 'background-color': 'data(color)', 'background-opacity': 'data(op)',
          label: 'data(label)', 'font-size': 11, 'font-weight': 800, color: '#fff', 'text-valign': 'center', 'text-halign': 'center', events: 'no'
        } },
        { selector: 'node[kind="event"]', style: {
          shape: 'ellipse', width: 'data(size)', height: 'data(size)', 'background-color': 'data(color)',
          'border-width': 2, 'border-color': '#fff', label: 'data(label)', 'font-size': 9, color: MUTED,
          'text-valign': 'bottom', 'text-margin-y': 4, 'text-wrap': 'wrap', 'text-max-width': 44
        } },
        { selector: 'node[kind="ckpt"]', style: {
          shape: 'polygon', 'shape-polygon-points': '-1,-1 1,-1 1,0.35 0,1 -1,0.35', width: 22, height: 26,
          'background-color': NAVY, label: 'data(label)', 'font-size': 10, color: NAVY,
          'text-valign': 'center', 'text-halign': 'right', 'text-margin-x': 6
        } },
        { selector: 'node[kind="note"]', style: {
          shape: 'rectangle', width: 1, height: 1, 'background-opacity': 0, label: 'data(label)',
          'font-size': 11, color: MUTED, 'text-valign': 'center', 'text-halign': 'right', events: 'no'
        } },
        { selector: 'edge[kind="lineage"]', style: {
          width: 2, 'line-color': NAVY, 'target-arrow-shape': 'triangle', 'target-arrow-color': NAVY,
          'curve-style': 'bezier', label: 'data(label)', 'font-size': 10, color: NAVY,
          'text-background-color': '#fff', 'text-background-opacity': 1, 'text-background-padding': 2, 'text-background-shape': 'roundrectangle'
        } },
        { selector: 'edge[kind="chain"]', style: { width: 3, 'line-color': NAVY, 'curve-style': 'straight' } },
        { selector: 'edge[kind="docev"]', style: { width: 1, 'line-color': FAINT, 'line-style': 'dashed', 'line-dash-pattern': [2, 3], 'curve-style': 'straight' } },
        { selector: 'edge[kind="docev"].sel', style: { 'line-color': NAVY, width: 1.5 } },
        { selector: 'edge[kind="seal"]', style: { width: 1, 'line-color': NAVY, 'line-style': 'dashed', 'curve-style': 'straight' } }
      ]
    })
    cy.on('tap', 'node[kind="doc"]', (ev) => setSel(ev.target.data('docGuid')))
    cy.on('tap', 'node[kind="event"]', (ev) => setSel(ev.target.data('docGuid')))
    cy.on('tap', (ev) => { if (ev.target === cy) setSel(null) })
    // 컨테이너 높이를 배치의 종횡비에 맞춘다 — 고정 높이면 넓은 배치에서 위아래가 비고 글씨만 작아진다
    const bb = cy.elements().boundingBox()
    const cw = ref.current.clientWidth || 830
    ref.current.style.height = `${Math.min(760, Math.max(360, Math.round(((cw - 24) * bb.h) / bb.w + 24)))}px`
    cy.resize()
    cy.fit(undefined, 12)
    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [model, data.checkpoints])

  // 선택 강조는 cytoscape 클래스로 — 재생성 없이 반영
  React.useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('sel')
    if (sel) {
      cy.getElementById('doc:' + sel).addClass('sel')
      cy.edges(`[kind="docev"][docGuid="${sel}"]`).addClass('sel')
    }
  }, [sel, model])

  if (!data.events.length) {
    return <div className="card"><p className="hint">원장이 비어 있습니다 — 생성/폐기 화면에서 라벨을 발급하거나 샘플을 로딩하세요.</p></div>
  }
  const d = sel ? model.docs.get(sel) : null

  return (
    <div className="card">
      <h2>원장 전체 그래프 — 기관 · 문서 · 계보 · 해시체인</h2>
      <p className="lv-sub">
        기관 상자 안에 문서, 화살표 = 계보(parent, 변환 종류), 아래 척추 = 원장 행 seq 순 해시체인(수정·삭제 불가), 방패 = 머클 봉인.
        문서나 행을 클릭하면 상세. 휠로 확대, 끌어서 이동 · <button className="link" onClick={() => cyRef.current?.fit(undefined, 12)}>화면 맞춤</button>
      </p>
      <div className="lv-graph" ref={ref} />
      <div className="lv-legend">
        <span><i style={sw('#eef1f6', NAVY)} />문서 (유효)</span>
        <span><i style={sw('#fff', BAD, 'dashed')} />폐기</span>
        <span><i style={sw('#f1f1f1', MUTED)} />파기</span>
        <span><i style={sw('#eef1f6', WARN, 'dotted')} />잠정</span>
        <span><i style={{ width: 22, height: 2, background: NAVY, display: 'inline-block' }} />parent (변환 종류 라벨)</span>
        <span><i style={{ width: 22, borderTop: `1px dashed ${FAINT}`, display: 'inline-block' }} />문서 ↔ 원장 행</span>
        <span><i style={{ width: 10, height: 10, borderRadius: 5, background: NAVY, display: 'inline-block' }} />행 ISSUE·DERIVE</span>
        <span><i style={{ width: 10, height: 10, borderRadius: 5, background: OK, display: 'inline-block' }} />REGRADE</span>
        <span><i style={{ width: 10, height: 10, borderRadius: 5, background: BAD, display: 'inline-block' }} />REVOKE</span>
        <span><i style={{ width: 10, height: 10, borderRadius: 5, background: INK, display: 'inline-block' }} />DESTROY</span>
        <span><b style={{ color: BAD }}>C</b>/<b style={{ color: WARN }}>S</b>/<b style={{ color: OK }}>O</b> 등급 배지</span>
      </div>

      {d && (
        <div className="lv-box" style={{ marginTop: 12 }}>
          <div className="t">선택한 문서</div>
          <div className="h">
            <span className="lv-gbox" style={{ background: GRADE_COLOR[d.grade] || MUTED, width: 28, height: 28, fontSize: 15, marginRight: 8, verticalAlign: 'middle' }}>{d.grade || '?'}</span>
            {d.filename || d.docGuid.slice(0, 8) + '…'}
          </div>
          <div>상태 <b style={{ color: d.status === 'valid' ? OK : d.status === 'provisional' ? WARN : d.status === 'revoked' ? BAD : INK }}>{STATUS_NAME[d.status]}</b>{d.end ? ` (seq ${d.end})` : ''} · 등급 {GRADE_NAME[d.grade] || '-'} · 발급기관 {orgLabel(d.issuerOrg)}</div>
          <div>docGuid <Link to={`/lineage/${d.docGuid}`} className="mono" title="가계도 보기">{d.docGuid}</Link></div>
          {d.parent && <div>부모 <b>{d.parent.filename || d.parent.docGuid.slice(0, 8)}</b> ← {d.transform}</div>}
          {d.children.length > 0 && <div>파생본 {d.children.map((c) => `${c.filename || c.docGuid.slice(0, 8)} (${c.transform})`).join(', ')}</div>}
          <div>원장 행 {d.events.map((e) => `#${e.seq} ${e.eventType}${e.grade ? ' ' + e.grade : ''}`).join(' → ')}</div>
        </div>
      )}
    </div>
  )
}

function sw(bg, border, style = 'solid') {
  return { display: 'inline-block', width: 18, height: 12, borderRadius: 3, background: bg, border: `1.5px ${style} ${border}` }
}

// ---- 좌표 계산 + cytoscape 요소 ----
function buildElements(model, checkpoints) {
  const els = []
  // 기관 상자: 문서 수 내림차순, 격자 열 수는 문서 수에 맞춰 대략 정사각형에 가깝게.
  const orgs = model.orgs.map((org) => {
    const docs = model.docList.filter((d) => d.issuerOrg === org)
    const n = docs.length
    const cols = n <= 2 ? 1 : n <= 6 ? 2 : n <= 12 ? 4 : 5
    const rows = Math.ceil(n / cols)
    return { org, docs, cols, rows, w: cols * GX + ORG_PAD * 2, h: rows * GY + ORG_PAD * 2 + ORG_TITLE }
  })
  // 상자를 줄 단위로 채운다(가로 상한 MAX_ROW_W).
  let cx = 0, cy = 0, rowH = 0, maxW = 0
  for (const o of orgs) {
    if (cx > 0 && cx + o.w > MAX_ROW_W) { cx = 0; cy += rowH + 40; rowH = 0 }
    o.x = cx; o.y = cy
    cx += o.w + 30; rowH = Math.max(rowH, o.h); maxW = Math.max(maxW, cx - 30)
  }
  const orgBottom = cy + rowH
  const docPos = new Map()
  for (const o of orgs) {
    const valid = o.docs.filter((d) => d.status === 'valid' || d.status === 'provisional').length
    els.push({ data: { id: 'org:' + o.org, label: `기관 ${o.org}${ORG_NAMES[o.org] ? ` (${ORG_NAMES[o.org]})` : ''} · 발급 ${o.docs.length} · 유효 ${valid}` } })
    o.docs.forEach((d, i) => {
      const x = o.x + ORG_PAD + (i % o.cols) * GX + DOC_W / 2
      const y = o.y + ORG_TITLE + ORG_PAD + Math.floor(i / o.cols) * GY + DOC_H / 2
      docPos.set(d.docGuid, { x, y })
      const name = d.filename || d.docGuid.slice(0, 8) + '…'
      const sub = d.status === 'revoked' ? `폐기됨 (seq ${d.end})` : d.status === 'destroyed' ? `파기됨 (seq ${d.end}) · 행 보존`
        : d.parent ? `${d.docGuid.slice(0, 8)}… · ${d.transform || '파생'}본` : `${d.docGuid.slice(0, 8)}… · 원본(root)`
      els.push({ data: { id: 'doc:' + d.docGuid, kind: 'doc', docGuid: d.docGuid, parent: 'org:' + o.org, status: d.status,
        label: `${name.length > 14 ? name.slice(0, 13) + '…' : name}\n${sub}` }, position: { x, y } })
      els.push({ data: { id: 'badge:' + d.docGuid, kind: 'badge', parent: 'org:' + o.org, label: d.grade || '?',
        color: GRADE_COLOR[d.grade] || MUTED, op: d.status === 'valid' || d.status === 'provisional' ? 1 : 0.45 },
        position: { x: x - DOC_W / 2 + 16, y } })
    })
  }
  for (const d of model.docList) {
    if (d.parent && docPos.has(d.parent.docGuid)) {
      els.push({ data: { id: `lin:${d.docGuid}`, kind: 'lineage', source: 'doc:' + d.parent.docGuid, target: 'doc:' + d.docGuid, label: d.transform || '' } })
    }
  }
  // 척추: 원장 행을 seq 순으로 한 줄에. 행이 많으면 라벨은 유형이 있는 행만.
  const evs = model.events
  const spineY = orgBottom + 110
  const spineW = Math.max(maxW, 600)
  const gap = evs.length > 1 ? spineW / (evs.length - 1) : 0
  const dense = gap < 44
  const evPos = new Map()
  els.push({ data: { id: 'note:spine', kind: 'note', label: '해시체인 (prev_hash → row_hash, seq 순, 수정·삭제 불가)' }, position: { x: -6, y: spineY - 34 } })
  evs.forEach((e, i) => {
    const x = i * gap, y = spineY
    evPos.set(e.seq, x)
    const special = e.eventType !== 'ISSUE' && e.eventType !== 'DERIVE'
    els.push({ data: { id: 'ev:' + e.seq, kind: 'event', docGuid: e.docGuid, size: special ? 18 : 14, color: EVENT_COLOR[e.eventType] || NAVY,
      label: dense && !special && i % Math.ceil(44 / Math.max(gap, 1)) !== 0 ? '' : `${e.seq} ${e.eventType}` }, position: { x, y } })
    if (i > 0) els.push({ data: { id: `ch:${e.seq}`, kind: 'chain', source: 'ev:' + evs[i - 1].seq, target: 'ev:' + e.seq } })
    if (docPos.has(e.docGuid)) els.push({ data: { id: `de:${e.seq}`, kind: 'docev', docGuid: e.docGuid, source: 'doc:' + e.docGuid, target: 'ev:' + e.seq } })
  })
  for (const c of checkpoints) {
    if (!evPos.has(c.toSeq)) continue
    els.push({ data: { id: 'ck:' + c.ckptId, kind: 'ckpt', label: `봉인 #${c.ckptId} (seq ${c.fromSeq}~${c.toSeq}) 머클 ${c.merkleRoot.slice(0, 4)}…` }, position: { x: evPos.get(c.toSeq), y: spineY + 64 } })
    els.push({ data: { id: 'se:' + c.ckptId, kind: 'seal', source: 'ev:' + c.toSeq, target: 'ck:' + c.ckptId } })
  }
  return els
}

// 이벤트(오름차순) → 문서 모델. 상태는 행에서 재구성한다(원장에는 상태 열이 없다).
function buildModel(events) {
  const docs = new Map(), byHash = new Map()
  for (const e of events) {
    let d = docs.get(e.docGuid)
    if (!d) {
      d = { docGuid: e.docGuid, start: e.seq, filename: e.filename, issuerOrg: e.issuerOrg, rootDocId: e.rootDocId || e.docGuid,
        parentHash: e.parentHash, transform: e.transform, grade: e.grade, end: null, status: 'valid', provisional: false, events: [], parent: null, children: [] }
      docs.set(e.docGuid, d)
    }
    d.events.push(e)
    if (e.contentHash && !byHash.has(e.contentHash)) byHash.set(e.contentHash, d)
    if (e.filename && !d.filename) d.filename = e.filename
    if (e.eventType === 'REGRADE') d.grade = e.grade
    if (e.eventType === 'REVOKE') { d.end = e.seq; d.status = 'revoked' }
    if (e.eventType === 'DESTROY') { d.end = e.seq; d.status = 'destroyed' }
    if (e.approvalState) d.provisional = e.approvalState === 'PROVISIONAL'
  }
  for (const d of docs.values()) {
    if (d.status === 'valid' && d.provisional) d.status = 'provisional'
    d.parent = d.parentHash ? byHash.get(d.parentHash) || null : null
    if (d.parent) d.parent.children.push(d)
  }
  // 기관 안에서는 가족끼리 이웃하도록 rootDocId → start 순으로 정렬
  const famStart = new Map()
  for (const d of docs.values()) famStart.set(d.rootDocId, Math.min(famStart.get(d.rootDocId) ?? Infinity, d.start))
  const docList = [...docs.values()].sort((a, b) => (famStart.get(a.rootDocId) - famStart.get(b.rootDocId)) || (a.start - b.start))
  const orgCount = {}
  for (const d of docList) orgCount[d.issuerOrg] = (orgCount[d.issuerOrg] || 0) + 1
  const orgs = Object.keys(orgCount).sort((a, b) => orgCount[b] - orgCount[a])
  return { docs, docList, orgs, events }
}
