import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import VerifyPage from './pages/Verify.jsx'
import LineagePage from './pages/Lineage.jsx'
import AdminPage from './pages/Admin.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<VerifyPage />} />
          <Route path="/lineage/:docGuid" element={<LineagePage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
