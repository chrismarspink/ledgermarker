import React from 'react'
import { Link } from 'react-router-dom'
import { orgLabel } from '../../lib/orgs.js'

// A. 레인 차트 — 가로 seq(불변 순서) × 세로 문서. 문서마다 수명선 하나.
// 색 = 등급, 색 단차 = REGRADE, 끊김 = REVOKE·DESTROY, 세로 점선 = 봉인(체크포인트).
// 가족(rootDocId)으로 묶고 파생본은 들여쓴다. 모두 인라인 SVG, 외부 라이브러리 없음.

const NAVY = '#1a2b4a', OK = '#1e7d46', WARN = '#b07a00', BAD = '#b02a2a'
const MUTED = '#6b7280', LINE = '#e5e7eb', INK = '#111827', FAINT = '#c3cad6'
const GRADE_COLOR = { C: BAD, S: WARN, O: OK }
const GRADE_NAME = { C: 'C 비밀', S: 'S 민감', O: 'O 공개' }
const STATUS_NAME = { valid: '유효', provisional: '잠정', revoked: '폐기', destroyed: '파기' }

const W = 880, LEFT = 200, RIGHT = 18, TOP = 66, ROW = 30, FAM_PAD = 8, FAM_GAP = 8

export default function LaneChart({ data }) {
  const { events, checkpoints } = data
  const model = React.useMemo(() => buildModel(events), [events])
  const [sel, setSel] = React.useState(null) // 선택한 행 seq

  if (!events.length) {
    return <div className="card"><p className="hint">원장이 비어 있습니다 — 생성/폐기 화면에서 라벨을 발급하거나 샘플을 로딩하세요.</p></div>
  }

  const tip = Math.max(data.tip || 0, events[events.length - 1].seq)
  const first = events[0].seq
  const x0 = LEFT, x1 = W - RIGHT
  // seq → x. 조회 범위(from~tip)를 가로 전체에 편다.
  const xs = (seq) => tip > first ? x0 + ((seq - first) / (tip - first)) * (x1 - x0) : (x0 + x1) / 2

  // 행 배치: 가족 묶음마다 배경 띠, 안에서 root 먼저, 파생본은 depth 만큼 들여쓰기.
  const rows = [], bands = []
  let y = TOP
  for (const fam of model.families) {
    const top = y
    for (const d of fam.docs) {
      y += FAM_PAD
      rows.push({ doc: d, y: y + ROW / 2 })
      y += ROW - FAM_PAD
    }
    y += FAM_PAD
    bands.push({ top, bottom: y, fam })
    y += FAM_GAP
  }
  const plotBottom = y
  const H = plotBottom + 8
  const rowY = new Map(rows.map((r) => [r.doc.docGuid, r.y]))
  const dominantOrg = model.dominantOrg

  // seq 눈금: 최대 24개 정도만 찍는다.
  const step = Math.max(1, Math.ceil((tip - first + 1) / 24))
  const ticks = []
  for (let s = first; s <= tip; s += step) ticks.push(s)
  if (ticks[ticks.length - 1] !== tip) ticks.push(tip)

  const selEvent = sel != null ? model.bySeq.get(sel) : null
  const selDoc = selEvent ? model.docs.get(selEvent.docGuid) : null

  return (
    <div className="card">
      <h2>레인 차트 — 가로 seq × 세로 문서</h2>
      <p className="lv-sub">문서마다 수명선 하나. 색 = 등급, 색 단차 = 등급변경, 끊김 = 폐기·파기, 세로 점선 = 봉인(체크포인트). 표식이나 레인을 클릭하면 아래에 행 상세.</p>

      <div className={rows.length > 40 ? 'lv-scroll' : ''}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="원장 레인 차트" style={{ display: 'block' }}>
          <defs>
            <pattern id="lvHatchA" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa4b2" strokeWidth="1.5" />
            </pattern>
            <marker id="lvArrA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={MUTED} />
            </marker>
          </defs>

          {/* 시간축(seq) */}
          <text x={x0} y={16} fontSize="11" fill={MUTED}>seq →</text>
          <line x1={x0} y1={40} x2={x1} y2={40} stroke={LINE} />
          {ticks.map((s) => (
            <g key={s}>
              <text x={xs(s)} y={32} fontSize="10" fill={MUTED} textAnchor="middle">{s}</text>
              <line x1={xs(s)} y1={40} x2={xs(s)} y2={plotBottom} stroke="#eef1f6" />
            </g>
          ))}

          {/* 가족 배경 */}
          {bands.map((b, i) => (
            <g key={i}>
              <rect x={6} y={b.top} width={W - 12} height={b.bottom - b.top} rx="8" fill="#fafbfc" stroke="#eef1f6" />
              {b.fam.docs.length > 1 && (
                <text x={12} y={b.top + 11} fontSize="9" fill={MUTED}>가족 rootDocId {b.fam.root.slice(0, 8)}… · {b.fam.docs.length}건</text>
              )}
            </g>
          ))}

          {/* 레인 */}
          {rows.map(({ doc: d, y }) => {
            const segs = d.segments
            const endSeq = d.end ?? tip
            const isSel = selDoc && selDoc.docGuid === d.docGuid
            const name = d.filename || d.docGuid.slice(0, 8) + '…'
            const showOrg = d.issuerOrg !== dominantOrg
            const maxLen = (showOrg ? 10 : 15) - d.depth
            const label = (d.depth ? '└ ' : '') + (name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name)
            const tipText = `${name}\ndocGuid ${d.docGuid}\n발급기관 ${orgLabel(d.issuerOrg)}\n${segs.map((s) => `seq ${s.seq}: ${GRADE_NAME[s.grade] || s.grade || '-'}`).join(' → ')}\n상태 ${STATUS_NAME[d.status]}${d.end ? ` (seq ${d.end})` : ''}`
            return (
              <g key={d.docGuid} className="lv-clickable" onClick={() => setSel(d.start)}>
                <title>{tipText}</title>
                <text x={14 + d.depth * 12} y={y + 4} fontSize="12" fill={isSel ? NAVY : INK} fontWeight={isSel ? 700 : 400}>
                  {label}{showOrg && <tspan fill={MUTED} fontSize="9"> {d.issuerOrg}</tspan>}
                </text>
                {segs.map((s, i) => {
                  const a = xs(s.seq), b = xs(Math.min(segs[i + 1]?.seq ?? endSeq, endSeq))
                  return <line key={i} x1={a} y1={y} x2={Math.max(a, b)} y2={y} stroke={GRADE_COLOR[s.grade] || MUTED} strokeWidth="8" strokeLinecap="round" opacity=".85" />
                })}
                {/* 끝난 뒤의 흔적: 폐기 = 옅은 점선, 파기 = 빗금(행은 영구 보존) */}
                {d.end && d.status === 'revoked' && <line x1={xs(d.end)} y1={y} x2={x1} y2={y} stroke={FAINT} strokeWidth="2" strokeDasharray="3 5" />}
                {d.end && d.status === 'destroyed' && <rect x={xs(d.end)} y={y - 10} width={Math.max(0, x1 - xs(d.end))} height="20" fill="url(#lvHatchA)" opacity=".7" />}
                {d.provisional && <line x1={xs(d.start)} y1={y} x2={xs(endSeq)} y2={y} stroke="#fff" strokeWidth="2" strokeDasharray="4 6" opacity=".9" />}
              </g>
            )
          })}

          {/* 파생 화살표: 부모 레인 → 자식 레인 (자식의 시작 seq 위치) */}
          {rows.map(({ doc: d, y }) => {
            if (!d.parent || !rowY.has(d.parent.docGuid)) return null
            const py = rowY.get(d.parent.docGuid), x = xs(d.start)
            const down = py < y
            return (
              <g key={'arr' + d.docGuid}>
                <path d={`M${x},${down ? py + 6 : py - 6} L${x},${down ? y - 8 : y + 8}`} stroke={MUTED} strokeWidth="1.5" fill="none" markerEnd="url(#lvArrA)">
                  <title>{d.parent.filename || d.parent.docGuid.slice(0, 8)} → {d.filename || d.docGuid.slice(0, 8)} ({d.transform || 'derive'})</title>
                </path>
                <text x={x < x1 - 50 ? x + 5 : x - 5} y={(py + y) / 2 + 3} fontSize="10" fill={MUTED} textAnchor={x < x1 - 50 ? 'start' : 'end'}>{d.transform || ''}</text>
              </g>
            )
          })}

          {/* 이벤트 표식 (클릭 대상) */}
          {rows.map(({ doc: d, y }) => d.events.map((e) => {
            const x = xs(e.seq), c = GRADE_COLOR[e.grade] || MUTED
            const t = `seq ${e.seq} · ${e.eventType}${e.grade ? ` · ${GRADE_NAME[e.grade]}` : ''}${e.reason ? `\n사유: ${e.reason}` : ''}\n${fmtDate(e.createdAt)}`
            let mark = null
            if (e.eventType === 'ISSUE') mark = <circle cx={x} cy={y} r="7" fill={c} stroke="#fff" strokeWidth="2" />
            else if (e.eventType === 'DERIVE') mark = <path d={`M${x},${y - 7} L${x + 7},${y} L${x},${y + 7} L${x - 7},${y} Z`} fill={c} stroke="#fff" strokeWidth="2" />
            else if (e.eventType === 'REGRADE') {
              const prev = d.segments.find((s, i) => d.segments[i + 1]?.seq === e.seq)?.grade
              mark = (<>
                <path d={`M${x},${y - 9} L${x + 9},${y + 7} L${x - 9},${y + 7} Z`} fill={c} stroke="#fff" strokeWidth="2" />
                <text x={x} y={y - 12} fontSize="10" fill={c} textAnchor="middle" fontWeight="700">{prev || '?'}→{e.grade}</text>
              </>)
            } else if (e.eventType === 'REVOKE') {
              const right = x < x1 - 60
              mark = (<>
                <g stroke={BAD} strokeWidth="3" strokeLinecap="round"><line x1={x - 6} y1={y - 6} x2={x + 6} y2={y + 6} /><line x1={x + 6} y1={y - 6} x2={x - 6} y2={y + 6} /></g>
                <text x={right ? x + 11 : x - 11} y={y - 6} fontSize="10" fill={BAD} textAnchor={right ? 'start' : 'end'}>REVOKE</text>
              </>)
            } else if (e.eventType === 'DESTROY') {
              const right = x < x1 - 70
              mark = (<>
                <rect x={x - 8} y={y - 8} width="16" height="16" fill="#fff" stroke={INK} strokeWidth="2" />
                <g stroke={INK} strokeWidth="2"><line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} /><line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} /></g>
                <text x={right ? x + 12 : x - 12} y={y - 12} fontSize="10" fill={INK} textAnchor={right ? 'start' : 'end'}>DESTROY</text>
              </>)
            }
            return (
              <g key={e.seq} className="lv-clickable" onClick={(ev) => { ev.stopPropagation(); setSel(e.seq) }}>
                <title>{t}</title>
                {mark}
                <circle cx={x} cy={y} r="11" fill="transparent" />
              </g>
            )
          }))}

          {/* 체크포인트: toSeq 위치에 세로 점선 + 알약 라벨 */}
          {checkpoints.map((c) => {
            const x = xs(c.toSeq), px = Math.min(Math.max(x, 44), W - 44) // 알약이 가장자리에서 잘리지 않게
            return (
              <g key={c.ckptId}>
                <title>봉인 #{c.ckptId} · seq {c.fromSeq}~{c.toSeq}{'\n'}머클 루트 {c.merkleRoot}{'\n'}서명 {fmtDate(c.signedAt)}</title>
                <line x1={x} y1={44} x2={x} y2={plotBottom} stroke={NAVY} strokeWidth="1.5" strokeDasharray="5 4" />
                <rect x={px - 42} y={44} width="84" height="16" rx="8" fill={NAVY} />
                <text x={px} y={56} fontSize="10" fill="#fff" textAnchor="middle">봉인 #{c.ckptId} · {c.merkleRoot.slice(0, 4)}…</text>
              </g>
            )
          })}

          {/* 선택 강조 */}
          {selEvent && rowY.has(selEvent.docGuid) && (
            <rect x={xs(selEvent.seq) - 14} y={rowY.get(selEvent.docGuid) - 14} width="28" height="28" rx="6" fill="none" stroke={NAVY} strokeWidth="2" pointerEvents="none" />
          )}
        </svg>
      </div>

      <Legend />

      <div className="lv-row">
        <div>
          <div className="viz-h">기관 × 등급 (유효 라벨 수)</div>
          <Matrix rows={model.orgs} cols={['C', 'S', 'O']} colLabel={(g) => GRADE_NAME[g]} rowLabel={(o) => o}
            value={(o, g) => model.docList.filter((d) => d.issuerOrg === o && d.status !== 'revoked' && d.status !== 'destroyed' && d.grade === g).length}
            color={() => NAVY} />
        </div>
        <div>
          <div className="viz-h">기관 × 상태</div>
          <Matrix rows={model.orgs} cols={['valid', 'provisional', 'revoked', 'destroyed']} colLabel={(s) => STATUS_NAME[s]} rowLabel={(o) => o}
            value={(o, s) => model.docList.filter((d) => d.issuerOrg === o && d.status === s).length}
            color={(s) => ({ valid: OK, provisional: WARN, revoked: BAD, destroyed: INK })[s]} />
        </div>
        <Detail e={selEvent} d={selDoc} model={model} checkpoints={checkpoints} />
      </div>
    </div>
  )
}

