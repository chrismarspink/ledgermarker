import React from 'react'
import * as asn1js from 'asn1js'
import { ContentInfo, SignedData } from 'pkijs'
import { LM_OID, pemToCert } from '../lib/cms.js'
import { getTrustListCached } from '../lib/api.js'

// 파일 내부 구조 + 라벨(서명 데이터) 구조 뷰어.
// 검증 결과의 "왜"를 바이트 수준까지 눈으로 확인할 수 있게 한다.

// 렌더링 라벨은 일반 용어로 표기한다(구현 세부 표준·알고리즘명 비노출).
const OID_NAMES = {
  '1.2.840.113549.1.7.1': '데이터',
  '1.2.840.113549.1.7.2': '서명 데이터',
  '1.2.840.113549.1.9.3': '콘텐츠 유형',
  '1.2.840.113549.1.9.4': '문서 해시 결속',
  '1.2.840.113549.1.9.5': '서명 시각',
  '2.16.840.1.101.3.4.2.1': '해시 알고리즘',
  '1.2.840.10045.4.3.2': '서명 알고리즘',
  '1.2.840.10045.2.1': '공개키',
  '1.2.840.10045.3.1.7': '공개키 파라미터',
  '2.5.4.3': '기관/주체명',
  '2.5.4.10': '조직명',
  '2.5.29.15': '키 용도',
  '2.5.29.19': '인증서 제약',
  '2.5.29.37': '확장 키 용도'
}

function oidName(dotted) {
  if (LM_OID[dotted]) return `LM ${LM_OID[dotted]} ★`
  return OID_NAMES[dotted] || null
}

// 구조 태그도 일반 용어로(인코딩 세부 비노출).
const UNIVERSAL = {
  1: '불리언', 2: '정수', 3: '비트열', 4: '바이트열', 5: '없음',
  6: '식별자', 10: '열거값', 12: '문자열', 16: '묶음',
  17: '집합', 19: '문자열', 23: '시각', 24: '시각'
}

