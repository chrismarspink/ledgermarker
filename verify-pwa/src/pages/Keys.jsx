import React from 'react'
import { api } from '../lib/api.js'
import { pemToCert } from '../lib/cms.js'

// 키 관리 — 자기 기관(KPOST) 키 쌍 가시화 + 연동 기관 신뢰목록 +
// 등가성 협정(여권 정책, docs/treaty-policy.md).
// 개인키는 절대 이 화면에 나오지 않는다: 서버는 공개키·인증서만 응답하고,
// 개인키는 "보관 위치" 문자열로만 표시된다.

function hexOf(view, max = 33) {
  const b = new Uint8Array(view)
  const h = [...b.slice(0, max)].map((x) => x.toString(16).padStart(2, '0')).join('')
  return b.length > max ? h + '…' : h
}

function KeyPairBox({ info, tone }) {
  if (!info) return null
  return (
    <div className={`keybox ${tone}`}>
      <div className="keybox-title">{info.subject} <span className="hint">— {info.role}</span></div>
      <div className="keybox-body">
        <span className="keytag public">🔓 공개키 {info.algorithm || info.sigAlg}</span>
        {info.publicKey && <div className="mono">04‖X‖Y = {info.publicKey.slice(0, 66)}…</div>}
        <div className="mono">
          serial {info.serial.length > 24 ? info.serial.slice(0, 24) + '…' : info.serial}
          {' '}· 유효 {String(info.notBefore).slice(0, 10)} ~ {String(info.notAfter).slice(0, 10)}
        </div>
        <span className="keytag private">🔒 개인키: {info.privateKeyLocation}</span>
      </div>
    </div>
  )
}

function AnchorCard({ anchor }) {
  const parsed = React.useMemo(() => {
    try {
      const cert = pemToCert(anchor.certPem)
      const get = (oid) => cert.subject.typesAndValues.find((t) => t.type === oid)?.value.valueBlock.value
      return {
        cn: get('2.5.4.3') || '(CN 없음)',
        serial: hexOf(cert.serialNumber.valueBlock.valueHexView, 16),
        notBefore: cert.notBefore.value.toISOString().slice(0, 10),
        notAfter: cert.notAfter.value.toISOString().slice(0, 10),
        pubKey: hexOf(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView, 24)
      }
    } catch {
      return null
    }
  }, [anchor.certPem])
  return (
    <div className="keybox signer" style={{ marginBottom: 10 }}>
      <div className="keybox-title">{anchor.orgId} <span className="hint">— 반입 {String(anchor.addedAt).slice(0, 10)}</span></div>
      {parsed ? (
        <div className="keybox-body">
          <div className="mono">{parsed.cn} · serial 0x{parsed.serial}</div>
          <div className="mono">유효 {parsed.notBefore} ~ {parsed.notAfter}</div>
          <span className="keytag public">🔓 CA 공개키 {parsed.pubKey}…</span>
          <span className="hint">이 CA가 서명한 라벨 서명자를 신뢰 — 개인키는 해당 기관에만 존재</span>
        </div>
      ) : (
        <p className="error">인증서 파싱 실패</p>
      )}
    </div>
  )
}

export default function KeysPage() {
  const [keys, setKeys] = React.useState(null)
  const [trust, setTrust] = React.useState(null)
  const [treaties, setTreaties] = React.useState(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    Promise.all([api.keys(), api.trustList(), api.treaties()])
      .then(([k, t, tr]) => { setKeys(k); setTrust(t); setTreaties(tr.treaties || []) })
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div>
      <h2>키 관리</h2>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>자기 기관 키 체계 — {keys?.orgId || '…'}</h2>
        <p className="hint">
          기관 서명 CA가 두 서명자에게 인증서를 발급하는 2계층 구조입니다.
          모든 개인키는 키스토어 밖으로 나오지 않으며, 이 화면의 값은 전부 공개 정보입니다.
        </p>
        {keys && (
          <div className="keychain">
            <KeyPairBox info={keys.ca} tone="ca" />
            <div className="keyarrow">│ 인증서 발급(서명) ↓</div>
            <KeyPairBox info={keys.labelSigner} tone="signer" />
            <div className="keyarrow" style={{ paddingLeft: 0 }} />
            <KeyPairBox info={keys.checkpointSigner} tone="sig" />
          </div>
        )}
        {keys?.revokedCertSerials?.length > 0 && (
          <p className="hint">폐기된 서명 인증서: {keys.revokedCertSerials.length}건 (신뢰목록과 함께 배포)</p>
        )}
      </div>

      <div className="card">
        <h2>연동 기관 신뢰목록 (1단계 — CA 교환)</h2>
        <p className="hint">
          각 기관이 <code>lm pki init-org</code>로 키를 로컬 생성한 뒤 CA 인증서(공개)만
          교환합니다. CA 신뢰는 "서명 진위 확인"까지이며, 등급 연동(2단계 협정)과는 별개입니다.
        </p>
        {trust?.anchors?.length > 0
          ? trust.anchors.map((a) => <AnchorCard key={a.id} anchor={a} />)
          : <p className="hint">반입된 파트너 CA가 없습니다 — lm trust import &lt;ca.crt&gt; --org &lt;기관&gt;</p>}
      </div>

      <div className="card">
        <h2>등가성 협정 (2단계 — 여권 정책)</h2>
        <p className="hint">
          라벨은 기관 사이에서 "여권"입니다. 협정은 상대 기관 등급을 우리 기준으로
          <b> 번역만</b> 하며, 통과 여부는 각 기관 게이트 정책이 정합니다(귀속·판정 분리).
          협정 없는 기관의 라벨은 treaty=absent → 검토 권고. 상세: docs/treaty-policy.md
        </p>
        {treaties?.length > 0 ? (
          <div className="tablewrap">
            <table className="ledger">
              <thead>
                <tr><th>협정 ID</th><th>당사자</th><th>등급 번역</th><th>유효기간</th><th>서명</th></tr>
              </thead>
              <tbody>
                {treaties.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.id}</td>
                    <td>{t.partyA} ↔ {t.partyB}</td>
                    <td className="mono">
                      {Object.entries(t.gradeMap).map(([a, b]) => `${a}→${b}`).join(', ')} (역방향 자동)
                    </td>
                    <td>{String(t.signedAt).slice(0, 10)} ~ {String(t.notAfter).slice(0, 10)}</td>
                    <td className="hint">{t.signature ? '서명됨' : 'Treaty Signer 서명 — Phase 2'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">체결된 협정이 없습니다 (LM_TREATIES 미설정)</p>
        )}
        <p className="hint">
          검증 L3 규칙(설계): PROVISIONAL 라벨은 협정 대상 제외(내부 전용) ·
          번역표에 없는 등급은 absent(기본 허용 금지) · 폐기 여부는 발급 기관
          원장이 진실원천 · 협정 적용 시 reasons에 treaty_translated 기록.
        </p>
      </div>
    </div>
  )
}
