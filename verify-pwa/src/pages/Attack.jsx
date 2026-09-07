import React from 'react'
import { sha256HexBytes, bytesToBase64 } from '../lib/hash.js'
import { api } from '../lib/api.js'
import { extractEmbedded } from '../lib/embed.js'
import ResultCard from '../components/ResultCard.jsx'

// 공격 시나리오 시연 — 라벨 파일에 실제 변조를 가한 뒤(브라우저 안에서만),
// LM 검증이 각각을 어떻게 탐지하는지 나란히 보여준다.
// 모든 변조는 메모리 사본에만 적용되며 원본 파일·서버는 변경되지 않는다.

// grade 속성 OID 1.3.6.1.4.1.55555.53.1.2 의 DER (06 0b + 내용 11바이트)
const OID_GRADE_DER = new Uint8Array([
  0x06, 0x0b, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x83, 0xb2, 0x03, 0x35, 0x01, 0x02
])

function findSeq(hay, needle, fromEnd = false) {
  const start = fromEnd ? hay.length - needle.length : 0
  const step = fromEnd ? -1 : 1
  for (let i = start; fromEnd ? i >= 0 : i <= hay.length - needle.length; i += step) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break }
    }
    if (ok) return i
  }
  return -1
}

// 등급 바이트('S'↔'O')를 위조한 사본을 반환한다 (T1 시나리오)
function forgeGrade(der) {
  const out = der.slice()
  let i = findSeq(out, OID_GRADE_DER)
  if (i >= 0) {
    // OID 뒤: SET(0x31 len) → UTF8String(0x0c 0x01 값)
    for (let k = i + OID_GRADE_DER.length; k < i + OID_GRADE_DER.length + 8 && k + 2 < out.length; k++) {
      if (out[k] === 0x0c && out[k + 1] === 0x01) {
        out[k + 2] = out[k + 2] === 0x53 ? 0x4f : 0x53 // 'S' ↔ 'O'
        return { der: out, where: `offset ${k + 2}` }
      }
    }
  }
  return null
}

export default function AttackPage() {
  const [drag, setDrag] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [results, setResults] = React.useState(null)
  const inputRef = React.useRef()

  async function handleFiles(fileList) {
    setError('')
    setResults(null)
    const files = [...fileList]
    const doc = files.find((f) => !f.name.endsWith('.lmsig'))
    const sig = files.find((f) => f.name.endsWith('.lmsig'))
    if (!doc) { setError('공격 대상 문서 파일을 놓으세요'); return }
    setBusy(true)
    try {
      setResults(await runScenarios(doc, sig))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2>공격 시나리오 시연</h2>
      <p className="hint">
        라벨이 있는 파일(내장형 또는 문서+.lmsig)을 놓으면, 아래 공격을
        <b> 브라우저 안의 사본에만</b> 가한 뒤 각각을 검증합니다.
        원본 파일과 원장은 변경되지 않습니다.
      </p>
      <div
        className={drag ? 'dropzone drag' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current.click()}
      >
        <p><b>공격 대상 파일을 끌어다 놓으세요</b></p>
        <p className="hint">라벨 내장 파일 1개, 또는 문서 + .lmsig 2개</p>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </div>
      {busy && <p style={{ textAlign: 'center' }}>공격 시나리오 실행 중…</p>}
      {error && <p className="error" style={{ textAlign: 'center' }}>{error}</p>}

      {results && results.map((r, i) => (
        <div key={i} className={`scenario ${r.caught === true ? 'caught' : r.caught === false ? 'missed' : ''}`}>
          <div className="scenario-head">
            <span className="scenario-no">{i === 0 ? '기준선' : `공격 ${i}`}</span>
            <b>{r.title}</b>
            {r.caught === true && <span className="badge-caught">✓ 탐지됨</span>}
            {r.caught === false && <span className="badge-missed">✗ 미탐지</span>}
            {r.caught === null && <span className="badge-base">정상 통과</span>}
          </div>
          <p className="hint">{r.desc}</p>
          <ResultCard result={r.result} />
        </div>
      ))}
    </div>
  )
}

async function runScenarios(doc, sig) {
  // 대상 분해: 원본 바이트 + 라벨 DER
  const buf = new Uint8Array(await doc.arrayBuffer())
  let original = buf
  let der = null
  const emb = extractEmbedded(buf.buffer)
  if (emb) { original = emb.original; der = emb.der }
  if (sig) der = new Uint8Array(await sig.arrayBuffer())
  if (!der) {
    throw new Error('라벨을 찾을 수 없습니다 — 라벨 내장 파일이거나 .lmsig를 함께 놓아야 합니다')
  }

  const scenarios = []

  // 0) 기준선
  scenarios.push({
    title: '변조 없음 (기준선)',
    desc: '원본 그대로 검증합니다. 서명 valid · 원장 registered가 나와야 합니다.',
    content: original, der, expectDeny: false
  })

  // 1) 문서 내용 변조
  const tampered = original.slice()
  const mid = Math.floor(tampered.length / 2)
  tampered[mid] ^= 0x01
  scenarios.push({
    title: '문서 내용 변조',
    desc: `문서 본문 중간(offset ${mid})의 1바이트를 바꿨습니다. 해시가 달라져 라벨의 contentHash와 결속이 깨집니다 — 라벨이 "다른 문서의 것"이 되어 서명 invalid, 원장에도 없는 해시라 unregistered.`,
    content: tampered, der, expectDeny: true
  })

  // 2) 라벨 등급 위조 (T1)
  const forged = forgeGrade(der)
  if (forged) {
    scenarios.push({
      title: `라벨 등급 위조 (S↔O, ${forged.where})`,
      desc: '라벨 안의 등급 1바이트를 위조했습니다. 등급은 평문이라 읽히지만, signedAttributes 전체가 서명 대상이므로 서명 검증이 반드시 실패합니다 (수용 기준 T1). 진짜 등급은 원장 귀속으로 드러납니다.',
      content: original, der: forged.der, expectDeny: true
    })
  }

  // 3) 서명값 변조 (위조 서명)
  const sigForged = der.slice()
  sigForged[sigForged.length - 3] ^= 0xff
  scenarios.push({
    title: '서명값 변조 (서명 위조)',
    desc: '라벨 끝부분의 ECDSA 서명 바이트를 바꿨습니다 — 서명키 없이 라벨을 조작하려는 시도의 축약형입니다. 암호학적 검증이 실패합니다.',
    content: original, der: sigForged, expectDeny: true
  })

  // 4) 라벨 제거 (떼어내기)
  scenarios.push({
    title: '라벨 제거 (떼어내기)',
    desc: '라벨을 떼고 문서만 제시했습니다. 서명은 absent지만 원장 폴백 조회로 문서의 귀속(등급·발급기관)이 그대로 드러납니다 — 라벨을 없애도 문서의 신원은 숨겨지지 않습니다 (T4).',
    content: original, der: null, expectDeny: null // 판단은 게이트 몫(review)
  })

  const out = []
  for (const s of scenarios) {
    const contentHash = await sha256HexBytes(s.content)
    const payload = { contentHash, level: 2 }
    if (s.der) payload.labelDer = bytesToBase64(s.der)
    const result = await api.verify(payload)
    result.meta = { fileName: s.title, contentHash }
    let caught = null
    if (s.expectDeny === true) caught = result.verdictHint === 'deny'
    out.push({ title: s.title, desc: s.desc, result, caught })
  }
  return out
}
