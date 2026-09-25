import React from 'react'
import { api } from '../lib/api.js'
import { analyzeFile, extractTextForIdentify } from '../lib/attach.js'
import LaneChart from './ledger/LaneChart.jsx'
import LedgerGraph from './ledger/LedgerGraph.jsx'
import Taxonomy from './ledger/Taxonomy.jsx'
import PassportMap from './ledger/PassportMap.jsx'
import Stamps from './ledger/Stamps.jsx'

// 원장 열람 — 파일 해시가 기록되는 추가 전용 레지스트리(대장).
// 읽기 전용이다: 어떤 경로로도 수정·삭제되지 않는다 (불변식 1).
//
// 시각화 5종은 같은 데이터 묶음(events·checkpoints·observations·treaties·issuers)을
// 한 번 읽어 탭으로 나눠 그린다. 이벤트는 발급 측 진실(원장), 관측 로그는 게이트가
// 보고한 기관 간 이동·검증 기록으로 서로 다른 출처다.
const TABS = [
  ['table', '표'],
  ['lane', '레인 차트'],
  ['graph', '전체 그래프'],
  ['taxonomy', '분류·온톨로지'],
  ['passport', '기관 지도'],
  ['stamps', '기관 간 흐름']
]

export default function LedgerPage() {
  const [apiKey, setApiKey] = React.useState(localStorage.getItem('lm-api-key') || '')
  const [limit, setLimit] = React.useState(500)
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  // 탭: ?tab= 쿼리 > 마지막 선택 > 표
  const [tab, setTab] = React.useState(new URLSearchParams(window.location.search).get('tab') || localStorage.getItem('lm-ledger-tab') || 'table')
  const [loading, setLoading] = React.useState(false)
  const [sample, setSample] = React.useState(null) // 샘플 로딩 결과 {busy, report, error}

  async function load() {
    setError(''); setLoading(true)
    try {
      localStorage.setItem('lm-api-key', apiKey)
      const soft = (p) => p.catch(() => null) // 선택 데이터(협정 미구성 등)는 비어도 화면은 그린다
      const [ledger, ck, obs, tr, keys] = await Promise.all([
        api.ledgerEvents(apiKey, limit), soft(api.checkpoints()), soft(api.observations({}, apiKey)),
        soft(api.treaties()), soft(api.keys())
      ])
      setData({
        events: ledger.events, tip: ledger.tip, from: ledger.from, to: ledger.to,
        checkpoints: ck?.checkpoints || [], observations: obs?.observations || [],
        treaties: tr?.treaties || [], issuers: keys?.issuers || []
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  React.useEffect(() => { load() }, [limit])
  function pick(t) { setTab(t); localStorage.setItem('lm-ledger-tab', t) }

  async function loadSamples() {
    setSample({ busy: true })
    try {
      const report = await api.loadSamples(apiKey)
      setSample({ report })
      await load()
    } catch (e) {
      setSample({ error: e.message })
    }
  }

  const ledger = data
  return (
    <div>
      <h2>원장 (대장)</h2>
      <p className="hint">
        발급·파생·등급변경·폐기가 이벤트 행으로만 추가되는 레지스트리입니다.
        수정·삭제는 불가능하며, 행마다 해시 체인(prevHash→rowHash)으로 봉인됩니다.
      </p>

      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'tab on' : 'tab'} onClick={() => pick(id)}>{label}</button>
        ))}
        <span style={{ flexGrow: 1 }} />
        <button className="pick" onClick={loadSamples} disabled={sample?.busy}
          title="서버의 샘플 폴더(LM_SAMPLE_DIR)의 manifest 대로 파일을 일괄 발급하고 이벤트·기관 간 관측을 기록합니다. 여러 번 눌러도 중복되지 않습니다.">
          {sample?.busy ? '샘플 로딩 중… (의미 지문 계산 포함, 1~2분)' : '샘플 파일 로딩 (기능테스트)'}
        </button>
      </div>
      {sample?.error && <p className="error">샘플 로딩 실패: {sample.error}</p>}
      {sample?.report && (
        <details className="card" style={{ padding: '10px 18px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>
            샘플 로딩 완료 — 발급 {sample.report.issued} · 이벤트 {sample.report.events} · 관측 {sample.report.observations}
            · 건너뜀 {sample.report.skipped} · 실패 <b style={{ color: sample.report.failed ? 'var(--bad)' : 'inherit' }}>{sample.report.failed}</b>
          </summary>
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--muted)', margin: '8px 0 0' }}>{(sample.report.log || []).join('\n')}</pre>
        </details>
      )}

      <p className="hint">
        읽는 행 수:{' '}
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {' '}· API 키 (서버에 설정된 경우만):{' '}
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        {' '}<button className="link" onClick={load}>새로고침</button>
        {loading && <span> · 불러오는 중…</span>}
        {data && <span> · tip #{data.tip} · 봉인 {data.checkpoints.length}회 · 관측 {data.observations.length}건 · 협정 {data.treaties.length}건</span>}
      </p>
      {error && <p className="error">{error}</p>}

      {tab === 'lane' && data && <LaneChart data={data} />}
      {tab === 'graph' && data && <LedgerGraph data={data} />}
      {tab === 'taxonomy' && data && <Taxonomy data={data} />}
      {tab === 'passport' && data && <PassportMap data={data} />}
      {tab === 'stamps' && data && <Stamps data={data} />}

      {tab === 'table' && <ReindexPanel apiKey={apiKey} />}
      {tab === 'table' && <div className="card">
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
      </div>}
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
