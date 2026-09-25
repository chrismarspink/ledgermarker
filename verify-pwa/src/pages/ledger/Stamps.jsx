import React from 'react'
import { Link } from 'react-router-dom'
import { orgLabel } from '../../lib/orgs.js'

// E. 기관 간 흐름 — (1) 문서 한 건의 여권 스탬프 타임라인: 등급 띠(원장 이벤트) 위에
// 타 기관 게이트 검증 스탬프(관측 로그). (2) 발급기관 → 검증기관 산키(폭 = 검증 건수, 색 = 통과 등급).
// 스탬프·산키는 게이트가 보고한 관측 로그에서 온다 — 원장과 다른 출처, 본문 없음.

const NAVY = '#1a2b4a', OK = '#1e7d46', WARN = '#b07a00', BAD = '#b02a2a'
const MUTED = '#6b7280', LINE = '#e5e7eb', INK = '#111827', GRAY = '#9aa4b2', FAINT = '#c3cad6'
const GRADE_COLOR = { C: BAD, S: WARN, O: OK }
const GRADE_NAME = { C: 'C 비밀', S: 'S 민감', O: 'O 공개' }
const VERDICT_KO = { allow: '허용', review: '검토', deny: '차단' }
const TREATY_KO = { translated: '협정 번역', no_treaty: '협정 없음', expired: '협정 만료', not_translatable: '번역 불가' }
const DAY = 86400000

export default function Stamps({ data }) {
  const { events, observations, treaties, checkpoints } = data
  const docs = React.useMemo(() => buildDocs(events, observations), [events, observations])
  const [pick, setPick] = React.useState('')
  const docId = docs.has(pick) ? pick : [...docs.keys()][0]
  const doc = docId ? docs.get(docId) : null

  if (!observations.length) {
    return (
      <div className="card">
        <h2>기관 간 흐름</h2>
        <p className="hint">관측 로그가 없습니다 — 검증 화면에서 '타 기관으로 보내기'로 기록하거나 샘플을 로딩하세요.</p>
      </div>
    )
  }

  return (
    <>
      <div className="card">
        <h2>E-1. 여권 스탬프 타임라인 — 문서 한 건의 등급 띠와 기관 게이트 통과 기록</h2>
        <p className="lv-sub" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>문서</span>
          <select className="lv-select" value={docId || ''} onChange={(e) => setPick(e.target.value)}>
            {[...docs.values()].map((d) => <option key={d.docGuid} value={d.docGuid}>{d.filename || d.docGuid.slice(0, 8) + '…'} ({d.obs.length}건)</option>)}
          </select>
          {doc && <span>· <Link to={`/lineage/${doc.docGuid}`} className="mono">{doc.docGuid.slice(0, 8)}…</Link> · 발급 {orgLabel(doc.issuerOrg)} · 띠 색 = 그 시점 등급 · 스탬프 = 타 기관 게이트 검증</span>}
        </p>
        {doc && <Timeline doc={doc} treaties={treaties} checkpoints={checkpoints} />}
        <div className="lv-legend">
          <span><i style={ring(NAVY)} />협정 번역 허용</span><span><i style={ring(WARN)} />검토</span><span><i style={ring(GRAY)} />협정 없음(서명만)</span><span><i style={ring(BAD)} />차단 · 협정 만료 · 번역 불가</span>
          <span><i style={{ display: 'inline-block', width: 2, height: 10, background: MUTED }} />SENT(전송)</span>
          <span><i style={{ display: 'inline-block', width: 18, borderTop: `1px dashed ${NAVY}` }} />봉인(체크포인트)</span>
          <span><i style={{ display: 'inline-block', width: 18, height: 8, background: `repeating-linear-gradient(45deg, ${GRAY} 0 1.5px, transparent 1.5px 5px)` }} />협정 만료 이후</span>
        </div>
        <p className="hint">스탬프는 검증 기관이 남기는 관측 로그(원장과 분리, 본문 없음)에서 온다. 띠의 등급 변화는 원장 이벤트의 기록 시각 기준.</p>
      </div>

      <div className="card">
        <h2>E-2. 기관 간 흐름 — 발급기관 → 검증기관 산키</h2>
        <p className="lv-sub">폭 = 게이트 검증(VERIFIED) 건수 · 색 = 통과 시 번역된 등급 · 회색 = 협정 없이(또는 만료 후) 서명 진위만 확인된 흐름 · 전 문서 합산</p>
        <Sankey observations={observations} />
        <div className="lv-legend">
          <span><i style={sw(WARN)} />S 민감으로 통과</span><span><i style={sw(OK)} />O 공개로 통과</span><span><i style={sw(BAD)} />C(있다면 차단 대상)</span><span><i style={sw(GRAY)} />등급 미번역(서명 진위만)</span>
        </div>
        <p className="hint">C 비밀은 기관 밖으로 나가지 않으므로 정상이라면 흐름에 없다 — 있다면 번역 불가로 차단된 시도다. 이 데이터는 게이트 관측 로그이며 원장이 아니다.</p>
      </div>
    </>
  )
}