// 선택한 행 상세 — 해시체인 연결(다음 행의 prev = 이 행의 row)과 봉인 포함 여부까지.
function Detail({ e, d, model, checkpoints }) {
  if (!e) return <div className="lv-box"><div className="t">선택한 행</div><div style={{ marginTop: 6 }}>레인이나 표식을 클릭하면 seq·등급·해시체인·봉인 정보가 여기 표시됩니다.</div></div>
  const prevGrade = e.eventType === 'REGRADE' ? d.segments.find((s, i) => d.segments[i + 1]?.seq === e.seq)?.grade : null
  const next = model.bySeq.get(e.seq + 1)
  const ck = checkpoints.find((c) => c.fromSeq <= e.seq && e.seq <= c.toSeq)
  const G = ({ g }) => <span className="lv-gbox" style={{ background: GRADE_COLOR[g] || MUTED }}>{g || '?'}</span>
  return (
    <div className="lv-box">
      <div className="t">선택한 행</div>
      <div className="h">seq {e.seq} · {e.eventType}{e.transform ? ` (${e.transform})` : ''}</div>
      {e.eventType === 'REGRADE' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px' }}><G g={prevGrade} /><span style={{ color: MUTED }}>→</span><G g={e.grade} /><span className="hint">등급변경{e.approvalState ? ` · ${e.approvalState}` : ''}</span></div>
      ) : e.grade ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px' }}><G g={e.grade} /><span className="hint">{GRADE_NAME[e.grade]}{e.approvalState ? ` · ${e.approvalState}` : ''}</span></div>
      ) : null}
      <div>문서 <b>{d.filename || '-'}</b></div>
      <div>docGuid <Link to={`/lineage/${d.docGuid}`} className="mono" title="가계도 보기">{d.docGuid.slice(0, 8)}…</Link></div>
      {e.revokedRef && <div>원 행(revokedRef) <b>seq {e.revokedRef}</b></div>}
      {d.parent && <div>부모 <b>{d.parent.filename || d.parent.docGuid.slice(0, 8)}</b> ({d.transform})</div>}
      <div>발급기관 {orgLabel(e.issuerOrg)} · actor <span className="mono">{e.actor}</span></div>
      {e.reason && <div>사유 “{e.reason}”</div>}
      <div>기록 {fmtDate(e.createdAt)}</div>
      <div className="mono" style={{ marginTop: 6, lineHeight: 1.8 }}>
        prev_hash {e.prevHash ? e.prevHash.slice(0, 8) + '…' : '(제네시스)'}<br />
        row_hash&nbsp; {e.rowHash.slice(0, 8)}…
        {next && <><br />next(seq {next.seq}) prev = {next.prevHash.slice(0, 8)}… {next.prevHash === e.rowHash ? <b style={{ color: OK }}>✓ 일치</b> : <b style={{ color: BAD }}>✗ 불일치</b>}</>}
      </div>
      <div style={{ marginTop: 6, fontWeight: 700, color: ck ? OK : WARN }}>
        {ck ? `봉인 #${ck.ckptId}에 포함 (seq ${ck.fromSeq}~${ck.toSeq} · ${fmtDate(ck.signedAt)} 서명)` : '아직 봉인되지 않음 (다음 체크포인트 대기)'}
      </div>
    </div>
  )
}

