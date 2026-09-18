import React from 'react'
import { Link } from 'react-router-dom'
import { orgLabel, orgLogo } from '../lib/orgs.js'

// 검증 결과를 단순 O/X로 합치지 않는다 — 5개 체크 항목을 각각 표시하고,
// 종합 판정(verdictHint)은 보조로만 보여준다 (DEV SPEC §8.3).
const CHECK_META = {
  signature: {
    title: '서명',
    text: { valid: '유효', invalid: '무효(변조·위조)', absent: '라벨 없음', untrusted_ca: '신뢰되지 않은 CA' },
    tone: { valid: 'ok', invalid: 'bad', absent: 'warn', untrusted_ca: 'warn' }
  },
  ledger: {
    title: '원장',
    text: { registered: '등록됨', unregistered: '미등록', unavailable: '조회 불가(판단 보류)' },
    tone: { registered: 'ok', unregistered: 'bad', unavailable: 'warn' }
  },
  revocation: {
    title: '폐기',
    text: { none: '해당 없음', revoked: '폐기됨', superseded: '구 버전(대체됨)' },
    tone: { none: 'ok', revoked: 'bad', superseded: 'warn' }
  },
  validity: {
    title: '유효기간',
    text: { in_window: '기간 내', expired: '만료', not_yet: '아직 유효하지 않음' },
    tone: { in_window: 'ok', expired: 'warn', not_yet: 'warn' }
  },
  treaty: {
    title: '협정',
    text: { present: '적용', absent: '협정 없음', not_applicable: '해당 없음(Phase 2)' },
    tone: { present: 'ok', absent: 'warn', not_applicable: 'ok' }
  }
}

const HINT_TEXT = { allow: '통과 권고', review: '검토 필요', deny: '차단 권고' }

export default function ResultCard({ result }) {
  const { attribution = {}, checks = {}, verdictHint, reasons = [], meta = {}, offline } = result
  const grade = attribution.grade || '?'
  return (
    <div className="card">
      <h2>{meta.fileName}</h2>
      <div className="mono">
        SHA-256 {meta.contentHash}
        {meta.labelSource && (
          <>
            {' · 이름표: '}
            <Link to={`/help/formats${meta.formatId ? '#' + meta.formatId : ''}`}
              title="이 형식의 부착 방식 도움말로 이동">
              {meta.labelSource}
            </Link>
          </>
        )}
      </div>

      <div className="attribution">
        <div className={`grade ${['C', 'S', 'O'].includes(grade) ? grade : 'unknown'}`}>{grade}</div>
        {attribution.issuerOrg && (
          <img className="org-logo" src={orgLogo(attribution.issuerOrg)}
            alt={orgLabel(attribution.issuerOrg)} title={orgLabel(attribution.issuerOrg)} />
        )}
        <div>
          <div><b>{attribution.issuerOrg ? orgLabel(attribution.issuerOrg) : '발급기관 미상'}</b> · {attribution.approvalState || '-'}</div>
          <div className="mono">docGuid {attribution.docGuid || '-'}</div>
          {attribution.rootDocId && attribution.rootDocId !== attribution.docGuid && (
            <div className="mono">최초 조상 {attribution.rootDocId}</div>
          )}
          <div className="hint">귀속 신뢰도 {attribution.confidence ?? '-'} (선언적=1.0)</div>
        </div>
      </div>

      <div className="checks">
        {Object.entries(CHECK_META).map(([key, m]) => {
          const v = checks[key]
          return (
            <div key={key} className={`check ${m.tone[v] || ''}`}>
              <div className="label">{m.title}</div>
              <div className="value">{m.text[v] || v || '-'}</div>
            </div>
          )
        })}
      </div>

      <div className="verdict">
        참고 판정: <b className={verdictHint}>{HINT_TEXT[verdictHint] || verdictHint}</b>
        {' '}— 이 값은 참고용이며, 통과 여부는 게이트 정책이 정합니다.
        {offline && ' (오프라인 — 로컬 L1 검증 결과)'}
        <div className="reasons">근거: {reasons.join(', ')}</div>
      </div>
    </div>
  )
}
