import React from 'react'
import { api, currentOrg } from '../lib/api.js'
import { orgLabel } from '../lib/orgs.js'

// 기관 간 보내기·수신함 — 모델 A(단일 서버 다중 기관, 페르소나 전환).
// 파일은 어디로도 이동하지 않는다. "보내기"는 게이트 관측 로그에 SENT 한 줄을 남기는
// 것이고, 수신 기관 페르소나의 수신함은 그 기록을 읽어 원장 조회(L2)와 협정 번역(L3)으로
// 게이트 검증을 수행한 뒤 VERIFIED 를 남긴다. 이 두 기록이 여권 스탬프·기관 간 흐름
// 시각화의 원천이다. 원장(발급 측 진실)과는 별도의 로그다.

const TREATY_TEXT = {
  not_applicable: '자기 기관', translated: '협정 번역', no_treaty: '협정 없음 — 서명만',
  expired: '협정 만료', not_translatable: '번역 불가(내부 전용)'
}
const HINT_TEXT = { allow: '통과 권고', review: '검토 필요', deny: '차단 권고' }

function useApiKey() { return localStorage.getItem('lm-api-key') || '' }

export function SendPanel({ result }) {
  const me = currentOrg() || result.attribution?.issuerOrg || ''
  const [issuers, setIssuers] = React.useState([])
  const [to, setTo] = React.useState('')
  const [state, setState] = React.useState('idle') // idle|busy|done|error
  const [msg, setMsg] = React.useState('')
  React.useEffect(() => {
    api.keys().then((k) => {
      const list = (k.issuers || []).filter((i) => i.orgId !== me)
      setIssuers(list); setTo(list[0]?.orgId || '')
    }).catch(() => {})
  }, [me])

  async function send() {
    setState('busy'); setMsg('')
    try {
      await api.observe({
        kind: 'SENT', docGuid: result.attribution.docGuid, contentHash: result.meta.contentHash,
        fromOrg: me, toOrg: to, grade: result.attribution.grade,
        note: `웹 검증 화면에서 보냄 (${result.meta.fileName || ''})`
      }, useApiKey())
      setState('done')
    } catch (e) { setMsg(e.message); setState('error') }
  }

  if (!issuers.length) return null
  return (
    <div className="card">
      <h2>타 기관으로 보내기</h2>
      <p className="hint">
        현재 기관 <b>{orgLabel(me)}</b>에서 다른 기관 게이트로 이 문서를 보냅니다. 파일은 이동하지 않고
        관측 로그에 "보냄"만 기록됩니다. 상단 기관 선택을 받는 기관으로 바꾸면 검증 화면 수신함에 나타납니다.
      </p>
      {state !== 'done' ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={to} onChange={(e) => setTo(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}>
            {issuers.map((i) => <option key={i.orgId} value={i.orgId}>{orgLabel(i.orgId)}</option>)}
          </select>
          <button className="primary" onClick={send} disabled={state === 'busy' || !to}>
            {state === 'busy' ? '기록 중…' : '보내기'}
          </button>
          {state === 'error' && <span className="error">{msg}</span>}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13 }}>
          <b style={{ color: 'var(--ok)' }}>보냄 기록 완료</b> — {orgLabel(to)} 수신함에 도착했습니다.
          상단 기관을 <b>{to}</b>로 바꿔 게이트 검증을 수행하세요.
        </p>
      )}
    </div>
  )
}

export function InboxPanel() {
  const [me, setMe] = React.useState(currentOrg())
  const [items, setItems] = React.useState([])
  const [results, setResults] = React.useState({})
  const [busy, setBusy] = React.useState(null)
  const [error, setError] = React.useState('')

  const load = React.useCallback(async () => {
    const org = currentOrg()
    setMe(org)
    if (!org) { setItems([]); return }
    try {
      const res = await api.observations({ toOrg: org, limit: 500 }, useApiKey())
      const all = (res.observations || []).filter((o) => o.toOrg === org) // 정적 데모는 필터 없이 전체를 주므로 여기서 거른다
      // 수신함 = 나에게 SENT 된 것 중, 그 이후 같은 문서·같은 발신 기관의 VERIFIED 가 없는 것
      const pending = all.filter((o) => o.kind === 'SENT').filter((s) =>
        !all.some((v) => v.kind === 'VERIFIED' && v.docGuid === s.docGuid && v.fromOrg === s.fromOrg &&
          new Date(v.observedAt) >= new Date(s.observedAt)))
      setItems(pending.reverse())
      setError('')
    } catch (e) { setError(e.message) }
  }, [])
  React.useEffect(() => {
    load()
    window.addEventListener('lm-org-changed', load)
    return () => window.removeEventListener('lm-org-changed', load)
  }, [load])

  async function verify(item) {
    setBusy(item.id)
    try {
      const res = await api.verify({ contentHash: item.contentHash, level: 2, verifierOrg: me })
      await api.observe({
        kind: 'VERIFIED', docGuid: item.docGuid, contentHash: item.contentHash,
        fromOrg: item.fromOrg, toOrg: me, grade: res.attribution?.grade,
        translatedGrade: res.translatedGrade, treaty: res.checks?.treaty, verdictHint: res.verdictHint,
        note: '웹 수신함에서 게이트 검증'
      }, useApiKey())
      setResults((r) => ({ ...r, [item.id]: res }))
    } catch (e) { setResults((r) => ({ ...r, [item.id]: { error: e.message } })) }
    finally { setBusy(null) }
  }

  if (!me) return null
  return (
    <div className="card">
      <h2>수신함 — {orgLabel(me)} 게이트 <span className="hint">({items.length}건 대기)</span></h2>
      <p className="hint">다른 기관이 보낸 문서를 이 기관의 게이트 입장에서 검증합니다. 원장 조회(L2) 뒤 발급 기관이 다르면 등가성 협정으로 등급을 번역합니다(L3). 결과는 관측 로그에 남습니다.</p>
      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p className="hint">대기 중인 수신 문서가 없습니다.</p>}
      {items.length > 0 && (
        <div className="tablewrap">
          <table className="ledger">
            <thead><tr><th>보낸 시각</th><th>보낸 기관</th><th>문서</th><th>발급 등급</th><th>게이트 검증</th><th>결과</th></tr></thead>
            <tbody>
              {items.map((it) => {
                const r = results[it.id]
                return (
                  <tr key={it.id}>
                    <td>{new Date(it.observedAt).toISOString().replace('T', ' ').slice(0, 16)}</td>
                    <td>{orgLabel(it.fromOrg)}</td>
                    <td className="mono" title={it.docGuid}>{it.docGuid.slice(0, 8)}… <span className="hint">{it.note || ''}</span></td>
                    <td><b>{it.grade || '-'}</b></td>
                    <td>
                      {!r && (
                        <button className="pick" disabled={busy === it.id || !it.contentHash} onClick={() => verify(it)}
                          title={it.contentHash ? '' : '해시가 없어 원장 조회를 할 수 없습니다'}>
                          {busy === it.id ? '검증 중…' : '게이트 검증'}
                        </button>
                      )}
                      {r && !r.error && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>기록됨</span>}
                    </td>
                    <td>
                      {r?.error && <span className="error">{r.error}</span>}
                      {r && !r.error && (
                        <span>
                          {TREATY_TEXT[r.checks?.treaty] || r.checks?.treaty} · {r.attribution?.grade}
                          {r.checks?.treaty === 'translated' ? <> → <b>{r.translatedGrade}</b></> : null}
                          {' '}· <b className={r.verdictHint}>{HINT_TEXT[r.verdictHint] || r.verdictHint}</b>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
