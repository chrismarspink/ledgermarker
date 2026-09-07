import React from 'react'
import { bytesToBase64 } from '../lib/hash.js'
import { api } from '../lib/api.js'
import { analyzeFile } from '../lib/attach.js'
import ResultCard from './ResultCard.jsx'

// 공격 시나리오 시연 (검증 화면 내장) — 방금 검증한 파일의 사본에
// 변조를 가한 뒤 각각을 검증해, 탐지 여부를 기준선과 나란히 보여준다.
// 모든 변조는 브라우저 메모리 사본에만 적용 — 원본 파일·원장 불변.

// grade 속성 OID 1.3.6.1.4.1.55555.53.1.2 의 DER
const OID_GRADE_DER = new Uint8Array([
  0x06, 0x0b, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x83, 0xb2, 0x03, 0x35, 0x01, 0x02
])

function findSeq(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

// 등급 바이트('S'↔'O')를 위조한 사본 (T1 시나리오)
function forgeGrade(der) {
  const out = der.slice()
  const i = findSeq(out, OID_GRADE_DER)
  if (i < 0) return null
  for (let k = i + OID_GRADE_DER.length; k < i + OID_GRADE_DER.length + 8 && k + 2 < out.length; k++) {
    if (out[k] === 0x0c && out[k + 1] === 0x01) {
      out[k + 2] = out[k + 2] === 0x53 ? 0x4f : 0x53
      return { der: out, where: `offset ${k + 2}` }
    }
  }
  return null
}

export default function AttackDemo({ doc, sig }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [results, setResults] = React.useState(null)

  // 다른 파일이 검증되면 이전 시연 결과를 지운다
  React.useEffect(() => { setResults(null); setError('') }, [doc, sig])

  async function run() {
    setError('')
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
    <div className="card">
      <h2>공격 시나리오 시연</h2>
      <p className="hint">
        이 파일의 <b>브라우저 안 사본</b>에 내용 변조·등급 위조·서명 변조·라벨 제거를
        가한 뒤 각각 검증합니다. 원본 파일과 원장은 변경되지 않습니다.
      </p>
      {!results && (
        <button className="primary" disabled={busy} onClick={run}>
          {busy ? '공격 시나리오 실행 중…' : '공격 시나리오 실행'}
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {results && results.map((r, i) => (
        <div key={i} className={`scenario ${r.caught === true ? 'caught' : r.caught === false ? 'missed' : ''}`}>
          <div className="scenario-head">
            <span className="scenario-no">{i === 0 ? '기준선' : `공격 ${i}`}</span>
            <b>{r.title}</b>
            {r.caught === true && <span className="badge-caught">✓ 탐지됨</span>}
            {r.caught === false && <span className="badge-missed">✗ 미탐지</span>}
            {r.caught === null && <span className="badge-base">{i === 0 ? '정상 통과' : '게이트 판단'}</span>}
          </div>
          <p className="hint">{r.desc}</p>
          <ResultCard result={r.result} />
        </div>
      ))}
    </div>
  )
}

async function runScenarios(doc, sig) {
  const buf = new Uint8Array(await doc.arrayBuffer())
  // 포맷 카탈로그 기반 분석 — 해시 대상·내장 라벨을 형식에 맞게 처리
  const analysis = await analyzeFile(doc.name, buf.buffer)
  const baseHash = analysis.contentHash
  let der = analysis.labelDerBytes
  if (sig) der = new Uint8Array(await sig.arrayBuffer())
  if (!der) {
    throw new Error('라벨이 필요합니다 — 라벨 내장 파일이거나 .lmsig를 함께 놓아야 합니다')
  }

  const { hashBody } = await import('../lib/attach.js')
  const scenarios = [{
    title: '변조 없음 (기준선)',
    desc: '원본 그대로 검증합니다. 서명 valid · 원장 registered가 나와야 합니다.',
    hash: baseHash, der, expectDeny: false
  }]

  const tampered = analysis.bodyBytes.slice()
  const mid = Math.floor(tampered.length / 2)
  tampered[mid] ^= 0x01
  scenarios.push({
    title: '문서 내용 변조',
    desc: `문서 본문 중간(offset ${mid})의 1바이트를 바꿨습니다. 해시가 달라져 라벨의 contentHash 결속이 깨집니다 — 서명 invalid, 원장에도 없는 해시라 unregistered.`,
    hash: await hashBody(analysis.format, tampered), der, expectDeny: true
  })

  const forged = forgeGrade(der)
  if (forged) {
    scenarios.push({
      title: `라벨 등급 위조 (S↔O, ${forged.where})`,
      desc: '라벨 안의 등급 1바이트를 위조했습니다. 등급은 평문이라 읽히지만 signedAttributes 전체가 서명 대상이므로 서명 검증이 반드시 실패합니다 (T1). 진짜 등급은 원장 귀속으로 드러납니다.',
      hash: baseHash, der: forged.der, expectDeny: true
    })
  }

  const sigForged = der.slice()
  sigForged[sigForged.length - 3] ^= 0xff
  scenarios.push({
    title: '서명값 변조 (서명 위조)',
    desc: '라벨 끝의 ECDSA 서명 바이트를 바꿨습니다 — 서명키 없이 라벨을 조작하려는 시도의 축약형. 암호학적 검증이 실패합니다.',
    hash: baseHash, der: sigForged, expectDeny: true
  })

  scenarios.push({
    title: '라벨 제거 (떼어내기)',
    desc: '라벨을 떼고 문서만 제시했습니다. 서명은 absent지만 원장 폴백 조회로 등급·발급기관이 그대로 귀속됩니다 — 라벨을 없애도 문서의 신원은 숨겨지지 않습니다 (T4).',
    hash: baseHash, der: null, expectDeny: null
  })

  const out = []
  for (const s of scenarios) {
    const payload = { contentHash: s.hash, level: 2 }
    if (s.der) payload.labelDer = bytesToBase64(s.der)
    const result = await api.verify(payload)
    result.meta = { fileName: s.title, contentHash: s.hash }
    let caught = null
    if (s.expectDeny === true) caught = result.verdictHint === 'deny'
    out.push({ title: s.title, desc: s.desc, result, caught })
  }
  return out
}
