import React from 'react'
import { Link } from 'react-router-dom'
import { sha256Hex, bytesToBase64, hexToBytes } from '../lib/hash.js'
import { api, getTrustListCached } from '../lib/api.js'
import { parseLabel, verifyLocal } from '../lib/cms.js'
import ResultCard from '../components/ResultCard.jsx'

export default function VerifyPage() {
  const [drag, setDrag] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [scanOpen, setScanOpen] = React.useState(false)
  const inputRef = React.useRef()

  async function handleFiles(fileList) {
    setError('')
    setResult(null)
    const files = [...fileList]
    const doc = files.find((f) => !f.name.endsWith('.lmsig'))
    const sig = files.find((f) => f.name.endsWith('.lmsig'))
    if (!doc && !sig) return
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
          사이드카 라벨(.lmsig)이 있으면 함께 놓으세요. 라벨이 없어도
          원장 조회(폴백 검증)로 문서 귀속을 확인합니다.
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

  if (sig) {
    const der = await sig.arrayBuffer()
    labelDerB64 = bytesToBase64(der)
    label = parseLabel(der) // 평문 속성 — 오프라인에서도 읽힌다
  }
  if (doc) {
    contentHash = await sha256Hex(doc)
  } else if (label?.contentHash) {
    contentHash = label.contentHash // 라벨만 제시된 경우
  }
  if (!contentHash) throw new Error('문서 파일 또는 라벨이 필요합니다')

  const meta = { fileName: doc?.name || sig?.name, contentHash, label }

  try {
    const res = await api.verify({
      labelDer: labelDerB64 || undefined,
      contentHash,
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
