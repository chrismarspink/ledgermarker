import React from 'react'
import { api } from '../lib/api.js'

// 원장 열람 — 파일 해시가 기록되는 추가 전용 레지스트리(대장).
// 읽기 전용이다: 어떤 경로로도 수정·삭제되지 않는다 (불변식 1).
export default function LedgerPage() {
  const [apiKey, setApiKey] = React.useState(localStorage.getItem('lm-api-key') || '')
  const [limit, setLimit] = React.useState(50)
  const [ledger, setLedger] = React.useState(null)
  const [error, setError] = React.useState('')

  async function load() {
    setError('')
    try {
      localStorage.setItem('lm-api-key', apiKey)
      setLedger(await api.ledgerEvents(apiKey, limit))
    } catch (e) {
      setError(e.message)
    }
  }
  React.useEffect(() => { load() }, [])

  return (
    <div>
      <h2>원장 (대장)</h2>
      <p className="hint">
        발급·파생·등급변경·폐기가 이벤트 행으로만 추가되는 레지스트리입니다.
        수정·삭제는 불가능하며, 행마다 해시 체인(prevHash→rowHash)으로 봉인됩니다.
      </p>
      <p className="hint">
        표시 행 수:{' '}
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[20, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {' '}· API 키 (서버에 설정된 경우만):{' '}
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        {' '}<button className="link" onClick={load}>새로고침</button>
      </p>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>
          이벤트 목록
          {ledger && <span className="hint"> — tip #{ledger.tip}, seq {ledger.from}~{ledger.to} (최신순)</span>}
        </h2>
        {ledger && ledger.events.length > 0 ? (
          <div className="tablewrap">
            <table className="ledger">
              <thead>
                <tr><th>seq</th><th>이벤트</th><th>등급</th><th>docGuid</th><th>contentHash (SHA-256)</th><th>actor</th><th>기록 시각(UTC)</th></tr>
              </thead>
              <tbody>
                {[...ledger.events].reverse().map((e) => (
                  <tr key={e.seq} className={e.eventType === 'REVOKE' ? 'revoked' : ''}>
                    <td>{e.seq}</td>
                    <td>{e.eventType}{e.revokedRef ? ` →${e.revokedRef}` : ''}{e.transform ? ` ←${e.transform}` : ''}</td>
                    <td>{e.grade || '-'}</td>
                    <td className="mono" title={e.docGuid}>{e.docGuid.slice(0, 8)}…</td>
                    <td className="mono" title={e.contentHash}>{e.contentHash.slice(0, 16)}…</td>
                    <td title={e.actor}>{e.actor.length > 16 ? e.actor.slice(0, 15) + '…' : e.actor}</td>
                    <td>{new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">원장이 비어 있습니다</p>
        )}
        <p className="hint">
          docGuid·해시 전체 값은 셀에 마우스를 올리면 표시됩니다.
          체인 무결성 점검은 <code>lm ledger verify</code>, 원문 전체는 <code>lm ledger list --json</code>.
        </p>
      </div>
    </div>
  )
}
