import React from 'react'
import { api } from '../lib/api.js'
import { analyzeFile, extractTextForIdentify } from '../lib/attach.js'

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

      <ReindexPanel apiKey={apiKey} />

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
                <tr><th>seq</th><th>이벤트</th><th>등급</th><th>파일명</th><th>docGuid</th><th>contentHash (SHA-256)</th><th>actor</th><th>기록 시각(UTC)</th></tr>
              </thead>
              <tbody>
                {[...ledger.events].reverse().map((e) => (
                  <tr key={e.seq} className={e.eventType === 'REVOKE' || e.eventType === 'DESTROY' ? 'revoked' : ''}>
                    <td>{e.seq}</td>
                    <td>{e.eventType}{e.revokedRef ? ` →${e.revokedRef}` : ''}{e.transform ? ` ←${e.transform}` : ''}</td>
                    <td>{e.grade || '-'}</td>
                    <td title={e.filename}>{e.filename || '-'}</td>
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

// 재색인 — 지문 규칙(정규화·LSH)이 바뀐 뒤, 예전 발급 문서를 최신 지문으로
// 다시 색인한다. 서버는 본문을 저장하지 않으므로 파일이 필요하다: 브라우저가
// 파일에서 해시·본문 텍스트를 뽑아 보내면 서버가 지문을 재계산해 색인을 교체.
function ReindexPanel({ apiKey }) {
  const [busy, setBusy] = React.useState(false)
  const [log, setLog] = React.useState([])
  const inputRef = React.useRef()

  async function handle(files) {
    setBusy(true); setLog([])
    const out = []
    for (const f of [...files]) {
      if (f.name.endsWith('.lmsig')) continue
      try {
        const buf = await f.arrayBuffer()
        const { contentHash } = await analyzeFile(f.name, buf)
        const text = await extractTextForIdentify(f.name, buf)
        if (!text) { out.push(`${f.name}: 텍스트 추출 불가 — 건너뜀`); setLog([...out]); continue }
        const r = await api.reindex(contentHash, text, apiKey)
        out.push(`${f.name}: ✓ 재색인 (docGuid ${r.docGuid.slice(0, 8)}…)`)
      } catch (e) {
        out.push(`${f.name}: ✗ ${e.message}`)
      }
      setLog([...out])
    }
    setBusy(false)
  }

  return (
    <div className="card">
      <h2>지문 재색인</h2>
      <p className="hint">
        지문 규칙이 바뀐 뒤 예전에 발급된 문서는 재식별(유사 문서 찾기)이 안 될 수
        있습니다. 원본 파일을 선택하면 최신 지문으로 색인을 갱신합니다.
        원장 기록(등급·서명)은 바뀌지 않고, 지문 색인만 교체됩니다.
        파일은 서버로 전송되지 않으며 본문 텍스트만 지문 계산에 쓰입니다.
      </p>
      <p>
        <button className="primary" disabled={busy} onClick={() => inputRef.current.click()}>
          {busy ? '재색인 중…' : '재색인할 파일 선택 (여러 개 가능)'}
        </button>
        <input ref={inputRef} type="file" multiple hidden
          onChange={(e) => e.target.files.length && handle(e.target.files)} />
      </p>
      {log.length > 0 && (
        <ul className="ftree" style={{ fontSize: 13 }}>
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  )
}
