import React from 'react'
import { sha256Hex, bytesToBase64 } from '../lib/hash.js'
import { api } from '../lib/api.js'
import { extractEmbedded, embedLabel } from '../lib/embed.js'

// 라벨 발급 페이지 — 파일에 라벨을 내장(트레일러 방식)해 내려준다.
// 파일 본문은 서버로 전송하지 않는다: 해시만 보내고, 서명(라벨)만 받아
// 브라우저에서 원본 뒤에 덧붙인다.
export default function IssuePage() {
  const [file, setFile] = React.useState(null)
  const [parentFile, setParentFile] = React.useState(null)
  const [drag, setDrag] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [done, setDone] = React.useState(null)
  const [form, setForm] = React.useState({
    grade: 'S', basisClause: '', keywords: '', brmPath: '',
    approvalState: 'CONFIRMED', transform: 'edit', notAfterDays: 365
  })
  const [apiKey, setApiKey] = React.useState(localStorage.getItem('lm-api-key') || '')
  const fileRef = React.useRef()
  const parentRef = React.useRef()

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function issue() {
    setError('')
    setDone(null)
    if (!file) { setError('라벨을 붙일 파일을 선택하세요'); return }
    setBusy(true)
    try {
      localStorage.setItem('lm-api-key', apiKey)
      const buf = await file.arrayBuffer()
      if (extractEmbedded(buf)) {
        throw new Error('이 파일에는 이미 라벨이 내장되어 있습니다. 재발급하려면 원본(라벨 제거본)을 사용하세요.')
      }
      const contentHash = await sha256Hex(file)

      const payload = {
        contentHash,
        grade: form.grade,
        approvalState: form.approvalState,
        notAfterDays: Number(form.notAfterDays) || 365
      }
      if (form.basisClause) payload.basisClause = Number(form.basisClause)
      if (form.keywords.trim()) {
        payload.basisKeywords = form.keywords.split(',').map((s) => s.trim()).filter(Boolean)
      }
      if (form.brmPath.trim()) payload.brmPath = form.brmPath.trim()
      if (parentFile) {
        const parentHash = await sha256Hex(parentFile)
        payload.lineage = { parentHash, transform: form.transform }
      }

      const res = await api.issue(payload, apiKey, 'web:' + contentHash)

      // 라벨 내장 파일 생성 (원본 + DER + 트레일러)
      const der = Uint8Array.from(atob(res.labelDer), (c) => c.charCodeAt(0))
      const labeled = embedLabel(new Uint8Array(buf), der)
      setDone({
        res,
        fileName: file.name,
        labeledUrl: URL.createObjectURL(labeled),
        sidecarUrl: URL.createObjectURL(new Blob([der], { type: 'application/octet-stream' }))
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div
        className={drag ? 'dropzone drag' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files[0]); setDone(null) }}
        onClick={() => fileRef.current.click()}
      >
        {file
          ? <p><b>{file.name}</b> ({(file.size / 1024).toFixed(1)} KB)</p>
          : <p><b>라벨을 붙일 파일을 끌어다 놓으세요</b></p>}
        <p className="hint">파일 본문은 서버로 전송되지 않습니다 — 해시만 전송, 라벨은 브라우저에서 내장</p>
        <input ref={fileRef} type="file" hidden onChange={(e) => { setFile(e.target.files[0]); setDone(null) }} />
      </div>

      <div className="card form">
        <h2>라벨 필드</h2>
        <div className="fields">
          <label>등급
            <select value={form.grade} onChange={set('grade')}>
              <option value="S">S — 민감(비공개)</option>
              <option value="O">O — 공개</option>
            </select>
          </label>
          <label>승인 상태
            <select value={form.approvalState} onChange={set('approvalState')}>
              <option value="CONFIRMED">CONFIRMED (확정)</option>
              <option value="PROVISIONAL">PROVISIONAL (잠정 — 내부 통행만)</option>
            </select>
          </label>
          <label>근거 조항 (정보공개법 9조)
            <select value={form.basisClause} onChange={set('basisClause')}>
              <option value="">해당 없음</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}호</option>)}
            </select>
          </label>
          <label>근거 키워드 (쉼표 구분)
            <input value={form.keywords} onChange={set('keywords')} placeholder="주민등록번호, 계좌번호" />
          </label>
          <label>업무 분류 경로 (BRM)
            <input value={form.brmPath} onChange={set('brmPath')} placeholder="우정 > 우편 > 우편사업지원" />
          </label>
          <label>유효기간(일)
            <input type="number" value={form.notAfterDays} onChange={set('notAfterDays')} />
          </label>
        </div>

        <h2>계보 (선택)</h2>
        <div className="fields">
          <label>부모 문서 (이 파일의 원본)
            <button className="pick" onClick={() => parentRef.current.click()}>
              {parentFile ? parentFile.name : '파일 선택…'}
            </button>
            {parentFile && <button className="link" onClick={() => setParentFile(null)}>해제</button>}
            <input ref={parentRef} type="file" hidden onChange={(e) => setParentFile(e.target.files[0])} />
          </label>
          {parentFile && (
            <label>변환 종류
              <select value={form.transform} onChange={set('transform')}>
                <option value="edit">edit — 수정</option>
                <option value="convert">convert — 형식 변환</option>
                <option value="merge">merge — 병합</option>
                <option value="extract">extract — 발췌</option>
              </select>
            </label>
          )}
        </div>

        <p className="hint">
          API 키 (서버에 설정된 경우만):{' '}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </p>
        <button className="primary" disabled={busy || !file} onClick={issue}>
          {busy ? '발급 중…' : '라벨 발급'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      {done && (
        <div className="card">
          <h2>발급 완료</h2>
          <div className="mono">
            docGuid {done.res.docGuid} · 원장 seq {done.res.ledgerSeq}
            <br />유효기간 ~ {new Date(done.res.notAfter).toLocaleDateString('ko-KR')}
          </div>
          <p>
            <a className="download" href={done.labeledUrl} download={done.fileName}>
              ⬇ 라벨 내장 파일 받기 — {done.fileName}
            </a>
          </p>
          <p>
            <a href={done.sidecarUrl} download={done.fileName + '.lmsig'}>
              사이드카(.lmsig)로도 받기
            </a>
          </p>
          <p className="hint">
            내장 파일은 원본 뒤에 라벨 트레일러를 덧붙인 것입니다(원본 내용 불변).
            검증 화면과 lm CLI가 자동 인식합니다. PDF·JPEG 등은 그대로 열리며,
            일부 엄격한 ZIP 리더(docx/hwpx)는 경고할 수 있습니다 — 포맷별 정식
            내장은 Phase 2.
          </p>
        </div>
      )}
    </div>
  )
}
