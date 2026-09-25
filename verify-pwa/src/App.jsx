import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { VERSION } from './lib/version.js'
import { api, currentOrg, setCurrentOrg } from './lib/api.js'
import { ORG_NAMES } from './lib/orgs.js'

export default function App() {
  const [online, setOnline] = React.useState(navigator.onLine)
  // 현재 기관 페르소나 — 모델 A(단일 서버 다중 기관). 발급의 기본 발급기관이자
  // 검증의 verifierOrg(협정 번역 기준). 데모에서는 한 서버가 모든 기관 키를 들고
  // 있으므로 "기관 간 정책의 시뮬레이션"이지 키 분리는 아니다.
  const [org, setOrg] = React.useState(currentOrg())
  const [issuers, setIssuers] = React.useState([])
  React.useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    const orgChanged = () => setOrg(currentOrg())
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    window.addEventListener('lm-org-changed', orgChanged)
    api.keys().then((k) => {
      const list = k.issuers || []
      setIssuers(list)
      if (!currentOrg() && list.length) setCurrentOrg(k.orgId || list[0].orgId) // 기본 기관
    }).catch(() => {})
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.removeEventListener('lm-org-changed', orgChanged)
    }
  }, [])

  return (
    <div className="app">
      <header>
        <h1>LedgerMarker <span className="version">v{VERSION}</span></h1>
        <nav>
          <NavLink to="/" end>대시보드</NavLink>
          <NavLink to="/keys">키 관리</NavLink>
          <NavLink to="/issue">생성/폐기</NavLink>
          <NavLink to="/ledger">원장</NavLink>
          <NavLink to="/verify">검증</NavLink>
          <NavLink to="/similarity">유사도 테스트</NavLink>
          <NavLink to="/help">도움말</NavLink>
        </nav>
        <label className="orgpick" title="현재 기관(페르소나): 발급 시 기본 발급기관, 검증 시 협정 번역의 기준 기관이 됩니다">
          기관
          <select value={org} onChange={(e) => setCurrentOrg(e.target.value)}>
            {issuers.length === 0 && <option value={org}>{org || '—'}</option>}
            {issuers.map((it) => (
              <option key={it.orgId} value={it.orgId}>{ORG_NAMES[it.orgId] || it.orgName || it.orgId} ({it.orgId})</option>
            ))}
          </select>
        </label>
        <span className={online ? 'badge online' : 'badge offline'}>
          {online ? '온라인' : '오프라인 — 로컬(L1) 검증만 가능'}
        </span>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        파일은 절대 서버로 전송되지 않습니다 — 브라우저에서 해시만 계산합니다.
      </footer>
    </div>
  )
}
