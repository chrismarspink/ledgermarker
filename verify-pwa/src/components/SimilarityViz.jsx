import React from 'react'

// 유사도 테스트 시각화 — 모두 인라인 SVG/DOM, 외부 차트 라이브러리 없음.
//   SigGrid        ② MinHash 해시 배열: 128칸 시그니처 두 벌, 일치 칸 강조
//   ShingleVenn    ② 슁글 집합 벤 다이어그램(정확 자카드)
//   Meter          ②③ 0~1 게이지
//   ContainBars    ③ 포함률(A⊆B / B⊆A)
//   ChunkLinks     ③ 의미 청크 연결도(상위 청크쌍, 코사인 굵기·농도)
//   CandidateMap   원장 후보 산점도(MinHash × 의미) — 군집 해석용
// 색: 일치/상태는 앱 상태색(--ok 등), 크기·강도는 단일 색(navy) 농도만 쓴다.

const NAVY = '#1a2b4a'
const OK = '#1e7d46'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'

export function pct(v) { return typeof v === 'number' ? `${Math.round(v * 100)}%` : '—' }

// ② MinHash 시그니처 격자: 32열×4행 × 2벌. 같은 위치의 값이 같으면(일치) 초록.
export function SigGrid({ mh }) {
  const n = mh.matches.filter(Boolean).length
  const Row = ({ label, sig }) => (
    <div className="sig-row">
      <span className="sig-lab">{label}</span>
      <div className="sig-cells">
        {sig.map((h, i) => (
          <span key={i} className={mh.matches[i] ? 'sig-cell hit' : 'sig-cell'}
            title={`#${i}  A ${mh.sigA[i]}\n#${i}  B ${mh.sigB[i]}${mh.matches[i] ? '  ✓ 일치' : ''}`} />
        ))}
      </div>
    </div>
  )
  return (
    <div className="sig">
      <Row label="A" sig={mh.sigA} />
      <Row label="B" sig={mh.sigB} />
      <p className="hint" style={{ margin: '6px 0 0' }}>
        <span className="sig-cell hit" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> 같은 위치 값 일치 <b>{n}</b> / {mh.sigSize} 칸
        → 자카드 추정 <b>{pct(mh.similarity)}</b> · 칸에 마우스를 올리면 64비트 값
      </p>
    </div>
  )
}

// ② 슁글 집합 벤 다이어그램. 원 넓이 ∝ 슁글 수, 겹침 폭 ∝ 공통 비율.
export function ShingleVenn({ sh }) {
  const W = 340, H = 204
  const maxR = 62
  const scale = maxR / Math.sqrt(Math.max(sh.a, sh.b, 1))
  const rA = Math.max(14, Math.sqrt(sh.a) * scale)
  const rB = Math.max(14, Math.sqrt(sh.b) * scale)
  const minN = Math.max(Math.min(sh.a, sh.b), 1)
  const overlap = (sh.common / minN) * 2 * Math.min(rA, rB) // 겹침 폭(px)
  const d = sh.common === 0 ? rA + rB + 12 : Math.max(Math.abs(rA - rB) + 2, rA + rB - overlap)
  const cx = W / 2, cy = H / 2 - 20
  const xA = cx - d / 2, xB = cx + d / 2
  const onlyA = sh.a - sh.common, onlyB = sh.b - sh.common
  // 라벨 위치: 초승달(A만·B만)과 렌즈(공통)의 가로 중심. 폭이 좁으면 원 안 표기를 생략하고
  // 아래 범례 줄에만 쓴다(숫자 겹침 방지).
  const lensL = Math.max(xA - rA, xB - rB), lensR = Math.min(xA + rA, xB + rB)
  const crescA = { x: ((xA - rA) + lensL) / 2, w: lensL - (xA - rA) }
  const crescB = { x: (lensR + (xB + rB)) / 2, w: (xB + rB) - lensR }
  const lens = { x: (lensL + lensR) / 2, w: lensR - lensL }
  const MIN_W = 26
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img"
      aria-label={`슁글 벤 다이어그램: A만 ${onlyA}, 공통 ${sh.common}, B만 ${onlyB}`}>
      <circle cx={xA} cy={cy} r={rA} fill={NAVY} fillOpacity=".18" stroke={NAVY} strokeWidth="1.5" />
      <circle cx={xB} cy={cy} r={rB} fill={OK} fillOpacity=".18" stroke={OK} strokeWidth="1.5" />
      <text x={xA - rA} y={cy + Math.max(rA, rB) + 16} fontSize="11" fill={MUTED}>A · {sh.a}개</text>
      <text x={xB + rB} y={cy + Math.max(rA, rB) + 16} fontSize="11" fill={MUTED} textAnchor="end">B · {sh.b}개</text>
      {crescA.w >= MIN_W && <text x={crescA.x} y={cy + 4} fontSize="12" textAnchor="middle" fill="#111827">{onlyA}</text>}
      {crescB.w >= MIN_W && <text x={crescB.x} y={cy + 4} fontSize="12" textAnchor="middle" fill="#111827">{onlyB}</text>}
      {sh.common > 0 && lens.w >= MIN_W && <text x={lens.x} y={cy + 4} fontSize="13" fontWeight="700" textAnchor="middle" fill="#111827">{sh.common}</text>}
      <text x={cx} y={H - 18} fontSize="11" textAnchor="middle" fill={MUTED}>
        A만 {onlyA} · <tspan fontWeight="700" fill="#111827">공통 {sh.common}</tspan> · B만 {onlyB}
      </text>
      <text x={cx} y={H - 4} fontSize="11" textAnchor="middle" fill={MUTED}>
        공통 {sh.common} ÷ 합집합 {sh.a + sh.b - sh.common} = 정확 자카드 <tspan fontWeight="700" fill="#111827">{sh.jaccard.toFixed(3)}</tspan>
      </text>
    </svg>
  )
}