function hexTrunc(view, max = 24) {
  const bytes = new Uint8Array(view)
  const h = [...bytes.slice(0, max)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return bytes.length > max ? `${h}… (${bytes.length} bytes)` : h
}

function tagName(node) {
  const { tagClass, tagNumber } = node.idBlock
  if (tagClass === 3) return `[${tagNumber}]`
  if (tagClass === 1) return UNIVERSAL[tagNumber] || `UNIVERSAL ${tagNumber}`
  return `tag ${tagClass}.${tagNumber}`
}

function scalarValue(node) {
  const { tagClass, tagNumber } = node.idBlock
  if (tagClass !== 1) return null
  try {
    switch (tagNumber) {
      case 1: return String(node.valueBlock.value)
      case 2: // INTEGER — 큰 수(인증서 SN)는 hex
        return node.valueBlock.isHexOnly
          ? '0x' + hexTrunc(node.valueBlock.valueHexView, 20)
          : String(node.valueBlock.valueDec)
      case 3: return hexTrunc(node.valueBlock.valueHexView)
      case 4: return hexTrunc(node.valueBlock.valueHexView, 32)
      case 6: {
        const dotted = node.valueBlock.toString()
        const name = oidName(dotted)
        return name ? `${dotted} — ${name}` : dotted
      }
      case 10: return String(node.valueBlock.valueDec)
      case 12: case 19: return `"${node.valueBlock.value}"`
      case 23: case 24: return node.toDate().toISOString()
      default: return null
    }
  } catch {
    return null
  }
}

function Asn1Node({ node, depth }) {
  const kids = node.idBlock.isConstructed ? node.valueBlock.value || [] : []
  const size = node.valueBeforeDecodeView?.byteLength
  const name = tagName(node)
  const isLM = name === '식별자' && LM_OID[node.valueBlock?.toString?.()]
  if (kids.length === 0) {
    const v = scalarValue(node)
    return (
      <div className={isLM ? 'a1 leaf lm' : 'a1 leaf'}>
        <span className="a1t">{name}</span>
        {v != null && <span className="a1v"> {v}</span>}
      </div>
    )
  }
  return (
    <details className="a1" open={depth < 3}>
      <summary>
        <span className="a1t">{name}</span>
        <span className="a1l"> — {kids.length}개 요소{size ? `, ${size} bytes` : ''}</span>
      </summary>
      <div className="a1kids">
        {kids.map((k, i) => <Asn1Node key={i} node={k} depth={depth + 1} />)}
      </div>
    </details>
  )
}

// 파일 레이아웃 트리 (트레일러 내장 / 사이드카 / 라벨 없음)
function FileLayout({ s }) {
  const fmt = (n) => n?.toLocaleString('ko-KR')
  return (
    <ul className="ftree">
      <li>
        📄 <b>{s.fileName}</b> ({fmt(s.fileSize)} bytes)
        {s.embedded ? (
          <ul>
            <li>
              원본 콘텐츠 <span className="range">[0 – {fmt(s.originalSize)})</span> {fmt(s.originalSize)} bytes
              — <b>SHA-256 대상</b> (contentHash가 이 구간을 결속)
            </li>
            <li>
              라벨 트레일러 <span className="range">[{fmt(s.originalSize)} – {fmt(s.fileSize)})</span> {fmt(s.fileSize - s.originalSize)} bytes
              <ul>
                <li>서명 데이터 — {fmt(s.fileSize - s.originalSize - 16)} bytes ← 아래 라벨 구조</li>
                <li>서명 데이터 길이 — 8 bytes = {fmt(s.fileSize - s.originalSize - 16)}</li>
                <li>매직 "LMLABEL1" — 8 bytes</li>
              </ul>
            </li>
          </ul>
        ) : (
          <ul>
            <li>원본 콘텐츠 전체 — <b>SHA-256 대상</b></li>
          </ul>
        )}
      </li>
      {!s.embedded && s.sidecarName && (
        <li>
          🏷 <b>{s.sidecarName}</b> ({fmt(s.derBytes.length)} bytes) — 서명 데이터, 아래 라벨 구조
        </li>
      )}
      {!s.derBytes && <li className="hint">라벨 없음 — 원장 폴백 검증만 수행됨</li>}
    </ul>
  )
}

// ── 서명·키 가시화 ──────────────────────────────────────────
// 개인키는 서버 키스토어 밖으로 절대 나오지 않는다 —
// 여기서는 "존재와 위치"만 표시한다. 검증 공개키는 라벨에 동봉된
// 서명자 인증서에서 추출해 실물을 보여준다.

function certName(cert) {
  const get = (oid) => cert.subject.typesAndValues.find((t) => t.type === oid)?.value.valueBlock.value
  return get('2.5.4.3') || get('2.5.4.10') || '(이름 없음)'
}

function parseSigInfo(derBytes, trust) {
  const buf = derBytes.buffer.slice(derBytes.byteOffset, derBytes.byteOffset + derBytes.byteLength)
  const asn1 = asn1js.fromBER(buf)
  if (asn1.offset === -1) return null
  const sd = new SignedData({ schema: new ContentInfo({ schema: asn1.result }).content })
  const cert = sd.certificates?.[0]
  if (!cert) return null
  const si = sd.signerInfos?.[0]
  const spki = cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView // 0x04||X||Y
  const info = {
    subject: certName(cert),
    serial: hexTrunc(cert.serialNumber.valueBlock.valueHexView, 20),
    notBefore: cert.notBefore.value.toISOString().slice(0, 10),
    notAfter: cert.notAfter.value.toISOString().slice(0, 10),
    pubKeyHex: hexTrunc(spki, 33),
    pubKeyLen: spki.byteLength,
    sigHex: si ? hexTrunc(si.signature.valueBlock.valueHexView, 24) : null
  }
  if (trust?.caCert) {
    try {
      const ca = pemToCert(trust.caCert)
      info.caSubject = certName(ca)
      info.caNotAfter = ca.notAfter.value.toISOString().slice(0, 10)
    } catch { /* 신뢰목록 없이도 표시 */ }
  }
  return info
}

function KeyChainView({ derBytes, trust }) {
  const info = React.useMemo(() => {
    try { return parseSigInfo(derBytes, trust) } catch { return null }
  }, [derBytes, trust])
  if (!info) return <p className="hint">서명자 인증서를 파싱할 수 없습니다</p>
  return (
    <div className="keychain">
      <div className="keybox ca">
        <div className="keybox-title">① Org Root CA — {info.caSubject || '(신뢰목록 미캐시)'}</div>
        <div className="keybox-body">
          <span className="keytag private">🔒 개인키: 오프라인 보관 (기관 CA, ~{info.caNotAfter || '10년'})</span>
          <span className="hint">아래 서명자 인증서에 서명해 신뢰를 부여</span>
        </div>
      </div>
      <div className="keyarrow">│ 인증서 발급(서명) ↓</div>
      <div className="keybox signer">
        <div className="keybox-title">② 라벨 서명자 인증서 — {info.subject} <span className="hint">(라벨에 동봉됨)</span></div>
        <div className="keybox-body">
          <span className="keytag public">🔓 검증 공개키 (타원곡선 전자서명, {info.pubKeyLen} bytes)</span>
          <div className="mono">04‖X‖Y = {info.pubKeyHex}</div>
          <div className="mono">serial 0x{info.serial} · 유효 {info.notBefore} ~ {info.notAfter} (90일 주기 교체)</div>
          <span className="keytag private">🔒 서명용 개인키: 서버 키스토어에만 존재 — 라벨·네트워크로 반출되지 않음</span>
        </div>
      </div>
      <div className="keyarrow">│ 개인키로 서명 대상 속성 서명 ↓</div>
      <div className="keybox sig">
        <div className="keybox-title">③ 이 라벨의 전자서명값</div>
        <div className="keybox-body">
          <div className="mono">{info.sigHex}</div>
          <span className="hint">검증기는 ②의 공개키만으로 이 서명을 확인한다 — 개인키 불필요</span>
        </div>
      </div>
    </div>
  )
}

// 라벨 필드 해석 표 (서명 대상 속성을 사람이 읽는 형태로)
function LabelFields({ label }) {
  if (!label) return null
  const rows = [
    ['profileVersion', label.profileVersion],
    ['grade (등급 — 평문)', label.grade],
    ['approvalState', label.approvalStateText],
    ['issuerOrgId (발급기관)', label.issuerOrgId],
    ['docGuid', label.docGuid],
    ['contentHash', label.contentHash],
    ['basisClause (근거 조항)', label.basisClause && `정보공개법 9조 ${label.basisClause}호`],
    ['basisKeywords', label.basisKeywords?.join(', ')],
    ['brmPath', label.brmPath],
    ['approverRank', label.approverRank],
    ['parentHash (계보)', label.parentHash],
    ['rootDocId (최초 조상)', label.rootDocId],
    ['transform', label.transform],
    ['issuedAt', label.issuedAt?.toISOString?.()],
    ['notAfter (라벨 유효기간)', label.notAfter?.toISOString?.()],
    ['exportApprover', label.exportApprover]
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')
  return (
    <table className="ledger">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="mono" style={{ color: 'var(--muted)' }}>{k}</td>
            <td className="mono">{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function StructureView({ structure }) {
  const [open, setOpen] = React.useState(false)
  const [trust, setTrust] = React.useState(null)
  React.useEffect(() => {
    if (open && !trust) getTrustListCached().then(setTrust).catch(() => {})
  }, [open])
  if (!structure) return null

  let asn1Root = null
  if (open && structure.derBytes) {
    try {
      const buf = structure.derBytes.buffer.slice(
        structure.derBytes.byteOffset,
        structure.derBytes.byteOffset + structure.derBytes.byteLength
      )
      const parsed = asn1js.fromBER(buf)
      if (parsed.offset !== -1) asn1Root = parsed.result
    } catch { /* 표시 생략 */ }
  }

  return (
    <div className="card">
      <h2>
        파일 내부 구조{' '}
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? '접기 ▲' : '펼치기 ▼'}
        </button>
      </h2>
      {open && (
        <>
          <h3 className="sv-h">1. 파일 레이아웃</h3>
          <FileLayout s={structure} />

          {structure.label && (
            <>
              <h3 className="sv-h">2. 라벨 필드 (서명 대상 속성 — 전부 평문·서명 대상)</h3>
              <div className="tablewrap"><LabelFields label={structure.label} /></div>
            </>
          )}

          {structure.derBytes && (
            <>
              <h3 className="sv-h">3. 서명·키 가시화 — 개인키의 위치와 검증 공개키의 실물</h3>
              <KeyChainView derBytes={structure.derBytes} trust={trust} />

              <h3 className="sv-h">4. 라벨 구조 (서명 데이터)</h3>
              <p className="hint">★ 표시는 LM 커스텀 속성. SEQUENCE/SET을 클릭해 펼치고 접을 수 있습니다.</p>
              <div className="a1tree">
                {asn1Root
                  ? <Asn1Node node={asn1Root} depth={0} />
                  : <p className="error">서명 데이터 파싱 실패 — 라벨이 손상되었을 수 있습니다</p>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
