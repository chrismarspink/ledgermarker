import React from 'react'
import { orgLabel, ORG_NAMES } from '../../lib/orgs.js'

// D. 기관 지도 — 노드 = 기관, 간선 = 등가성 협정(gradeMap·유효기간). 협정 없이 관측만 있는 쌍은
// 회색 점선 "서명 진위까지만"(treaty-policy 1단계). 간선을 클릭하면 등급 번역 매트릭스.
// 상태 기준 시각은 브라우저의 지금(Date.now) — 만료 임박은 120일.

const NAVY = '#1a2b4a', OK = '#1e7d46', WARN = '#b07a00', BAD = '#b02a2a'
const MUTED = '#6b7280', GRAY = '#9aa4b2'
const GRADE_COLOR = { C: BAD, S: WARN, O: OK }
const SOON_DAYS = 120

export default function PassportMap({ data }) {
  const model = React.useMemo(() => buildModel(data), [data])
  const [selKey, setSelKey] = React.useState(null)
  const [flip, setFlip] = React.useState(false)
  const sel = model.edges.find((e) => e.key === selKey) || model.edges.find((e) => e.treaty && e.status !== 'expired') || model.edges[0] || null

  if (!model.orgs.length) {
    return <div className="card"><p className="hint">기관·협정·관측 데이터가 없습니다 — 서버에 협정(treaty)을 구성하거나 샘플을 로딩하세요.</p></div>
  }

  const center = model.orgs[0]
  const ring = model.orgs.slice(1)
  const R = ring.length <= 8 ? 215 : 225
  const outerR = R + 82 // 고리 노드끼리의 간선이 도는 우회 반지름
  const W = 720, cx = W / 2
  const pos = new Map()
  const rNode = (o) => o === center ? 60 : ring.length > 6 ? 36 : 46
  // 간선 기하를 먼저 계산해 실제로 쓰이는 높이만큼만 캔버스를 잡는다(우회 호가 아래로 돌 때만 커진다)
  const layout = (cy) => {
    pos.set(center, { x: cx, y: cy })
    ring.forEach((o, i) => {
      const a = -Math.PI / 2 - Math.PI / 4 + (i / Math.max(ring.length, 1)) * Math.PI * 2 // 좌상단부터 시계방향
      pos.set(o, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
    })
    return model.edges.map((e) => edgeGeom(e, pos.get(e.a), pos.get(e.b), center, cx, cy, outerR))
  }
  const probe = layout(0)
  const minY = Math.min(-R - 46, ...probe.map((g) => g.minY)), maxY = Math.max(R + 46, ...probe.map((g) => g.maxY))
  const cy = -minY + 16
  const geos = layout(cy)
  const H = cy + maxY + 72

  return (
    <>
      <div className="card">
        <h2>기관 지도 — 여권 지도(등가성 협정)</h2>
        <p className="lv-sub">노드 = 기관(발급 건수), 간선 = 협정(gradeMap·유효기간), 굵기 = 두 기관 사이 게이트 검증 건수(관측 로그). 간선을 클릭하면 아래에 등급 번역 매트릭스.</p>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="기관 협정 지도" style={{ display: 'block', maxWidth: W, margin: '0 auto' }}>
          <defs><pattern id="lvHatchD" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={GRAY} strokeWidth="1.5" /></pattern></defs>
          {model.edges.map((e, i) => {
            const { d, lx, ly } = geos[i]
            const st = edgeStyle(e)
            const isSel = sel && sel.key === e.key
            const lines = e.treaty
              ? [`${e.treaty.id}${e.status === 'soon' ? ` · 만료 D-${e.days}` : e.status === 'expired' ? ' · 만료' : ''}`, `${mapSummary(e.treaty.gradeMap)} · ~${fmtDate(e.treaty.notAfter)}`]
              : ['협정 없음 — 서명만', `검증 ${e.verified}건 · CA 교환만`]
            const lw = Math.max(120, Math.max(...lines.map((s) => s.length)) * 6.2 + 20)
            return (
              <g key={e.key} className="lv-clickable" onClick={() => setSelKey(e.key)}>
                <title>{`${e.a} ↔ ${e.b}\n${lines.join('\n')}\n검증 ${e.verified}건 · 전송 ${e.sent}건`}</title>
                <path d={d} fill="none" stroke="transparent" strokeWidth="18" />
                <path d={d} fill="none" stroke={st.stroke} strokeWidth={2 + Math.min(6, e.verified * 0.6)} strokeDasharray={st.dash} opacity={isSel ? 1 : 0.85} />
                <rect x={lx - lw / 2} y={ly - 17} width={lw} height="34" rx="8" fill="#fff" stroke={st.stroke} strokeWidth={isSel ? 2 : 1} />
                <text x={lx} y={ly - 3} fontSize="10" textAnchor="middle" fill={st.stroke} fontWeight="700">{lines[0]}</text>
                <text x={lx} y={ly + 11} fontSize="10" textAnchor="middle" fill={MUTED}>{lines[1]}</text>
              </g>
            )
          })}
          {model.orgs.map((o) => {
            const p = pos.get(o), r = rNode(o), isC = o === center
            const worst = model.orgStatus.get(o)
            const stroke = worst === 'expired' ? BAD : worst === 'soon' ? WARN : NAVY
            const fill = isC ? NAVY : worst === 'expired' ? '#fdecec' : worst === 'soon' ? '#fff8e6' : '#eef1f6'
            const stat = model.orgStats.get(o)
            const hl = sel && (sel.a === o || sel.b === o)
            return (
              <g key={o}>
                <title>{`${orgLabel(o)}\n발급 ${stat.issued}건 · 협정 ${stat.treaties}건\n보낸 문서 검증 ${stat.out}건 · 받은 문서 검증 ${stat.in}건`}</title>
                {hl && <circle cx={p.x} cy={p.y} r={r + 8} fill="none" stroke={NAVY} strokeWidth="1.5" strokeDasharray="4 3" />}
                <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={stroke} strokeWidth="2" />
                <text x={p.x} y={p.y - (isC ? 8 : 4)} fontSize={isC ? 15 : 13} fontWeight="700" fill={isC ? '#fff' : stroke} textAnchor="middle">{o}</text>
                <text x={p.x} y={p.y + (isC ? 10 : 12)} fontSize="10" fill={isC ? '#c3cad6' : MUTED} textAnchor="middle">{ORG_NAMES[o.toUpperCase()] || ''}</text>
                <text x={p.x} y={p.y + (isC ? 28 : 26)} fontSize="10" fill={isC ? '#fff' : MUTED} textAnchor="middle">발급 {stat.issued} · 협정 {stat.treaties}</text>
              </g>
            )
          })}
          <g fontSize="11" fill={MUTED}>
            <line x1="20" y1={H - 34} x2="50" y2={H - 34} stroke={NAVY} strokeWidth="4" /><text x="58" y={H - 30}>협정 유효 (굵기 = 상호 검증 건수)</text>
            <line x1="268" y1={H - 34} x2="298" y2={H - 34} stroke={WARN} strokeWidth="3" strokeDasharray="8 5" /><text x="306" y={H - 30}>만료 임박 ({SOON_DAYS}일 이내)</text>
            <line x1="450" y1={H - 34} x2="480" y2={H - 34} stroke={BAD} strokeWidth="3" strokeDasharray="8 5" /><text x="488" y={H - 30}>만료</text>
            <line x1="540" y1={H - 34} x2="570" y2={H - 34} stroke={GRAY} strokeWidth="2" strokeDasharray="3 5" /><text x="578" y={H - 30}>협정 없음(서명만)</text>
            <text x="20" y={H - 8}>폐기의 진실원천은 발급 기관 원장 — 상대 기관은 조회 또는 서명된 체크포인트로 확인 (treaty-policy §4)</text>
          </g>
        </svg>
      </div>

      <div className="lv-row">
        <div className="lv-box">
          {sel ? <TreatyDetail e={sel} flip={flip} setFlip={setFlip} /> : <p className="hint">협정이 없습니다.</p>}
        </div>
        <div>
          <div className="viz-h" style={{ marginTop: 0 }}>협정 현황</div>
          <div className="tablewrap">
            <table className="ledger">
              <thead><tr><th>당사자</th><th>번역</th><th>만료</th><th>검증</th><th>상태</th></tr></thead>
              <tbody>
                {model.edges.map((e) => {
                  const st = edgeStyle(e)
                  return (
                    <tr key={e.key} className={sel && sel.key === e.key ? 'hl lv-clickable' : 'lv-clickable'} onClick={() => setSelKey(e.key)}>
                      <td title={`${orgLabel(e.a)} ↔ ${orgLabel(e.b)}`}>{e.a} ↔ {e.b}</td>
                      <td>{e.treaty ? mapSummary(e.treaty.gradeMap) : <span className="hint">—</span>}</td>
                      <td>{e.treaty ? fmtDate(e.treaty.notAfter) : <span className="hint">—</span>}</td>
                      <td>{e.verified}건</td>
                      <td style={{ color: st.stroke, fontWeight: 700 }}>{e.treaty ? (e.status === 'valid' ? '유효' : e.status === 'soon' ? `D-${e.days}` : '만료') : '협정 없음'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">검증 건수는 게이트 관측 로그(VERIFIED)에서 센다 — 원장이 아닌 별도 출처. 협정 없음 행은 관측에는 있으나 협정이 없는 기관 쌍.</p>
        </div>
      </div>
    </>
  )
}

// 선택한 협정 — 등급 번역 매트릭스. 행 = 발급 등급, 열 = 상대 게이트가 읽는 등급.
function TreatyDetail({ e, flip, setFlip }) {
  const t = e.treaty
  const issuer = flip ? e.b : e.a, verifier = flip ? e.a : e.b
  const st = edgeStyle(e)
  const map = t ? t.gradeMap || {} : {}
  const grades = ['C', 'S', 'O']
  const colX = { C: 150, S: 230, O: 310, none: 375 }
  return (
    <>
      <div className="t">선택한 {t ? '협정' : '기관 쌍'}</div>
      <div className="h">{e.a} ↔ {e.b}{t ? ` · ${t.id}` : ''}</div>
      {t ? (
        <div className="hint">체결 {fmtDate(t.signedAt)} · 만료 {fmtDate(t.notAfter)} · 상태 <b style={{ color: st.stroke }}>{e.status === 'valid' ? '유효' : e.status === 'soon' ? `만료 임박 D-${e.days}` : '만료'}</b> · 검증 {e.verified}건</div>
      ) : (
        <div className="hint">협정 없음 — CA만 교환 · 서명 진위까지만 검증 · 등급 미번역 · 검증 {e.verified}건(모두 검토 대상)</div>
      )}
      <div className="viz-h">등급 번역 매트릭스 (gradeMap) <button className="link" style={{ fontSize: 11 }} onClick={() => setFlip(!flip)}>방향 바꾸기</button></div>
      <svg viewBox="0 0 400 190" width="100%" style={{ maxWidth: 400, display: 'block' }} role="img" aria-label="등급 번역 매트릭스">
        <defs><pattern id="lvHatchD2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={GRAY} strokeWidth="1.5" /></pattern></defs>
        <text x="230" y="14" fontSize="11" fill={MUTED} textAnchor="middle">{verifier} 게이트가 읽는 등급 →</text>
        <g fontSize="12" fontWeight="700" textAnchor="middle">
          {grades.map((g) => <text key={g} x={colX[g]} y="40" fill={GRADE_COLOR[g]}>{g}</text>)}
          <text x={colX.none} y="40" fill={MUTED} fontSize="10">불가</text>
        </g>
        <text x="12" y="70" fontSize="10" fill={MUTED}>{issuer}</text><text x="12" y="82" fontSize="10" fill={MUTED}>발급 등급</text>
        {grades.map((g, i) => {
          const y = 56 + i * 44
          const to = g === 'C' ? null : map[g]
          return (
            <g key={g}>
              <text x="95" y={y + 20} fontSize="12" fontWeight="700" fill={GRADE_COLOR[g]} textAnchor="middle">{g}</text>
              {grades.map((h) => {
                const hit = to === h
                return (
                  <g key={h}>
                    <title>{g === 'C' ? 'C 비밀은 기관 내부 전용 — 번역 대상 아님' : hit ? `${g}→${h}: 협정으로 번역` : `${g}→${h}: 매핑 없음`}</title>
                    <rect x={colX[h] - 35} y={y} width="70" height="36" rx="5" fill={g === 'C' ? 'url(#lvHatchD2)' : hit ? NAVY : '#eef1f6'} />
                    {hit && <text x={colX[h]} y={y + 23} fontSize="12" fill="#fff" textAnchor="middle" fontWeight="700">{g}→{h}</text>}
                  </g>
                )
              })}
              <rect x={colX.none - 20} y={y} width="40" height="36" rx="5" fill={g === 'C' ? BAD : !t || !to ? GRAY : '#eef1f6'} opacity={g === 'C' ? 0.85 : 1} />
              {(g === 'C' || !t || !to) && <text x={colX.none} y={y + 23} fontSize="11" fill="#fff" textAnchor="middle">{g === 'C' ? '차단' : '미번역'}</text>}
            </g>
          )
        })}
      </svg>
      <div className="hint" style={{ lineHeight: 1.6 }}>빗금 = C(비밀)는 기관 내부 전용, 협정 번역 대상 아님 → 상대 기관 게이트에서 항상 차단. PROVISIONAL 라벨도 번역 제외. 회색 = 협정에 매핑이 없어 서명 진위만 확인.</div>
    </>
  )
}


// 간선 기하: 중심 간선은 직선(라벨은 중심에서 55% 지점), 고리 노드끼리는 고리 바깥 우회 호.
// 정반대 위치면 위쪽으로 돈다. minY/maxY는 캔버스 높이 계산용(중심 y=0 기준 상대값 아님 — 호출 시 cy 반영).
function edgeGeom(e, a, b, center, cx, cy, outerR) {
  if (!a || !b) return { d: '', lx: 0, ly: 0, minY: 0, maxY: 0 }
  const outer = e.a !== center && e.b !== center
  if (!outer) {
    const c0 = e.a === center ? a : b, c1 = e.a === center ? b : a
    const lx = c0.x + (c1.x - c0.x) * 0.55, ly = c0.y + (c1.y - c0.y) * 0.55
    return { d: `M${a.x},${a.y} L${b.x},${b.y}`, lx, ly, minY: ly - 17 - cy, maxY: ly + 17 - cy }
  }
  const ta = Math.atan2(a.y - cy, a.x - cx), tb = Math.atan2(b.y - cy, b.x - cx)
  let dt = tb - ta
  while (dt > Math.PI) dt -= 2 * Math.PI
  while (dt <= -Math.PI) dt += 2 * Math.PI
  if (Math.abs(Math.abs(dt) - Math.PI) < 0.01 && Math.sin(ta + dt / 2) > 0) dt = -dt
  const p = (t, r) => [cx + r * Math.cos(t), cy + r * Math.sin(t)]
  const [p1x, p1y] = p(ta, outerR), [p2x, p2y] = p(ta + dt, outerR)
  const [lx, ly] = p(ta + dt / 2, outerR)
  // 호가 지나는 각도 범위에 위(-π/2)·아래(π/2)가 들어가면 그 끝까지 캔버스가 필요하다
  const covers = (ang) => { let x = ang - ta; while (x > Math.PI) x -= 2 * Math.PI; while (x <= -Math.PI) x += 2 * Math.PI; return dt > 0 ? x >= 0 && x <= dt : x <= 0 && x >= dt }
  const ys = [p1y, p2y, ly - 17, ly + 17]
  if (covers(-Math.PI / 2)) ys.push(cy - outerR)
  if (covers(Math.PI / 2)) ys.push(cy + outerR)
  return { d: `M${a.x},${a.y} L${p1x},${p1y} A${outerR},${outerR} 0 0 ${dt > 0 ? 1 : 0} ${p2x},${p2y} L${b.x},${b.y}`, lx, ly, minY: Math.min(...ys) - cy, maxY: Math.max(...ys) - cy }
}

function edgeStyle(e) {
  if (!e.treaty) return { stroke: GRAY, dash: '3 5' }
  if (e.status === 'expired') return { stroke: BAD, dash: '8 5' }
  if (e.status === 'soon') return { stroke: WARN, dash: '8 5' }
  return { stroke: NAVY, dash: undefined }
}

function mapSummary(gm) {
  const ks = Object.keys(gm || {}).sort((a, b) => 'CSO'.indexOf(a) - 'CSO'.indexOf(b))
  return ks.length ? ks.map((k) => `${k}→${gm[k]}`).join(' · ') : '매핑 없음'
}

// ---- 데이터 정리 ----
function buildModel(data) {
  const { events = [], treaties = [], observations = [], issuers = [] } = data
  const now = Date.now()
  const issued = {}
  for (const e of events) if (e.eventType === 'ISSUE' || e.eventType === 'DERIVE') issued[e.issuerOrg] = (issued[e.issuerOrg] || 0) + 1
  const orgSet = new Set([...issuers.map((i) => i.orgId), ...treaties.flatMap((t) => [t.partyA, t.partyB]), ...observations.flatMap((o) => [o.fromOrg, o.toOrg]), ...Object.keys(issued)].filter(Boolean))
  // 중심 = 발급이 가장 많은 기관(기본 발급기관), 나머지는 발급 수 순으로 고리에
  const orgs = [...orgSet].sort((a, b) => (issued[b] || 0) - (issued[a] || 0) || a.localeCompare(b))

  const pairKey = (a, b) => [a, b].sort().join('|')
  const pairs = new Map()
  const getPair = (a, b) => {
    const k = pairKey(a, b)
    if (!pairs.has(k)) { const [x, y] = k.split('|'); pairs.set(k, { key: k, a: x, b: y, treaty: null, verified: 0, sent: 0 }) }
    return pairs.get(k)
  }
  for (const t of treaties) {
    const p = getPair(t.partyA, t.partyB)
    // 같은 쌍에 협정이 여럿이면 가장 늦게 만료되는 것을 대표로
    if (!p.treaty || new Date(t.notAfter) > new Date(p.treaty.notAfter)) p.treaty = t
  }
  for (const o of observations) {
    if (!o.fromOrg || !o.toOrg || o.fromOrg === o.toOrg) continue
    const p = getPair(o.fromOrg, o.toOrg)
    if (o.kind === 'VERIFIED') p.verified++
    if (o.kind === 'SENT') p.sent++
  }
  const edges = [...pairs.values()].map((p) => {
    if (!p.treaty) return { ...p, status: 'none', days: null }
    const days = Math.ceil((new Date(p.treaty.notAfter).getTime() - now) / 86400000)
    return { ...p, days, status: days < 0 ? 'expired' : days <= SOON_DAYS ? 'soon' : 'valid' }
  }).sort((a, b) => (a.treaty ? 0 : 1) - (b.treaty ? 0 : 1) || a.key.localeCompare(b.key))

  const orgStatus = new Map(), orgStats = new Map()
  for (const o of orgs) {
    orgStats.set(o, { issued: issued[o] || 0, treaties: edges.filter((e) => e.treaty && (e.a === o || e.b === o)).length,
      out: observations.filter((x) => x.kind === 'VERIFIED' && x.fromOrg === o).length, in: observations.filter((x) => x.kind === 'VERIFIED' && x.toOrg === o).length })
    const sts = edges.filter((e) => e.treaty && (e.a === o || e.b === o)).map((e) => e.status)
    orgStatus.set(o, sts.includes('expired') ? 'expired' : sts.includes('soon') ? 'soon' : 'valid')
  }
  return { orgs, edges, orgStatus, orgStats }
}

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (isNaN(d)) return String(v)
  return d.toISOString().slice(0, 10) // UTC 기준 — 원장 표와 같은 기준
}
