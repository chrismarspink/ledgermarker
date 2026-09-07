import React from 'react'
import { api } from '../lib/api.js'

// 운영 대시보드 — 발급·검증·폐기 추이, 체크포인트 상태 (DEV SPEC §8.2)
export default function AdminPage() {
  const [apiKey, setApiKey] = React.useState(localStorage.getItem('lm-api-key') || '')
  const [stats, setStats] = React.useState(null)
  const [ledger, setLedger] = React.useState(null)
  const [error, setError] = React.useState('')

  async function load() {
    setError('')
    try {
      localStorage.setItem('lm-api-key', apiKey)
      setStats(await api.adminStats(apiKey))
      setLedger(await api.ledgerEvents(apiKey))
    } catch (e) {
      setError(e.message)
    }
  }
  React.useEffect(() => { load() }, [])

  const counts = stats?.eventCounts || {}
  const ckpt = stats?.latestCheckpoint
  return (
    <div>
      <h2>운영 대시보드</h2>
      <p className="hint">
        API 키:{' '}
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        {' '}<button className="link" onClick={load}>새로고침</button>
      </p>
      {error && <p className="error">{error}</p>}
      <div className="stats">
        <div className="stat"><div className="n">{counts.ISSUE || 0}</div><div className="t">발급 (ISSUE)</div></div>
        <div className="stat"><div className="n">{counts.DERIVE || 0}</div><div className="t">파생 (DERIVE)</div></div>
        <div className="stat"><div className="n">{counts.REGRADE || 0}</div><div className="t">등급변경 (REGRADE)</div></div>
        <div className="stat"><div className="n">{counts.REVOKE || 0}</div><div className="t">폐기 (REVOKE)</div></div>
      </div>
      <div className="card">
        <h2>최신 체크포인트 (원장 봉인)</h2>
        {ckpt ? (
          <div className="mono">
            #{ckpt.ID ?? ckpt.ckptId} · seq {ckpt.FromSeq ?? ckpt.fromSeq} ~ {ckpt.ToSeq ?? ckpt.toSeq}
            <br />signed at {String(ckpt.SignedAt ?? ckpt.signedAt)}
          </div>
        ) : (
          <p className="hint">아직 발행된 체크포인트가 없습니다</p>
        )}
      </div>
      <div className="card">
        <h2>원장 열람 {ledger && <span className="hint">— tip #{ledger.tip}, 최근 {ledger.events.length}행 (추가 전용·수정 불가)</span>}</h2>
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
                    <td>{e.actor}</td>
                    <td>{new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">원장이 비어 있습니다</p>
        )}
        <p className="hint">docGuid·해시 전체 값은 셀에 마우스를 올리면 표시됩니다. 원문은 lm ledger list --json 참조.</p>
      </div>
      <div className="card">
        <h2>라벨 서명자</h2>
        {stats?.labelSigner && (
          <div className="mono">
            SN {stats.labelSigner.serial}<br />만료 {String(stats.labelSigner.notAfter)} (90일 주기 자동 교체 대상)
          </div>
        )}
      </div>
    </div>
  )
}
