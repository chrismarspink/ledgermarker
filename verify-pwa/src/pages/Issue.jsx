import React from 'react'
import { api } from '../lib/api.js'
import { analyzeFile, buildEmbedded } from '../lib/attach.js'
import { orgLabel } from '../lib/orgs.js'
import { METHOD_KO } from './Help.jsx'
import { Link } from 'react-router-dom'

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
      // 포맷 카탈로그 기반 분석 — 해시 대상(라벨 제외·필요 시 정규화) 계산
      const analysis = await analyzeFile(file.name, buf)
      if (analysis.labelDerBytes) {
        throw new Error('이 파일에는 이미 이름표가 붙어 있습니다. 재발급하려면 원본(이름표 제거본)을 사용하세요.')
      }
      const format = analysis.format
      const contentHash = analysis.contentHash

      // 부착 방식 결정 (폴백 규칙): 지원 내장 → 파일 안에, 준비 중 → 사이드카
      let method = 'sidecar'
      let fallbackReason = ''
      const canEmbed = format.method === 'embedded' && format.status === 'supported'
      if (canEmbed) {
        method = 'embedded'
      } else if (format.method === 'embedded' || format.method === 'container') {
        fallbackReason = 'not_implemented'
      }

      const payload = {
        contentHash,
        grade: form.grade,
        approvalState: form.approvalState,
        notAfterDays: Number(form.notAfterDays) || 365,
        attach: { method, formatId: format.id, fallbackReason }
      }
      if (form.basisClause) payload.basisClause = Number(form.basisClause)
      if (form.keywords.trim()) {
        payload.basisKeywords = form.keywords.split(',').map((s) => s.trim()).filter(Boolean)
      }
      if (form.brmPath.trim()) payload.brmPath = form.brmPath.trim()
      if (parentFile) {
        // 부모 해시도 라벨 제외 본문 기준으로 계산한다 —
        // 원장에는 그 기준 해시가 등록되어 있다.
        const pAnalysis = await analyzeFile(parentFile.name, await parentFile.arrayBuffer())
        payload.lineage = { parentHash: pAnalysis.contentHash, transform: form.transform }
      }

      const res = await api.issue(payload, apiKey, 'web:' + contentHash)

      // 내장 라벨 파일 생성 (형식별 방식 — 준비 중 형식은 사이드카만)
      const der = Uint8Array.from(atob(res.labelDer), (c) => c.charCodeAt(0))
      const labeled = canEmbed ? buildEmbedded(format, file.name, buf, der) : null
      setDone({
        res,
        format,
        method,
        fallbackReason,
        fileName: file.name,
        labeledUrl: labeled ? URL.createObjectURL(labeled) : null,
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

      <LifecycleSection apiKey={apiKey} />

      {done && (
        <div className="card">
          <h2>발급 완료</h2>
          <div className="mono">
            docGuid {done.res.docGuid} · 원장 seq {done.res.ledgerSeq}
            <br />유효기간 ~ {new Date(done.res.notAfter).toLocaleDateString('ko-KR')}
            <br />형식: {done.format.name} · 붙이는 방법:{' '}
            <Link to={`/help/formats#${done.format.id}`}>{METHOD_KO[done.method]}</Link>
          </div>
          {done.labeledUrl ? (
            <p>
              <a className="download" href={done.labeledUrl} download={done.fileName}>
                ⬇ 이름표 내장 파일 받기 — {done.fileName}
              </a>
            </p>
          ) : (
            <p className="hint">
              {done.fallbackReason === 'not_implemented'
                ? '이 형식은 파일 안에 넣는 방식이 준비 중이라, 지금은 옆에 별도 파일(.lmsig)로 붙입니다.'
                : '이 형식은 옆에 별도 파일(.lmsig)로 붙입니다.'}
              {done.format.warning && <> ⚠ {done.format.warning}</>}
            </p>
          )}
          <p>
            <a href={done.sidecarUrl} download={done.fileName + '.lmsig'}>
              {done.labeledUrl ? '사이드카(.lmsig)로도 받기' : '⬇ 이름표 파일(.lmsig) 받기 — 문서와 함께 보관하세요'}
            </a>
          </p>
          <p className="hint">
            발급 사실은 항상 대장에 기록되므로, 이름표가 사라져도 문서를 알아볼 수
            있습니다. 형식별 자세한 내용은 <Link to="/help/formats">도움말 › 파일 형식별 지원</Link>.
          </p>
        </div>
      )}
    </div>
  )
}

