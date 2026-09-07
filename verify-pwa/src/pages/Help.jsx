import React from 'react'
import { useParams, useLocation, NavLink, Navigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getFormatsCached } from '../lib/attach.js'

// 도움말 탭 (작업지시서 §4). 포맷 지원 페이지는 /v1/formats(단일 진실
// 원천)만 사용한다 — 하드코딩 금지. 화면에는 영문 내부 용어를 노출하지
// 않는다(§4.3 표기 대응표).

export const METHOD_KO = {
  embedded: '파일 안에',
  container: '파일 안에 (묶음)',
  sidecar: '옆에 별도 파일',
  ledger_only: '대장에만 기록'
}
export const SURVIVE_KO = {
  A: '잘 붙어 있음',
  B: '파일과 같이 옮겨야 함',
  C: '대장에서 조회'
}
const STATUS_KO = { supported: '지원 중', planned: '준비 중', unsupported: '대상 아님' }

const SECTIONS = [
  { id: 'about', title: '1. LedgerMarker란?' },
  { id: 'verify-result', title: '2. 검증 결과 읽는 법' },
  { id: 'formats', title: '3. 파일 형식별 지원' },
  { id: 'faq', title: '4. 자주 묻는 질문' },
  { id: 'glossary', title: '5. 용어 사전' }
]

export default function HelpPage() {
  const { section } = useParams()
  if (!section) return <Navigate to="/help/about" replace />
  return (
    <div className="help">
      <nav className="help-toc">
        {SECTIONS.map((s) => (
          <NavLink key={s.id} to={`/help/${s.id}`}>{s.title}</NavLink>
        ))}
      </nav>
      <div className="help-body">
        {section === 'about' && <About />}
        {section === 'verify-result' && <VerifyResult />}
        {section === 'formats' && <FormatsHelp />}
        {section === 'faq' && <FAQ />}
        {section === 'glossary' && <Glossary />}
      </div>
    </div>
  )
}

function About() {
  return (
    <div>
      <h2>LedgerMarker란?</h2>
      <p><b>한 줄로 말하면</b><br />문서에 여권을 발급하고, 그 사실을 대장에 적어두는 시스템입니다.</p>
      <p><b>왜 필요한가요</b><br />
        문서에는 "이건 중요한 문서다"라는 표시가 필요합니다. 그런데 지금까지의 표시는
        세 가지 문제가 있었습니다. 아예 없거나, 파일을 옮기면 떨어지거나, 누구나 고칠 수 있었습니다.</p>
      <p><b>어떻게 해결하나요</b></p>
      <ul>
        <li><b>봉인</b>: 등급 표시에 전자서명을 합니다. 한 글자라도 고치면 봉인이 깨져 바로 들통납니다.</li>
        <li><b>대장</b>: 발급 사실을 지워지지 않는 장부에 기록합니다. 표시가 사라진 파일도 대장을 뒤져 찾아냅니다.</li>
        <li><b>족보</b>: 문서가 수정되거나 다른 형식으로 바뀌면 부모-자식 관계를 기록합니다.</li>
      </ul>
      <p><b>무엇을 하지 않나요</b><br />
        LedgerMarker는 "이 문서가 무엇인지"를 알려줄 뿐, 통과시킬지 막을지는 결정하지 않습니다.
        그 판단은 각 기관의 게이트가 정책에 따라 내립니다.</p>
    </div>
  )
}

function VerifyResult() {
  return (
    <div>
      <h2>검증 결과 읽는 법</h2>
      <p>검증 결과는 통과/실패 두 글자가 아니라 <b>다섯 가지를 각각</b> 보여줍니다.
        어디서 걸렸는지 알아야 조치할 수 있기 때문입니다.</p>
      <div className="tablewrap">
        <table className="ledger">
          <thead><tr><th>항목</th><th>무엇을 보나</th><th>결과가 나쁠 때</th></tr></thead>
          <tbody>
            <tr><td><b>봉인</b></td><td>서명이 유효한가</td><td>문서가 변조되었거나, 서명 없이 만들어진 파일입니다</td></tr>
            <tr><td><b>대장</b></td><td>발급 기록이 있는가</td><td>우리 체계 밖에서 만들어진 문서일 수 있습니다</td></tr>
            <tr><td><b>폐기</b></td><td>취소된 이름표인가</td><td>이미 무효화된 문서입니다. 최신본을 받으세요</td></tr>
            <tr><td><b>기간</b></td><td>유효기간 안인가</td><td>재발급이 필요합니다</td></tr>
            <tr><td><b>협정</b></td><td>상대 기관과 합의가 있는가</td><td>협정이 없는 기관의 문서입니다</td></tr>
          </tbody>
        </table>
      </div>
      <p><b>꼭 구분해야 할 두 가지</b></p>
      <ul>
        <li><b>"대장에 없음"</b> — 조회했는데 기록이 없습니다. 미등록 문서입니다.</li>
        <li><b>"대장 확인 불가"</b> — 네트워크가 끊겨 조회를 못 했습니다. <b>없다는 뜻이 아닙니다.</b> 연결 후 다시 확인하세요.</li>
      </ul>
      <p>이 둘을 같게 취급하면 멀쩡한 문서를 막게 됩니다.</p>
    </div>
  )
}

