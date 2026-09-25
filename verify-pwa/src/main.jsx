import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import VerifyPage from './pages/Verify.jsx'
import IssuePage from './pages/Issue.jsx'
import LedgerPage from './pages/Ledger.jsx'
import LineagePage from './pages/Lineage.jsx'
import SimilarityPage from './pages/Similarity.jsx'
import AdminPage from './pages/Admin.jsx'
import KeysPage from './pages/Keys.jsx'
import HelpPage from './pages/Help.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* GitHub Pages 처럼 하위 경로에 올릴 때(vite --base) 라우터 기준 경로를 맞춘다 */}
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route element={<App />}>
          {/* 메뉴는 문서 수명주기 시간순: 대시보드 → 생성 → 원장 → 검증 */}
          <Route path="/" element={<AdminPage />} />
          <Route path="/keys" element={<KeysPage />} />
          <Route path="/issue" element={<IssuePage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          {/* 공격 시나리오는 검증 화면에 통합됨 — 구 경로 호환 */}
          <Route path="/attack" element={<VerifyPage />} />
          <Route path="/similarity" element={<SimilarityPage />} />
          <Route path="/lineage/:docGuid" element={<LineagePage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:section" element={<HelpPage />} />
          {/* 구 경로 호환 */}
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
