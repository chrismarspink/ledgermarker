// CMS 라벨 파싱·서명 검증(L1) — WebCrypto + pkijs, 전부 브라우저 내 수행
// (DEV SPEC §8.1-2). 라벨 필드는 평문 signedAttributes라 복호화가 필요 없다.
import * as asn1js from 'asn1js'
import { ContentInfo, SignedData, Certificate } from 'pkijs'

// OID arc — 서버 internal/issue/label.go 와 반드시 일치 (docs/label-profile.md)
const B = '1.3.6.1.4.1.55555.53.1'
export const LM_OID = {}
const OID = {
  profileVersion: `${B}.1`,
  grade: `${B}.2`,
  basisClause: `${B}.3`,
  basisKeywords: `${B}.4`,
  brmPath: `${B}.5`,
  issuerOrgId: `${B}.6`,
  docGuid: `${B}.7`,
  contentHash: `${B}.8`,
  approverRank: `${B}.9`,
  approvalState: `${B}.10`,
  disclosureCondition: `${B}.11`,
  parentHash: `${B}.12`,
  rootDocId: `${B}.13`,
  transform: `${B}.14`,
  issuedAt: `${B}.15`,
  notAfter: `${B}.16`,
  exportApprover: `${B}.17`
}
for (const [name, oid] of Object.entries(OID)) LM_OID[oid] = name

function hexOf(view) {
  return [...new Uint8Array(view)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function uuidOf(view) {
  const h = hexOf(view)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function decodeValue(key, v) {
  switch (key) {
    case 'profileVersion':
    case 'basisClause':
    case 'approvalState':
      return v.valueBlock.valueDec
    case 'docGuid':
    case 'rootDocId':
      return uuidOf(v.valueBlock.valueHexView)
    case 'contentHash':
    case 'parentHash':
      return hexOf(v.valueBlock.valueHexView)
    case 'basisKeywords':
      return v.valueBlock.value.map((s) => s.valueBlock.value)
    case 'issuedAt':
    case 'notAfter':
    case 'disclosureCondition':
      return v.toDate()
    default:
      return v.valueBlock.value // UTF8String
  }
}

// parseLabel 은 CMS DER(ArrayBuffer)에서 라벨 필드를 추출한다. 서명 검증 아님.
export function parseLabel(der) {
  const asn1 = asn1js.fromBER(der)
  if (asn1.offset === -1) throw new Error('DER 파싱 실패')
  const ci = new ContentInfo({ schema: asn1.result })
  const sd = new SignedData({ schema: ci.content })
  const attrs = sd.signerInfos[0]?.signedAttrs?.attributes || []
  const label = {}
  for (const a of attrs) {
    const key = Object.keys(OID).find((k) => OID[k] === a.type)
    if (key && a.values.length > 0) label[key] = decodeValue(key, a.values[0])
  }
  if (!label.grade) throw new Error('LM 라벨이 아닙니다 (grade 속성 없음)')
  label.approvalStateText = label.approvalState === 1 ? 'CONFIRMED' : 'PROVISIONAL'
  return label
}

export function pemToCert(pem) {
  const b64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s/g, '')
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return Certificate.fromBER(raw.buffer)
}

// verifyLocal 은 브라우저 내 L1 서명 검증이다.
// 반환: 'valid' | 'invalid' | 'untrusted_ca'
export async function verifyLocal(der, contentHashBytes, trust) {
  const asn1 = asn1js.fromBER(der)
  const ci = new ContentInfo({ schema: asn1.result })
  const sd = new SignedData({ schema: ci.content })

  // 1) 암호학적 서명 검증 (detached content = contentHash 32바이트)
  let sigOK = false
  try {
    sigOK = await sd.verify({ signer: 0, data: contentHashBytes.buffer })
  } catch {
    sigOK = false
  }
  if (!sigOK) return 'invalid'

  // 2) 신뢰목록 CA 체인 확인 + 인증서 폐기 목록(CRL 대용) 대조
  try {
    const pems = []
    if (trust?.caCert) pems.push(trust.caCert)
    for (const a of trust?.anchors || []) pems.push(a.certPem)
    if (pems.length === 0) return 'untrusted_ca'
    const trustedCerts = pems.map(pemToCert)
    const signerCert = sd.certificates?.[0]
    if (signerCert && trust?.revokedCertSerials?.length) {
      const sn = BigInt('0x' + hexOf(signerCert.serialNumber.valueBlock.valueHexView)).toString()
      // 폐기된 키의 라벨: 원장 등록 여부는 서버(L2)만 안다.
      // 오프라인 L1에서는 보수적으로 untrusted 취급 → 게이트가 review.
      if (trust.revokedCertSerials.includes(sn)) return 'untrusted_ca'
    }
    const chainOK = await sd.verify({
      signer: 0,
      data: contentHashBytes.buffer,
      trustedCerts,
      checkChain: true
    })
    return chainOK ? 'valid' : 'untrusted_ca'
  } catch {
    return 'untrusted_ca'
  }
}