// ── 3. 파일 형식별 지원 — 카탈로그 렌더링 (§4.3) ─────────────
function FormatsHelp() {
  const [catalog, setCatalog] = React.useState(null)
  const [failed, setFailed] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [methodF, setMethodF] = React.useState('')
  const [statusF, setStatusF] = React.useState('')
  const { hash } = useLocation()
  const highlight = hash.replace('#', '')

  React.useEffect(() => {
    getFormatsCached().then((c) => (c ? setCatalog(c) : setFailed(true)))
  }, [])
  React.useEffect(() => {
    if (highlight && catalog) {
      document.getElementById('fmt-' + highlight)?.scrollIntoView({ block: 'center' })
    }
  }, [highlight, catalog])

  const rows = (catalog?.formats || []).filter((f) => {
    if (methodF && f.method !== methodF) return false
    if (statusF && f.status !== statusF) return false
    if (query) {
      const q = query.toLowerCase()
      const inName = f.name.toLowerCase().includes(q)
      const inExt = (f.extensions || []).some((e) => e.includes(q))
      if (!inName && !inExt) return false
    }
    return true
  })

  return (
    <div>
      <h2>파일 형식별 지원</h2>
      <p><b>모든 파일에 이름표를 붙일 수 있습니다.</b> 다만 붙이는 방법이 형식마다 다릅니다.</p>
      <p>한글이나 워드 문서처럼 안에 빈칸이 있는 형식은 <b>파일 안에</b> 넣습니다.
        그런 자리가 없는 형식은 <b>옆에 작은 파일(.lmsig)을 하나 더</b> 만들어 함께 둡니다.
        어느 쪽이든 발급 사실은 항상 대장에 기록되므로, 이름표가 사라져도 파일을 알아볼 수 있습니다.</p>

      <FileCheckBox />

      <p className="help-filters">
        <input placeholder="형식 이름·확장자 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={methodF} onChange={(e) => setMethodF(e.target.value)}>
          <option value="">붙이는 방법: 전체</option>
          <option value="embedded">파일 안에</option>
          <option value="container">파일 안에 (묶음)</option>
          <option value="sidecar">옆에 별도 파일</option>
          <option value="ledger_only">대장에만 기록</option>
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">상태: 전체</option>
          <option value="supported">지원 중</option>
          <option value="planned">준비 중</option>
        </select>
      </p>

      {failed && <p className="error">목록을 불러올 수 없습니다 — 서버 연결 후 다시 열어 주세요.</p>}
      {catalog && (
        <div className="tablewrap">
          <table className="ledger">
            <thead>
              <tr><th>형식</th><th>붙이는 방법</th><th>얼마나 잘 붙어 있나</th><th>상태</th><th>주의</th></tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} id={'fmt-' + f.id} className={highlight === f.id ? 'hl' : ''}>
                  <td><b>{f.name}</b> <span className="hint">{(f.extensions || []).join(' ')}</span></td>
                  <td><span className={'mbadge m-' + f.method}>{METHOD_KO[f.method]}</span></td>
                  <td><span className={'sbadge s-' + f.survivability}>{SURVIVE_KO[f.survivability]}</span></td>
                  <td>{STATUS_KO[f.status]}</td>
                  <td>{f.warning ? <span className="warnicon" title={f.warning}>⚠</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <blockquote className="notice">
        <b>형식을 바꾸면 이름표는 사라집니다.</b><br />
        한글 문서를 PDF로 저장하거나, 이미지를 다른 형식으로 변환하면 붙여둔 이름표가
        함께 사라집니다. 이건 어떤 방법을 써도 마찬가지입니다.<br />
        그래서 LedgerMarker는 <b>족보</b>를 기록합니다. 변환된 파일이 어느 문서에서
        나왔는지 대장이 기억하고 있으므로, 이름표가 없어도 원래 등급을 찾아낼 수 있습니다.
      </blockquote>
      <blockquote className="notice">
        <b>주의가 필요한 파일이 있습니다.</b><br />
        프로그램 실행 파일처럼 이미 제조사 서명이 되어 있는 파일은, 안에 무언가를 넣으면
        그 서명이 깨집니다. 이런 파일에는 이름표를 옆에 따로 두는 방식만 사용합니다.
      </blockquote>
    </div>
  )
}

// 내 파일 확인 박스 — 파일은 업로드하지 않는다: 파일명·매직넘버만 (H5)
function FileCheckBox() {
  const [result, setResult] = React.useState(null)
  const [error, setError] = React.useState('')
  const inputRef = React.useRef()

  async function check(file) {
    setError('')
    setResult(null)
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
      const magicHex = [...head].map((b) => b.toString(16).padStart(2, '0')).join('')
      const res = await api.formatsResolve(file.name, magicHex)
      setResult({ ...res, fileName: file.name })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div
      className="filecheck"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && check(e.dataTransfer.files[0]) }}
      onClick={() => inputRef.current.click()}
    >
      <b>내 파일 확인</b> — 파일을 끌어다 놓으면 어떤 방식으로 붙는지 알려드립니다.
      <div className="hint">파일은 업로드하지 않습니다 — 파일 이름과 첫 16바이트만 확인합니다.</div>
      <input ref={inputRef} type="file" hidden onChange={(e) => e.target.files[0] && check(e.target.files[0])} />
      {result && (
        <div className="filecheck-result">
          <b>{result.fileName}</b> → {result.name} ·{' '}
          <span className={'mbadge m-' + result.method}>{METHOD_KO[result.method]}</span>{' '}
          <span className={'sbadge s-' + result.survivability}>{SURVIVE_KO[result.survivability]}</span>
          {result.fallbackReason === 'not_implemented' && ' (파일 안에 넣는 방식은 준비 중이라 지금은 옆에 별도 파일로 붙습니다)'}
          {result.warning && <div className="error">⚠ {result.warning}</div>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function FAQ() {
  const items = [
    ['파일이 서버로 전송되나요?',
      '아니요. 검증은 여러분의 컴퓨터 안에서 이루어집니다. 서버에는 파일의 지문(해시)만 보내 대장을 조회할 뿐, 문서 내용은 나가지 않습니다.'],
    ['인터넷이 안 되는 곳에서도 되나요?',
      '됩니다. 봉인 확인은 인터넷 없이도 가능합니다. 다만 대장 조회는 연결이 필요해서, 그 항목만 "확인 불가"로 표시됩니다.'],
    ['.lmsig 파일을 지워도 되나요?',
      '지워도 문서는 열립니다. 다만 이름표가 없어지므로, 검증할 때 대장 조회로만 확인하게 됩니다. 가급적 문서와 함께 보관하세요.'],
    ['파일을 조금 고쳤더니 검증에 실패합니다.',
      '정상입니다. 이름표는 그 시점의 문서 내용에 묶여 있어서, 내용이 바뀌면 새 이름표가 필요합니다. 문서를 저장하면 자동으로 다시 발급됩니다.'],
    ['종이로 출력한 문서는요?',
      '출력물에 QR을 함께 인쇄하면, 스캔해서 대장을 조회할 수 있습니다.'],
    ['등급을 낮추고 싶습니다.',
      '등급을 올리는 것은 자동으로 되지만, 낮추는 것은 승인이 필요합니다. 잘못 낮추면 위험하기 때문입니다.']
  ]
  return (
    <div>
      <h2>자주 묻는 질문</h2>
      {items.map(([q, a]) => (
        <p key={q}><b>Q. {q}</b><br />{a}</p>
      ))}
    </div>
  )
}

function Glossary() {
  const rows = [
    ['이름표 · 여권', '서명 라벨', '등급·근거·족보가 담긴, 고치면 티가 나는 표시'],
    ['봉인', '전자서명', '내용이 바뀌면 깨지는 수학적 잠금'],
    ['대장', '해시 원장', '발급·폐기 기록이 지워지지 않는 장부'],
    ['지문', '해시(SHA-256)', '파일 내용을 요약한 고유한 값'],
    ['족보', '계보', '문서의 부모-자식(수정·변환) 관계'],
    ['옆에 별도 파일', '사이드카(.lmsig)', '문서와 짝을 이루는 이름표 파일'],
    ['대장 확인 불가', '원장 조회 불가', '네트워크 문제로 조회하지 못한 상태']
  ]
  return (
    <div>
      <h2>용어 사전</h2>
      <div className="tablewrap">
        <table className="ledger">
          <thead><tr><th>쉬운 말</th><th>정식 명칭</th><th>뜻</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r[0]}><td><b>{r[0]}</b></td><td>{r[1]}</td><td>{r[2]}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