// 0~1 게이지. 눈금 0.3(후보 하한)·0.7(자동 복원 임계).
export function Meter({ value, label, ticks = [0.3, 0.7] }) {
  const v = Math.max(0, Math.min(1, value || 0))
  return (
    <div className="meter" title={`${label} ${(value ?? 0).toFixed(3)}`}>
      <div className="meter-lab">{label}</div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${v * 100}%` }} />
        {ticks.map((t) => <span key={t} className="meter-tick" style={{ left: `${t * 100}%` }} />)}
      </div>
      <div className="meter-val">{pct(value)}</div>
    </div>
  )
}

// ③ 포함률: "A 내용 중 B에 있는 비율" / 반대. 비대칭이면 발췌·확장 관계.
export function ContainBars({ deep }) {
  return (
    <div>
      <Meter value={deep.containAB} label="A 내용이 B에 포함" ticks={[0.8]} />
      <Meter value={deep.containBA} label="B 내용이 A에 포함" ticks={[0.8]} />
    </div>
  )
}

// ③ 의미 청크 연결도: 왼쪽 A 청크, 오른쪽 B 청크, 상위 청크쌍을 곡선으로.
export function ChunkLinks({ deep }) {
  const nA = Math.max(deep.chunksA || 1, 1), nB = Math.max(deep.chunksB || 1, 1)
  const pairs = deep.topPairs || []
  const rows = Math.max(nA, nB)
  const rowH = rows > 24 ? 8 : 22
  const boxH = rows > 24 ? 6 : 16
  const W = 460, top = 26, H = top + rows * rowH + 12
  const xa = 70, xb = W - 70, bw = 46
  const y = (i, n) => top + (i + 0.5) * rowH * (rows / n) // 청크 수가 다르면 세로로 고르게
  const used = new Set(pairs.flatMap((p) => [`a${p.a}`, `b${p.b}`]))
  const best = pairs[0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="의미 청크 연결도">
      <text x={xa} y={14} fontSize="11" fill={MUTED} textAnchor="middle">A 청크 {nA}개</text>
      <text x={xb} y={14} fontSize="11" fill={MUTED} textAnchor="middle">B 청크 {nB}개</text>
      {Array.from({ length: nA }, (_, i) => (
        <rect key={'a' + i} x={xa - bw / 2} y={y(i, nA) - boxH / 2} width={bw} height={boxH} rx="3"
          fill={used.has('a' + i) ? NAVY : '#eef1f6'} stroke={NAVY} strokeWidth=".8">
          <title>A 청크 {i + 1}</title>
        </rect>
      ))}
      {Array.from({ length: nB }, (_, i) => (
        <rect key={'b' + i} x={xb - bw / 2} y={y(i, nB) - boxH / 2} width={bw} height={boxH} rx="3"
          fill={used.has('b' + i) ? OK : '#e9f3ed'} stroke={OK} strokeWidth=".8">
          <title>B 청크 {i + 1}</title>
        </rect>
      ))}
      {pairs.map((p, k) => {
        const y1 = y(p.a, nA), y2 = y(p.b, nB)
        const x1 = xa + bw / 2, x2 = xb - bw / 2, mx = (x1 + x2) / 2
        const c = Math.max(0, Math.min(1, p.cosine))
        return (
          <path key={k} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none"
            stroke={NAVY} strokeOpacity={0.2 + 0.8 * c} strokeWidth={1 + 3.5 * c} strokeLinecap="round">
            <title>A{p.a + 1} ↔ B{p.b + 1} 코사인 {p.cosine.toFixed(3)}</title>
          </path>
        )
      })}
      {best && (
        <text x={W / 2} y={(y(best.a, nA) + y(best.b, nB)) / 2 - 6} fontSize="11" fontWeight="700" textAnchor="middle" fill="#111827">
          {best.cosine.toFixed(3)}
        </text>
      )}
      {rows <= 24 && Array.from({ length: nA }, (_, i) => (
        <text key={'la' + i} x={xa} y={y(i, nA) + 4} fontSize="10" textAnchor="middle" fill={used.has('a' + i) ? '#fff' : MUTED}>A{i + 1}</text>
      ))}
      {rows <= 24 && Array.from({ length: nB }, (_, i) => (
        <text key={'lb' + i} x={xb} y={y(i, nB) + 4} fontSize="10" textAnchor="middle" fill={used.has('b' + i) ? '#fff' : MUTED}>B{i + 1}</text>
      ))}
    </svg>
  )
}

// 원장 후보 산점도: x=MinHash 자카드, y=의미 코사인. 사분면이 관계를 말한다.
export function CandidateMap({ cands, selfHash }) {
  const W = 480, H = 300, L = 44, R = 16, T = 16, B = 36
  const px = (v) => L + v * (W - L - R)
  const py = (v) => T + (1 - v) * (H - T - B)
  const quad = [
    { x: 0.75, y: 0.72, t: '동일·수정본' }, { x: 0.25, y: 0.72, t: '재작성(의미 유지)' },
    { x: 0.75, y: 0.28, t: '표면만 유사' }, { x: 0.25, y: 0.28, t: '무관' }
  ]
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="후보 산점도">
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={px(g)} y1={T} x2={px(g)} y2={H - B} stroke={LINE} />
          <line x1={L} y1={py(g)} x2={W - R} y2={py(g)} stroke={LINE} />
          <text x={px(g)} y={H - B + 14} fontSize="10" textAnchor="middle" fill={MUTED}>{g}</text>
          <text x={L - 6} y={py(g) + 3} fontSize="10" textAnchor="end" fill={MUTED}>{g}</text>
        </g>
      ))}
      {quad.map((q) => <text key={q.t} x={px(q.x)} y={py(q.y)} fontSize="12" textAnchor="middle" fill={MUTED} opacity=".55">{q.t}</text>)}
      <text x={(L + W - R) / 2} y={H - 4} fontSize="11" textAnchor="middle" fill={MUTED}>② MinHash 자카드 →</text>
      <text x={12} y={(T + H - B) / 2} fontSize="11" textAnchor="middle" fill={MUTED} transform={`rotate(-90 12 ${(T + H - B) / 2})`}>③ 의미 코사인 →</text>
      {cands.map((c, i) => {
        const hasDeep = c.deep && typeof c.deep.semantic === 'number'
        const x = px(c.similarity), y = py(hasDeep ? c.deep.semantic : 0)
        const self = selfHash && c.contentHash === selfHash
        const name = (c.filename || c.docGuid.slice(0, 8)).slice(0, 14)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="7" fill={hasDeep ? NAVY : '#fff'} stroke={self ? OK : NAVY} strokeWidth={self ? 3 : 1.5}
              strokeDasharray={hasDeep ? '' : '2 2'}>
              <title>{c.filename || c.docGuid}{'\n'}MinHash {pct(c.similarity)}{hasDeep ? ` · 의미 ${pct(c.deep.semantic)} · ${c.deep.label || ''}` : ' · 의미지문 없음'}</title>
            </circle>
            <text x={c.similarity > 0.72 ? x - 10 : x + 10} y={y + 4} fontSize="10" fill="#111827"
              textAnchor={c.similarity > 0.72 ? 'end' : 'start'}>{self ? '(자신) ' : ''}{name}</text>
          </g>
        )
      })}
    </svg>
    <p className="hint" style={{ margin: '2px 0 0' }}>
      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: NAVY, verticalAlign: 'middle' }} /> 의미지문 있음 ·{' '}
      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, border: `1.5px dashed ${NAVY}`, verticalAlign: 'middle' }} /> 의미지문 없음(의미축 0에 표시) ·{' '}
      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, border: `2px solid ${OK}`, verticalAlign: 'middle' }} /> 이 파일 자신
    </p>
    </>
  )
}

// 표 안의 작은 막대.
export function MiniBar({ value }) {
  if (typeof value !== 'number') return <span className="hint">—</span>
  return (
    <span className="minibar" title={value.toFixed(3)}>
      <span className="minibar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      <b>{pct(value)}</b>
    </span>
  )
}