// 작은 히트맵 표. 셀 농도 = 값/최대값.
function Matrix({ rows, cols, rowLabel, colLabel, value, color }) {
  const vals = rows.map((r) => cols.map((c) => value(r, c)))
  const max = Math.max(1, ...vals.flat())
  return (
    <table className="lv-matrix">
      <thead><tr><th className="r" /> {cols.map((c) => <th key={c}>{colLabel(c)}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r}>
            <th className="r" title={orgLabel(r)}>{rowLabel(r)}</th>
            {cols.map((c, j) => {
              const v = vals[i][j], op = v ? 0.15 + 0.7 * (v / max) : 0.06
              return <td key={c} style={{ background: hexa(color(c), op), color: op > 0.5 ? '#fff' : INK }} title={`${orgLabel(r)} · ${colLabel(c)} ${v}건`}>{v}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Legend() {
  const S = ({ children }) => <svg width="18" height="14" viewBox="0 0 18 14" style={{ overflow: 'visible' }}>{children}</svg>
  return (
    <div className="lv-legend">
      <span><S><circle cx="9" cy="7" r="5" fill={MUTED} /></S>ISSUE</span>
      <span><S><path d="M9,1 L15,7 L9,13 L3,7 Z" fill={MUTED} /></S>DERIVE (edit·convert·merge·extract)</span>
      <span><S><path d="M9,1 L16,13 L2,13 Z" fill={MUTED} /></S>REGRADE</span>
      <span><S><g stroke={BAD} strokeWidth="2.5"><line x1="4" y1="2" x2="14" y2="12" /><line x1="14" y1="2" x2="4" y2="12" /></g></S>REVOKE</span>
      <span><S><rect x="3" y="1" width="12" height="12" fill="#fff" stroke={INK} strokeWidth="1.5" /></S>DESTROY (키 파기 · 행은 영구)</span>
      <span><S><line x1="0" y1="7" x2="18" y2="7" stroke={NAVY} strokeDasharray="4 3" /></S>체크포인트(머클 봉인)</span>
      <span><S><rect x="0" y="3" width="18" height="8" fill={BAD} /></S>C 비밀</span>
      <span><S><rect x="0" y="3" width="18" height="8" fill={WARN} /></S>S 민감</span>
      <span><S><rect x="0" y="3" width="18" height="8" fill={OK} /></S>O 공개</span>
      <span><S><line x1="0" y1="7" x2="18" y2="7" stroke={WARN} strokeWidth="6" opacity=".85" /><line x1="0" y1="7" x2="18" y2="7" stroke="#fff" strokeWidth="2" strokeDasharray="3 4" /></S>잠정(PROVISIONAL)</span>
    </div>
  )
}

// ---- 데이터 정리 ----
// 이벤트(오름차순) → 문서별 수명 모델. 원장은 행만 쌓이므로 상태는 여기서 재구성한다.
function buildModel(events) {
  const docs = new Map(), byHash = new Map(), bySeq = new Map()
  for (const e of events) {
    bySeq.set(e.seq, e)
    let d = docs.get(e.docGuid)
    if (!d) {
      d = {
        docGuid: e.docGuid, start: e.seq, filename: e.filename, issuerOrg: e.issuerOrg,
        rootDocId: e.rootDocId || e.docGuid, parentHash: e.parentHash, transform: e.transform,
        segments: [{ seq: e.seq, grade: e.grade }], grade: e.grade, end: null, status: 'valid',
        provisional: false, events: [], parent: null, depth: 0
      }
      docs.set(e.docGuid, d)
    }
    d.events.push(e)
    if (e.contentHash && !byHash.has(e.contentHash)) byHash.set(e.contentHash, d)
    if (e.filename && !d.filename) d.filename = e.filename
    if (e.eventType === 'REGRADE') { d.segments.push({ seq: e.seq, grade: e.grade }); d.grade = e.grade }
    if (e.eventType === 'REVOKE') { d.end = e.seq; d.status = 'revoked' }
    if (e.eventType === 'DESTROY') { d.end = e.seq; d.status = 'destroyed' }
    if (e.approvalState) d.provisional = e.approvalState === 'PROVISIONAL'
  }
  for (const d of docs.values()) {
    if (d.status === 'valid' && d.provisional) d.status = 'provisional'
    d.parent = d.parentHash ? byHash.get(d.parentHash) || null : null
  }
  for (const d of docs.values()) { // depth: 부모 사슬 길이(순환 방지 상한 8)
    let p = d.parent, n = 0
    while (p && n < 8) { n++; p = p.parent }
    d.depth = n
  }
  const famMap = new Map()
  for (const d of docs.values()) {
    if (!famMap.has(d.rootDocId)) famMap.set(d.rootDocId, [])
    famMap.get(d.rootDocId).push(d)
  }
  const families = [...famMap.entries()].map(([root, list]) => {
    list.sort((a, b) => (a.docGuid === root ? -1 : b.docGuid === root ? 1 : a.start - b.start))
    return { root, docs: list, start: Math.min(...list.map((d) => d.start)) }
  }).sort((a, b) => a.start - b.start)
  const docList = [...docs.values()]
  const orgCount = {}
  for (const d of docList) orgCount[d.issuerOrg] = (orgCount[d.issuerOrg] || 0) + 1
  const orgs = Object.keys(orgCount).sort((a, b) => orgCount[b] - orgCount[a])
  return { docs, docList, families, bySeq, orgs, dominantOrg: orgs[0] }
}

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (isNaN(d)) return String(v)
  return d.toISOString().slice(0, 10) // UTC 기준 — 원장 표와 같은 기준
}

function hexa(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
