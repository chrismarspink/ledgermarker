import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import VerifyPage from './pages/Verify.jsx'
import IssuePage from './pages/Issue.jsx'
import LedgerPage from './pages/Ledger.jsx'
import LineagePage from './pages/Lineage.jsx'
import AdminPage from './pages/Admin.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          {/* 메뉴는 문서 수명주기 시간순: 대시보드 → 생성 → 원장 → 검증 */}
          <Route path="/" element={<AdminPage />} />
          <Route path="/issue" element={<IssuePage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/lineage/:docGuid" element={<LineagePage />} />
          {/* 구 경로 호환 */}
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
