import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'

export default function App() {
  const [online, setOnline] = React.useState(navigator.onLine)
  React.useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return (
    <div className="app">
      <header>
        <h1>LedgerMarker</h1>
        <nav>
          <NavLink to="/" end>대시보드</NavLink>
          <NavLink to="/issue">생성</NavLink>
          <NavLink to="/ledger">원장</NavLink>
          <NavLink to="/verify">검증</NavLink>
        </nav>
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