// ── 수명주기 조치: 등급 변경(공개 전환) · 폐기 · 파기 ──────────
// 세 전이는 서로 다르다 (docs/lifecycle-policy.md):
//  - 폐기(REVOKE): 유통 정지. 비밀성 유지, 가역. 공개 전환이 아니다.
//  - 등급 하향(REGRADE S→O): "공개 전환" — 승인 토큰 필수.
//  - 파기(DESTROY): 보존기간 만료 + 심의 후 키 파기. 불가역. 증적은 영구.
function LifecycleSection({ apiKey }) {
  const [target, setTarget] = React.useState(null)
  const [action, setAction] = React.useState('') // revoke | regrade | destroy
  const [reason, setReason] = React.useState('')
  const [newGrade, setNewGrade] = React.useState('O')
  const [token, setToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState(null)
  const fileRef = React.useRef()

  async function lookup(file) {
    setMsg(null); setTarget(null); setAction(''); setBusy(true)
    try {
      const { contentHash } = await analyzeFile(file.name, await file.arrayBuffer())
      const res = await api.verify({ contentHash, level: 2 })
      if (!res.attribution?.docGuid) {
        throw new Error(
          res.checks.ledger === 'unregistered'
            ? '원장에 발급 기록이 없습니다. 라벨이 붙어 있는데도 이 메시지가 나오면 발급 이후 원장이 초기화된 경우입니다(인메모리 데모 모드는 서버 재시작 시 초기화) — lm issue <파일> --force 로 재등록하거나, 영속 운영은 PostgreSQL 모드(LM_DB_URL)를 사용하세요.'
            : `원장 조회 불가 (ledger=${res.checks.ledger}) — 서버 연결을 확인하세요`)
      }
      setTarget({
        fileName: file.name,
        docGuid: res.attribution.docGuid,
        grade: res.attribution.grade,
        issuerOrg: res.attribution.issuerOrg,
        revocation: res.checks.revocation,
        reasons: res.reasons || []
      })
      setNewGrade(res.attribution.grade === 'S' ? 'O' : 'S')
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true); setMsg(null)
    try {
      if (action === 'revoke') {
        await api.revoke(target.docGuid, reason, apiKey)
        setMsg({ ok: true, text: '폐기 등록 완료 — 유통이 정지됩니다. 본문 비밀성은 유지되며, 공개가 필요하면 등급 하향(공개 전환) 절차를 밟으세요.' })
      } else if (action === 'regrade') {
        const r = await api.regrade(target.docGuid, newGrade, token, reason, apiKey)
        setMsg({ ok: true, text: `등급 변경 완료 (seq ${r.ledgerSeq}) — 구 라벨은 superseded 처리됩니다. 새 라벨을 재배포하세요.` })
      } else if (action === 'destroy') {
        await api.destroy(target.docGuid, reason, token, apiKey)
        setMsg({ ok: true, text: '파기 완료 — 불가역. 원장 증적(해시·계보)은 영구 보존되며, 이후 사본 검증은 destroyed/deny로 판정됩니다.' })
      }
      setTarget(null); setAction(''); setReason(''); setToken('')
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const destroyed = target?.reasons.includes('destroyed')
  return (
    <div className="card">
      <h2>수명주기 조치 — 등급 변경 · 폐기 · 파기</h2>
      <p className="hint">
        폐기 = 유통 정지(비밀성 유지·가역) · 공개 전환 = 등급 하향 REGRADE(승인 필수) ·
        파기 = 심의 후 키 파기(불가역, 증적 영구 보존). 셋은 서로 다릅니다 — docs/lifecycle-policy.md
      </p>
      {!target && (
        <p>
          <button className="pick" disabled={busy} onClick={() => fileRef.current.click()}>
            {busy ? '조회 중…' : '대상 문서 파일 선택… (원장에서 docGuid 조회)'}
          </button>
          <input ref={fileRef} type="file" hidden
            onChange={(e) => e.target.files[0] && lookup(e.target.files[0])} />
        </p>
      )}
      {target && (
        <>
          <div className="mono">
            {target.fileName} → docGuid {target.docGuid}
            <br />등급 {target.grade} · {orgLabel(target.issuerOrg)} · 폐기 상태: {target.revocation}
            {destroyed ? ' (파기됨)' : ''}
          </div>
          {destroyed ? (
            <p className="error">이미 파기된 문서입니다 — 사본이 유통 중이라면 게이트가 차단합니다.</p>
          ) : (
            <>
              <p>
                조치:{' '}
                <select value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="">선택…</option>
                  <option value="regrade">등급 변경 (하향 = 공개 전환)</option>
                  <option value="revoke" disabled={target.revocation === 'revoked'}>폐기 (유통 정지)</option>
                  <option value="destroy">파기 (불가역 — 심의 필수)</option>
                </select>
              </p>
              {action === 'regrade' && (
                <p>
                  새 등급:{' '}
                  <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)}>
                    <option value="S">S — 민감</option>
                    <option value="O">O — 공개</option>
                  </select>
                  {gradeRankJS(newGrade) < gradeRankJS(target.grade) && (
                    <>{' '}<input type="password" placeholder="하향(공개 전환) 승인 토큰 — 필수"
                      value={token} onChange={(e) => setToken(e.target.value)} /></>
                  )}
                </p>
              )}
              {action === 'destroy' && (
                <p>
                  <input type="password" placeholder="파기 심의 승인 토큰 — 필수"
                    value={token} onChange={(e) => setToken(e.target.value)} />
                  <span className="error"> ⚠ 불가역: 복호화 키가 파기되어 내용에 다시는 접근할 수 없습니다</span>
                </p>
              )}
              {action && (
                <p>
                  <input placeholder={action === 'destroy' ? '파기 심의 근거 — 필수' : '사유'}
                    value={reason} onChange={(e) => setReason(e.target.value)}
                    style={{ width: '55%', marginRight: 8 }} />
                  <button className="primary" disabled={busy} onClick={run}>
                    {action === 'revoke' ? '폐기 등록' : action === 'regrade' ? '등급 변경' : '파기 실행'}
                  </button>
                  {' '}<button className="link" onClick={() => { setTarget(null); setAction('') }}>취소</button>
                </p>
              )}
            </>
          )}
        </>
      )}
      {msg && <p className={msg.ok ? 'hint' : 'error'}>{msg.text}</p>}
    </div>
  )
}

function gradeRankJS(g) { return g === 'S' ? 2 : g === 'O' ? 1 : 0 }
