import React from 'react'
import { Link } from 'react-router-dom'
import { sha256Hex, sha256HexBytes, bytesToBase64, hexToBytes } from '../lib/hash.js'
import { api, getTrustListCached } from '../lib/api.js'
import { parseLabel, verifyLocal } from '../lib/cms.js'
import { extractEmbedded } from '../lib/embed.js'
import { analyzeFile, extractTextForIdentify } from '../lib/attach.js'
import { orgLabel } from '../lib/orgs.js'
import ResultCard from '../components/ResultCard.jsx'
import StructureView from '../components/StructureView.jsx'
import AttackDemo from '../components/AttackDemo.jsx'

export default function VerifyPage() {
  const [drag, setDrag] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [scanOpen, setScanOpen] = React.useState(false)
  const [pair, setPair] = React.useState({ doc: null, sig: null })
  const inputRef = React.useRef()

  async function handleFiles(fileList) {
    setError('')
    setResult(null)
    const files = [...fileList]
    const doc = files.find((f) => !f.name.endsWith('.lmsig'))
    const sig = files.find((f) => f.name.endsWith('.lmsig'))
    if (!doc && !sig) return
    setPair({ doc, sig })
    setBusy(true)
    try {
      setResult(await runVerify(doc, sig))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div
        className={drag ? 'dropzone drag' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current.click()}
      >
        <p><b>문서 파일을 끌어다 놓으세요</b></p>
        <p className="hint">
          라벨 내장 파일은 자동 인식합니다. 사이드카 라벨(.lmsig)이 있으면
          함께 놓으세요. 라벨이 없어도 원장 조회(폴백 검증)로 귀속을 확인합니다.
        </p>
        <input
          ref={inputRef} type="file" multiple hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>
        <button className="link" onClick={() => setScanOpen(!scanOpen)}>
          인쇄물 QR 스캔으로 검증
        </button>
      </p>
      {scanOpen && <QRScanner onResult={(r) => { setScanOpen(false); setResult(r) }} onError={setError} />}
      {busy && <p style={{ textAlign: 'center' }}>검증 중…</p>}
      {error && <p className="error" style={{ textAlign: 'center' }}>{error}</p>}
      {result && (
        <>
          <ResultCard result={result} />
          {result.attribution?.docGuid && (
            <p style={{ textAlign: 'center' }}>
              <Link to={`/lineage/${result.attribution.docGuid}`}>이 문서의 가계도(계보) 보기 →</Link>
            </p>
          )}
          {result.checks?.signature === 'absent' && result.checks?.ledger === 'registered' && (
            <RestoreLabel meta={result.meta} />
          )}
          {pair.doc && (
            <IdentifyPanel doc={pair.doc}
              autoOpen={result.checks?.ledger === 'unregistered'} />
          )}
          <StructureView structure={result.meta?.structure} />
          {pair.doc && result.meta?.structure?.derBytes && (
            <AttackDemo doc={pair.doc} sig={pair.sig} />
          )}
        </>
      )}
    </div>
  )
}

// runVerify 는 L1(로컬) + L2(원장)를 수행하고 표시용 결과를 만든다.
// 오프라인이면 ledger를 "unavailable"로 표시한다 — "검증 실패"가 아니다.
async function runVerify(doc, sig) {
  let contentHash = null
  let labelDerB64 = ''
  let label = null
  let labelSource = '없음'
  let derBytes = null
  let isEmbedded = false
  let originalSize = doc?.size ?? 0
  let formatId = ''
  let textHash = ''

  if (sig) {
    const der = await sig.arrayBuffer()
    derBytes = new Uint8Array(der)
    labelDerB64 = bytesToBase64(der)
    label = parseLabel(der) // 평문 속성 — 오프라인에서도 읽힌다
    labelSource = '옆에 별도 파일(.lmsig)'
  }
  if (doc) {
    const buf = await doc.arrayBuffer()
    // 포맷 카탈로그 기반 분석: 해시 대상(라벨 제외·필요 시 정규화)과
    // 내장 라벨을 포맷에 맞게 처리한다 (internal/attach의 JS 미러)
    const analysis = await analyzeFile(doc.name, buf)
    contentHash = analysis.contentHash
    formatId = analysis.format.id
    textHash = analysis.textHash || ''
    const emb = extractEmbedded(buf)
    if (emb) {
      isEmbedded = true
      originalSize = emb.original.length
    }
    if (!sig && analysis.labelDerBytes) {
      derBytes = analysis.labelDerBytes
      labelDerB64 = bytesToBase64(analysis.labelDerBytes)
      label = parseLabel(analysis.labelDerBytes.buffer.slice(
        analysis.labelDerBytes.byteOffset,
        analysis.labelDerBytes.byteOffset + analysis.labelDerBytes.byteLength))
      labelSource = analysis.labelSource
    }
  } else if (label?.contentHash) {
    contentHash = label.contentHash // 라벨만 제시된 경우
  }
  if (!contentHash) throw new Error('문서 파일 또는 라벨이 필요합니다')

  const meta = {
    fileName: doc?.name || sig?.name, contentHash, label, labelSource, formatId,
    // 구조 뷰어(StructureView)용 원시 데이터
    structure: {
      fileName: doc?.name || sig?.name,
      fileSize: doc?.size ?? derBytes?.length ?? 0,
      embedded: isEmbedded,
      originalSize,
      derBytes,
      sidecarName: sig?.name,
      label
    }
  }

  try {
    const res = await api.verify({
      labelDer: labelDerB64 || undefined,
      contentHash,
      textHash: textHash || undefined, // 재저장본 2차 재식별
      level: 2
    })
    return { ...res, meta, offline: false }
  } catch (e) {
    if (e.name !== 'TypeError' && !/fetch|network/i.test(e.message)) throw e
    // 오프라인 폴백: 로컬 L1만 수행. 원장은 "판단 보류(unavailable)".
    const trust = await getTrustListCached()
    let signature = 'absent'
    if (labelDerB64 && label) {
      signature = await verifyLocal(
        Uint8Array.from(atob(labelDerB64), (c) => c.charCodeAt(0)).buffer,
        hexToBytes(contentHash),
        trust
      )
      if (label.contentHash && label.contentHash !== contentHash) signature = 'invalid'
    }
    const now = new Date()
    let validity = 'in_window'
    if (label?.notAfter && now > label.notAfter) validity = 'expired'
    if (label?.issuedAt && now < label.issuedAt) validity = 'not_yet'
    return {
      attribution: label
        ? {
            docGuid: label.docGuid, grade: label.grade,
            approvalState: label.approvalStateText,
            issuerOrg: label.issuerOrgId, rootDocId: label.rootDocId,
            confidence: 1.0
          }
        : {},
      checks: {
        signature,
        ledger: 'unavailable', // 접속 불가 = 판단 보류. unregistered와 다르다!
        revocation: 'none',
        validity,
        treaty: 'not_applicable'
      },
      translatedGrade: label?.grade,
      verdictHint: 'review',
      reasons: ['offline_local_l1_only', 'ledger_unavailable'],
      meta,
      offline: true
    }
  }
}

// QR 사이드카 스캔 — 원장 조회용 docGuid + contentHash 축약 URL (DEV SPEC §4.3).
// 네이티브 BarcodeDetector 사용(업무망 표준 브라우저 지원 여부 ✎ §13-8).
function QRScanner({ onResult, onError }) {
  const videoRef = React.useRef()
  React.useEffect(() => {
    let stop = false
    let stream
    async function scan() {
      if (!('BarcodeDetector' in window)) {
        onError('이 브라우저는 QR 스캔(BarcodeDetector)을 지원하지 않습니다')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        while (!stop) {
          const codes = await detector.detect(videoRef.current).catch(() => [])
          const raw = codes[0]?.rawValue
          if (raw) {
            // 형식: lm://verify?h=<contentHash hex>&d=<docGuid>
            const m = raw.match(/h=([0-9a-f]{64})/)
            if (m) {
              const res = await api.verify({ contentHash: m[1], level: 2 })
              onResult({ ...res, meta: { fileName: 'QR 스캔', contentHash: m[1] } })
              break
            }
          }
          await new Promise((r) => setTimeout(r, 300))
        }
      } catch (e) {
        onError('카메라 접근 실패: ' + e.message)
      }
    }
    scan()
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <video ref={videoRef} style={{ maxWidth: '100%', borderRadius: 8 }} muted playsInline />
      <p className="hint">QR 코드를 카메라에 비추세요</p>
    </div>
  )
}

// 라벨 복원 — 이름표가 유실됐지만 원장에 기록이 있는 파일의 라벨 원본을
// 회수해 .lmsig로 내려준다 ("식별된 파일에 기존 보안정책 재적용").
function RestoreLabel({ meta }) {
  const [url, setUrl] = React.useState(null)
  const [error, setError] = React.useState('')

  async function restore() {
    setError('')
    try {
      const info = await api.labelByHash(meta.contentHash)
      if (info.destroyed) {
        throw new Error('파기된 문서입니다 — 라벨을 복원하지 않습니다. 사본이라면 회수 대상입니다.')
      }
      const der = Uint8Array.from(atob(info.labelDer), (c) => c.charCodeAt(0))
      setUrl(URL.createObjectURL(new Blob([der], { type: 'application/octet-stream' })))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="card">
      <h2>이름표 복원</h2>
      <p className="hint">
        이 파일은 이름표 없이 유통되고 있지만, 대장에 발급 기록과 라벨 원본이
        보관되어 있습니다. 회수해서 다시 붙일 수 있습니다.
      </p>
      {!url ? (
        <button className="primary" onClick={restore}>대장에서 이름표 회수</button>
      ) : (
        <a className="download" href={url} download={(meta.fileName || 'document') + '.lmsig'}>
          ⬇ 이름표 받기 — {meta.fileName}.lmsig (파일과 함께 두세요)
        </a>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

// 유사 문서 재식별 — 원장에 정확 일치가 없을 때, 내용 유사도로 원본 후보를
// 찾는다. 텍스트 형식이면 서버가 docsim으로 정밀·의미 판정까지 채워 준다.
function IdentifyPanel({ doc, autoOpen }) {
  const [state, setState] = React.useState('idle') // idle|busy|done|error|unsupported
  const [cands, setCands] = React.useState([])
  const [error, setError] = React.useState('')

  React.useEffect(() => { if (autoOpen) run() /* eslint-disable-line */ }, [])

  async function run() {
    setState('busy'); setError('')
    try {
      const buf = await doc.arrayBuffer()
      const text = await extractTextForIdentify(doc.name, buf)
      if (!text) { setState('unsupported'); return }
      const res = await api.identify(null, text)
      setCands(res.candidates || [])
      setState('done')
    } catch (e) {
      setError(e.message); setState('error')
    }
  }

  return (
    <div className="card">
      <h2>유사 문서 재식별 (docsim)</h2>
      <p className="hint">
        내용 유사도로 원장의 원본 후보를 찾습니다 (수정본·형식 변환본·재작성).
        텍스트 형식이면 사내 docsim이 정밀·의미 판정까지 채웁니다.
        이 기능은 본문 텍스트를 서버로 전송합니다.
      </p>
      {state === 'idle' && <button className="primary" onClick={run}>유사 문서 찾기</button>}
      {state === 'busy' && <p>분석 중…</p>}
      {state === 'unsupported' && (
        <p className="hint">이 형식은 웹에서 텍스트 추출을 지원하지 않습니다 — CLI: <code>lm identify {doc.name}</code></p>
      )}
      {state === 'error' && <p className="error">{error}</p>}
      {state === 'done' && cands.length === 0 && (
        <p className="hint">유사한 등록 문서를 찾지 못했습니다 (유사도 0.3 미만).</p>
      )}
      {state === 'done' && cands.length > 0 && (
        <div className="tablewrap">
          <table className="ledger">
            <thead><tr><th>유사도</th><th>등급</th><th>발급기관</th><th>docGuid</th><th>docsim 정밀 판정</th></tr></thead>
            <tbody>
              {cands.map((c, i) => (
                <tr key={i} className={c.revoked ? 'revoked' : ''}>
                  <td><b>{Math.round(c.similarity * 100)}%</b></td>
                  <td>{c.grade || '-'}</td>
                  <td>{orgLabel(c.issuerOrg)}</td>
                  <td className="mono" title={c.docGuid}>{c.docGuid.slice(0, 8)}…</td>
                  <td>
                    {c.deep
                      ? <>{c.deep.label || c.deep.relation} <span className="hint">(문자 {c.deep.shingle?.toFixed(2)} · 의미 {c.deep.semantic?.toFixed(2)})</span></>
                      : <span className="hint">지문만 (docsim 미구성)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