// ---- (1) 타임라인 ----
function Timeline({ doc, treaties, checkpoints }) {
  const W = 880, H = 326, x0 = 70, x1 = W - 30, bandY = 160, bandH = 30, stampY = 230, axisY = 300
  const evTimes = doc.events.map((e) => +new Date(e.createdAt))
  const obTimes = doc.obs.map((o) => +new Date(o.observedAt || o.createdAt))
  const tMin = Math.min(...evTimes, ...obTimes), tMaxRaw = Math.max(...evTimes, ...obTimes)
  const span = Math.max(tMaxRaw - tMin, 7 * DAY)
  const tMax = tMaxRaw + Math.max(span * 0.08, 3 * DAY)
  const xt = (t) => x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0)

  // 등급 띠: 첫 행의 등급으로 시작, REGRADE마다 색을 바꾼다. REVOKE·DESTROY에서 끝.
  const segs = []
  let cur = null
  for (const e of doc.events) {
    const t = +new Date(e.createdAt)
    if (e.eventType === 'ISSUE' || e.eventType === 'DERIVE') { if (!cur) cur = { from: t, grade: e.grade, seq: e.seq, e } }
    else if (e.eventType === 'REGRADE') { if (cur) { segs.push({ ...cur, to: t }) } cur = { from: t, grade: e.grade, seq: e.seq, e, prev: cur?.grade } }
    else if (e.eventType === 'REVOKE' || e.eventType === 'DESTROY') { if (cur) { segs.push({ ...cur, to: t }); cur = null } }
  }
  if (cur) segs.push({ ...cur, to: tMax })
  const ended = doc.events.find((e) => e.eventType === 'REVOKE' || e.eventType === 'DESTROY')
  const firstEv = doc.events[0]

  // 만료된 협정: 발급기관–스탬프 기관 쌍의 notAfter가 축 안에 들어오면 빗금
  const expiries = []
  for (const org of new Set(doc.obs.map((o) => (o.fromOrg === doc.issuerOrg ? o.toOrg : o.fromOrg)).filter(Boolean))) {
    const t = treaties.find((tr) => pairEq(tr, doc.issuerOrg, org))
    if (!t) continue
    const na = +new Date(t.notAfter)
    if (na < tMax) expiries.push({ org, t: Math.max(na, tMin), id: t.id })
  }

  // 스탬프 자리: 가까우면 아래 줄로 번갈아 내려 겹침을 피한다.
  const stamps = doc.obs.filter((o) => o.kind === 'VERIFIED').map((o) => ({ o, x: xt(+new Date(o.observedAt || o.createdAt)) })).sort((a, b) => a.x - b.x)
  const lastX = [-Infinity, -Infinity]
  for (const s of stamps) {
    s.row = s.x - lastX[0] >= 52 ? 0 : s.x - lastX[1] >= 52 ? 1 : 0
    lastX[s.row] = s.x
  }
  const sents = doc.obs.filter((o) => o.kind === 'SENT')
  const ticks = timeTicks(tMin, tMax)
  // 띠 위 주석(발급·REGRADE·폐기) 단 배정: 80px 안에 다른 주석이 있으면 한 단 위로
  const slots = []
  const slotOf = (x) => { for (let i = 0; i < slots.length; i++) if (x - slots[i] >= 80) { slots[i] = x; return i } slots.push(x); return slots.length - 1 }
  const issueSlot = firstEv ? slotOf(xt(+new Date(firstEv.createdAt))) : 0
  const regrades = segs.filter((s) => s.e.eventType === 'REGRADE').map((s) => ({ ...s, slot: slotOf(xt(s.from)) }))
  const endSlot = ended ? slotOf(xt(+new Date(ended.createdAt))) : 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="여권 스탬프 타임라인" style={{ display: 'block' }}>
      <defs><pattern id="lvHatchE" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={GRAY} strokeWidth="1.5" /></pattern></defs>
      <line x1={x0} y1={axisY} x2={x1} y2={axisY} stroke={LINE} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={xt(t.t)} y1={60} x2={xt(t.t)} y2={axisY} stroke="#eef1f6" />
          <text x={xt(t.t)} y={axisY + 16} fontSize="10" fill={MUTED} textAnchor="middle">{t.label}</text>
        </g>
      ))}

      {segs.map((s, i) => {
        const a = xt(s.from), b = Math.max(a + 2, xt(s.to))
        const label = i === 0 ? `${GRADE_NAME[s.grade] || s.grade || '?'} (${doc.issuerOrg} 발급, seq ${s.seq} ${s.e.eventType}${s.e.transform ? ` ← ${s.e.transform}` : ''})` : GRADE_NAME[s.grade] || s.grade
        return (
          <g key={i}>
            <title>{`${GRADE_NAME[s.grade] || s.grade} · ${fmtDate(s.from)} ~ ${s.to === tMax ? '현재' : fmtDate(s.to)} · seq ${s.seq}`}</title>
            <rect x={a} y={bandY} width={b - a} height={bandH} rx="6" fill={GRADE_COLOR[s.grade] || MUTED} opacity=".9" />
            {b - a > label.length * 7 + 30 && <text x={a + 20} y={bandY + 20} fontSize="12" fill="#fff" fontWeight="700">{label}</text>}
          </g>
        )
      })}
      {ended && <line x1={xt(+new Date(ended.createdAt))} y1={bandY + bandH / 2} x2={x1} y2={bandY + bandH / 2} stroke={FAINT} strokeWidth="2" strokeDasharray="3 5" />}
      {expiries.map((ex, i) => (
        <g key={ex.org}>
          <title>{`${doc.issuerOrg}–${ex.org} 협정 ${ex.id} 만료 ${fmtDate(ex.t)} 이후`}</title>
          <rect x={xt(ex.t)} y={bandY} width={Math.max(0, x1 - xt(ex.t))} height={bandH} rx="6" fill="url(#lvHatchE)" opacity=".8" />
          <text x={(xt(ex.t) + x1) / 2} y={bandY - 6 - i * 12} fontSize="10" fill={MUTED} textAnchor="middle">{doc.issuerOrg}–{ex.org} 협정 만료 이후</text>
        </g>
      ))}

      {/* 발급 지점 · 등급변경 · 폐기 */}
      {firstEv && (
        <g>
          <title>{`${firstEv.eventType} seq ${firstEv.seq} · ${fmtDate(firstEv.createdAt)}`}</title>
          <circle cx={xt(+new Date(firstEv.createdAt))} cy={bandY + bandH / 2} r="9" fill={GRADE_COLOR[firstEv.grade] || MUTED} stroke="#fff" strokeWidth="2" />
          <text x={xt(+new Date(firstEv.createdAt))} y={bandY - 22 - issueSlot * 26} fontSize="10" fill={INK} textAnchor="middle" fontWeight="700">발급 (seq {firstEv.seq})</text>
          <text x={xt(+new Date(firstEv.createdAt))} y={bandY - 10 - issueSlot * 26} fontSize="9" fill={MUTED} textAnchor="middle">{fmtDate(firstEv.createdAt).slice(5)}</text>
        </g>
      )}
      {regrades.map((s) => {
        const x = xt(s.from), c = GRADE_COLOR[s.grade] || MUTED, dy = s.slot * 26
        return (
          <g key={s.seq}>
            <title>{`REGRADE ${s.prev || '?'}→${s.grade} · seq ${s.seq} · ${fmtDate(s.from)}${s.e.reason ? `\n${s.e.reason}` : ''}`}</title>
            <path d={`M${x},${bandY - 14} L${x + 10},${bandY + 2} L${x - 10},${bandY + 2} Z`} fill={c} stroke="#fff" strokeWidth="2" />
            {dy > 0 && <line x1={x} y1={bandY - 14} x2={x} y2={bandY - 8 - dy} stroke={c} strokeDasharray="2 2" />}
            <text x={x} y={bandY - 22 - dy} fontSize="10" fill={c} textAnchor="middle" fontWeight="700">REGRADE {s.prev || '?'}→{s.grade}</text>
            <text x={x} y={bandY - 10 - dy} fontSize="9" fill={MUTED} textAnchor="middle">{fmtDate(s.from).slice(5)} · seq {s.seq}</text>
          </g>
        )
      })}
      {ended && (
        <g>
          <title>{`${ended.eventType} seq ${ended.seq} · ${fmtDate(ended.createdAt)}${ended.reason ? `\n${ended.reason}` : ''}`}</title>
          <g stroke={ended.eventType === 'REVOKE' ? BAD : INK} strokeWidth="3" strokeLinecap="round">
            <line x1={xt(+new Date(ended.createdAt)) - 6} y1={bandY + 9} x2={xt(+new Date(ended.createdAt)) + 6} y2={bandY + 21} />
            <line x1={xt(+new Date(ended.createdAt)) + 6} y1={bandY + 9} x2={xt(+new Date(ended.createdAt)) - 6} y2={bandY + 21} />
          </g>
          <text x={xt(+new Date(ended.createdAt))} y={bandY - 12 - endSlot * 26} fontSize="10" fill={ended.eventType === 'REVOKE' ? BAD : INK} textAnchor="middle" fontWeight="700">{ended.eventType} · seq {ended.seq}</text>
        </g>
      )}

      {/* SENT 눈금 */}
      {sents.map((o) => (
        <line key={o.id} x1={xt(+new Date(o.observedAt || o.createdAt))} y1={bandY - 6} x2={xt(+new Date(o.observedAt || o.createdAt))} y2={bandY} stroke={MUTED} strokeWidth="2">
          <title>{`SENT → ${o.toOrg} · ${fmtDate(o.observedAt || o.createdAt)}`}</title>
        </line>
      ))}

      {/* 스탬프 */}
      {stamps.map(({ o, x, row }) => {
        const c = stampColor(o), y = stampY + row * 30, dashed = o.treaty === 'translated'
        const line2 = o.translatedGrade ? `${o.grade}→${o.translatedGrade} ${VERDICT_KO[o.verdictHint] || ''}`.trim() : o.treaty === 'no_treaty' ? '서명만' : o.treaty === 'expired' ? '협정 만료' : o.treaty === 'not_translatable' ? '번역 불가' : VERDICT_KO[o.verdictHint] || ''
        const top1 = 60 + row * 24, top2 = top1 + 12
        const org = o.toOrg === doc.issuerOrg ? o.fromOrg : o.toOrg
        return (
          <g key={o.id}>
            <title>{`${fmtDate(o.observedAt || o.createdAt)} · ${orgLabel(o.fromOrg)} → ${orgLabel(o.toOrg)}\n${TREATY_KO[o.treaty] || o.treaty || ''}${o.translatedGrade ? ` · ${o.grade}→${o.translatedGrade}` : o.grade ? ` · 등급 ${o.grade}` : ''} · ${VERDICT_KO[o.verdictHint] || o.verdictHint || ''}${o.note ? `\n${o.note}` : ''}`}</title>
            <line x1={x} y1={top2 + 4} x2={x} y2={bandY - 2} stroke={FAINT} strokeDasharray="2 3" />
            <line x1={x} y1={bandY + bandH} x2={x} y2={y - 24} stroke={c} />
            <circle cx={x} cy={y} r="24" fill="#fff" stroke={c} strokeWidth="2.5" />
            {dashed && <circle cx={x} cy={y} r="19" fill="none" stroke={c} strokeWidth=".8" strokeDasharray="2 2" />}
            <text x={x} y={y - 3} fontSize={org && org.length > 6 ? 8 : 10} fontWeight="700" fill={c} textAnchor="middle">{org}</text>
            <text x={x} y={y + 9} fontSize="9" fill={c} textAnchor="middle">{line2}</text>
            <text x={x} y={top1} fontSize="10" fill={MUTED} textAnchor="middle">{fmtDate(o.observedAt || o.createdAt).slice(5)} · {o.treaty === 'no_treaty' ? '협정 없음' : o.treaty === 'expired' ? '협정 만료' : '게이트 검증'}</text>
            <text x={x} y={top2} fontSize="10" fill={c} textAnchor="middle" fontWeight="700">{o.verdictHint || ''}{o.treaty === 'no_treaty' || o.treaty === 'expired' ? ' · 서명만' : o.treaty === 'not_translatable' ? ' · 번역 불가' : ''}</text>
          </g>
        )
      })}

      {/* 체크포인트(서명 시각) */}
      {checkpoints.filter((c) => { const t = +new Date(c.signedAt); return t >= tMin && t <= tMax }).map((c) => (
        <g key={c.ckptId}>
          <title>{`봉인 #${c.ckptId} · seq ${c.fromSeq}~${c.toSeq} · ${fmtDate(c.signedAt)}`}</title>
          <line x1={xt(+new Date(c.signedAt))} y1={bandY - 6} x2={xt(+new Date(c.signedAt))} y2={axisY} stroke={NAVY} strokeDasharray="5 4" />
          <text x={xt(+new Date(c.signedAt)) + 3} y={axisY - 5 - (c.ckptId % 2) * 10} fontSize="9" fill={NAVY}>봉인 #{c.ckptId}</text>
        </g>
      ))}
    </svg>
  )
}

function stampColor(o) {
  if (o.treaty === 'expired' || o.treaty === 'not_translatable') return BAD
  if (o.treaty === 'no_treaty') return GRAY
  if (o.verdictHint === 'deny') return BAD
  if (o.verdictHint === 'review') return WARN
  return NAVY
}

// ---- (2) 산키 ----
function Sankey({ observations }) {
  const flows = new Map()
  for (const o of observations) {
    if (o.kind !== 'VERIFIED' || !o.fromOrg || !o.toOrg) continue
    const kind = o.treaty === 'translated' && o.translatedGrade ? o.translatedGrade : 'none'
    const k = `${o.fromOrg}|${o.toOrg}|${kind}`
    if (!flows.has(k)) flows.set(k, { from: o.fromOrg, to: o.toOrg, kind, n: 0 })
    flows.get(k).n++
  }
  const list = [...flows.values()]
  if (!list.length) return <p className="hint">VERIFIED 관측이 없습니다.</p>
  const total = (side, id) => list.filter((f) => f[side] === id).reduce((s, f) => s + f.n, 0)
  const lefts = [...new Set(list.map((f) => f.from))].sort((a, b) => total('from', b) - total('from', a))
  const rights = [...new Set(list.map((f) => f.to))].sort((a, b) => total('to', b) - total('to', a))
  const sumL = lefts.reduce((s, o) => s + total('from', o), 0)
  const W = 880, PH = 260, top = 24, gap = 12, xl = 150, xr = 700, nw = 22
  const usable = PH - gap * (Math.max(lefts.length, rights.length) - 1)
  const scale = usable / sumL
  const place = (ids, side) => {
    const m = new Map(); let y = top
    for (const id of ids) { const h = total(side, id) * scale; m.set(id, { y, h, off: 0 }); y += h + gap }
    return m
  }
  const L = place(lefts, 'from'), R = place(rights, 'to')
  const H = top + Math.max(...[...L.values(), ...R.values()].map((p) => p.y + p.h)) - top + 30
  // 리본 배정 순서: 왼쪽은 오른쪽 노드 순서대로, 오른쪽은 왼쪽 노드 순서대로 쌓아 교차를 줄인다.
  const ordered = [...list].sort((a, b) => rights.indexOf(a.to) - rights.indexOf(b.to) || lefts.indexOf(a.from) - lefts.indexOf(b.from) || 'CSOn'.indexOf(a.kind[0]) - 'CSOn'.indexOf(b.kind[0]))
  const ribbons = []
  for (const f of ordered) {
    const l = L.get(f.from), h = f.n * scale
    f.ly = l.y + l.off; l.off += h; f.h = h
  }
  for (const f of [...ordered].sort((a, b) => lefts.indexOf(a.from) - lefts.indexOf(b.from) || rights.indexOf(a.to) - rights.indexOf(b.to) || 'CSOn'.indexOf(a.kind[0]) - 'CSOn'.indexOf(b.kind[0]))) {
    const r = R.get(f.to)
    f.ry = r.y + r.off; r.off += f.h
    ribbons.push(f)
  }
  const mx = (xl + nw + xr) / 2
  const color = (k) => GRADE_COLOR[k] || GRAY
  const kindKo = (k) => k === 'none' ? '서명만 (협정 없음·만료)' : `${k}→${k}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="기관 간 흐름 산키" style={{ display: 'block' }}>
      {ribbons.map((f, i) => (
        <path key={i} d={`M${xl + nw},${f.ly} C${mx},${f.ly} ${mx},${f.ry} ${xr},${f.ry} L${xr},${f.ry + f.h} C${mx},${f.ry + f.h} ${mx},${f.ly + f.h} ${xl + nw},${f.ly + f.h} Z`} fill={color(f.kind)} opacity=".5">
          <title>{`${orgLabel(f.from)} → ${orgLabel(f.to)}\n${kindKo(f.kind)} · ${f.n}건`}</title>
        </path>
      ))}
      {ribbons.filter((f) => f.h >= 13).map((f, i) => (
        <text key={'t' + i} x={mx} y={(f.ly + f.ry) / 2 + f.h / 2 + 4} fontSize="11" fill={f.kind === 'none' ? MUTED : INK} textAnchor="middle" paintOrder="stroke" stroke="#fff" strokeWidth="3">{f.kind === 'none' ? `서명만 ${f.n}` : `${f.kind}→${f.kind} ${f.n}`}</text>
      ))}
      {lefts.map((o) => {
        const p = L.get(o)
        return (
          <g key={o}>
            <title>{`${orgLabel(o)} · 보낸 문서 검증 ${total('from', o)}건`}</title>
            <rect x={xl} y={p.y} width={nw} height={p.h} rx="4" fill={NAVY} />
            <text x={xl - 10} y={p.y + p.h / 2 + 4} fontSize="12" fontWeight="700" fill={NAVY} textAnchor="end">{o}</text>
            {p.h >= 30 && <text x={xl - 10} y={p.y + p.h / 2 + 18} fontSize="10" fill={MUTED} textAnchor="end">발급측 · 검증 {total('from', o)}</text>}
          </g>
        )
      })}
      {rights.map((o) => {
        const p = R.get(o)
        const byKind = ['S', 'O', 'C', 'none'].map((k) => [k, list.filter((f) => f.to === o && f.kind === k).reduce((s, f) => s + f.n, 0)]).filter(([, n]) => n)
        return (
          <g key={o}>
            <title>{`${orgLabel(o)} · 받은 문서 검증 ${total('to', o)}건`}</title>
            <rect x={xr} y={p.y} width={nw} height={p.h} rx="4" fill={byKind.every(([k]) => k === 'none') ? GRAY : NAVY} />
            <text x={xr + nw + 10} y={p.y + p.h / 2 + 4} fontSize="12" fontWeight="700" fill={NAVY}>{o}</text>
            {p.h >= 30 && <text x={xr + nw + 10} y={p.y + p.h / 2 + 18} fontSize="10" fill={MUTED}>{total('to', o)}건 · {byKind.map(([k, n]) => `${k === 'none' ? '서명만' : k} ${n}`).join(' · ')}</text>}
          </g>
        )
      })}
      <text x={xl} y={14} fontSize="11" fill={MUTED}>발급기관(fromOrg)</text>
      <text x={xr + nw} y={14} fontSize="11" fill={MUTED} textAnchor="end">검증기관(toOrg)</text>
    </svg>
  )
}

// ---- 데이터 정리 ----
// 관측이 있는 문서만, 관측 많은 순. 원장 이벤트로 파일명·발급기관·등급 이력을 붙인다.
function buildDocs(events, observations) {
  const byDoc = new Map()
  for (const o of observations) {
    if (!byDoc.has(o.docGuid)) byDoc.set(o.docGuid, { docGuid: o.docGuid, obs: [], events: [], filename: '', issuerOrg: o.fromOrg })
    byDoc.get(o.docGuid).obs.push(o)
  }
  for (const e of events) {
    const d = byDoc.get(e.docGuid)
    if (!d) continue
    d.events.push(e)
    if (e.filename && !d.filename) d.filename = e.filename
    if (e.issuerOrg && d.events.length === 1) d.issuerOrg = e.issuerOrg
  }
  for (const d of byDoc.values()) d.obs.sort((a, b) => new Date(a.observedAt || a.createdAt) - new Date(b.observedAt || b.createdAt))
  return new Map([...byDoc.values()].sort((a, b) => b.obs.length - a.obs.length).map((d) => [d.docGuid, d]))
}

function pairEq(t, a, b) { return (t.partyA === a && t.partyB === b) || (t.partyA === b && t.partyB === a) }

// 시간축 눈금: 기간에 따라 일·주·월 단위 중 10개 이하가 되는 것을 고른다.
function timeTicks(t0, t1) {
  const span = t1 - t0
  const out = []
  if (span <= 45 * DAY) {
    const step = span <= 10 * DAY ? 1 : 7
    const d = new Date(t0); d.setHours(0, 0, 0, 0)
    for (; +d <= t1; d.setDate(d.getDate() + step)) if (+d >= t0) out.push({ t: +d, label: fmtDate(d) })
  } else {
    const months = span / (30 * DAY), step = months <= 10 ? 1 : months <= 30 ? 3 : 12
    const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0)
    for (; +d <= t1; d.setMonth(d.getMonth() + step)) if (+d >= t0) out.push({ t: +d, label: fmtDate(d).slice(0, 7) })
  }
  return out
}

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (isNaN(d)) return String(v)
  return d.toISOString().slice(0, 10) // UTC 기준 — 원장 표와 같은 기준
}
function ring(c) { return { display: 'inline-block', width: 10, height: 10, borderRadius: 6, border: `2px solid ${c}`, background: '#fff' } }
function sw(c) { return { display: 'inline-block', width: 14, height: 8, background: c, opacity: 0.6 } }
