import React from 'react'
import { sha256Hex } from '../lib/hash.js'
import { api } from '../lib/api.js'
import { analyzeFile, extractTextForIdentify } from '../lib/attach.js'
import { orgLabel } from '../lib/orgs.js'
import { SigGrid, ShingleVenn, Meter, ContainBars, ChunkLinks, CandidateMap, MiniBar, pct } from '../components/SimilarityViz.jsx'

// 유사도 테스트 — 세 층위의 식별 방식을 한 화면에서 비교한다:
//   ① 파일 전체 해시(SHA-256, 정확 일치)
//   ② MinHash 자카드 유사도(문자 5-gram 지문, 수정본·변환본)
//   ③ 의미 유사도(사내 docsim, 재작성본)
// 테스트 파일을 올린 뒤 비교 파일을 직접 넣거나 원장에서 유사 파일을 찾는다.
// ②③은 본문 텍스트를 서버로 전송한다(저장하지 않음).
export default function SimilarityPage() {
  const [mode, setMode] = React.useState('file') // file | ledger
  const [target, setTarget] = React.useState(null)
  const [other, setOther] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [result, setResult] = React.useState(null)

  const ready = target && (mode === 'ledger' || other)

  async function run() {
    setBusy(true); setError(''); setResult(null)
    try {
      const a = await loadDoc(target)
      if (mode === 'file') {
        const b = await loadDoc(other)
        const cmp = a.text && b.text ? await api.compare(a.text, b.text) : null
        setResult({ mode, a, b, cmp })
      } else {
        let exact = null
        try { exact = await api.labelByHash(a.contentHash) } catch { exact = null }
        const cands = a.text ? (await api.identify(null, a.text)).candidates || [] : []
        setResult({ mode, a, exact, cands })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2>유사도 테스트</h2>
      <p className="hint">
        테스트 파일을 올리고, 비교 파일을 직접 넣거나 원장에서 유사 파일을 찾아
        <b> ① 파일 전체 해시 · ② MinHash 자카드 유사도 · ③ 의미 유사도(docsim 讀心)</b>를 함께 확인합니다.
        ②③은 본문 텍스트를 서버로 전송합니다(저장하지 않음).
      </p>

      <div className="card">
        <FilePick label="테스트 파일" file={target} onChange={(f) => { setTarget(f); setResult(null) }} />
        <div style={{ display: 'flex', gap: 16, margin: '12px 0', fontSize: 14 }}>
          <label><input type="radio" checked={mode === 'file'} onChange={() => { setMode('file'); setResult(null) }} /> 비교 파일 입력</label>
          <label><input type="radio" checked={mode === 'ledger'} onChange={() => { setMode('ledger'); setResult(null) }} /> 원장에서 유사 파일 검색</label>
        </div>
        {mode === 'file' && <FilePick label="비교 파일" file={other} onChange={(f) => { setOther(f); setResult(null) }} />}
        <div style={{ marginTop: 12 }}>
          <button className="primary" disabled={!ready || busy} onClick={run}>
            {busy ? '계산 중…' : mode === 'file' ? '두 파일 비교' : '원장 검색'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {result?.mode === 'file' && <PairResult r={result} />}
      {result?.mode === 'ledger' && <LedgerResult r={result} />}
    </div>
  )
}

// 파일 읽기: 전체 해시(원본 바이트) + 원장 조회용 본문 해시 + 본문 텍스트.
async function loadDoc(file) {
  const buf = await file.arrayBuffer()
  const fileHash = await sha256Hex(file)
  let contentHash = fileHash
  try { contentHash = (await analyzeFile(file.name, buf)).contentHash || fileHash } catch { /* 형식 미해석 → 전체 해시 */ }
  const text = await extractTextForIdentify(file.name, buf)
  return { name: file.name, size: file.size, fileHash, contentHash, text }
}

function FilePick({ label, file, onChange }) {
  const ref = React.useRef()
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: 'var(--muted)', minWidth: 72 }}>{label}</span>
      <button className="pick" onClick={() => ref.current.click()}>
        {file ? `${file.name} (${fmtSize(file.size)})` : '파일 선택…'}
      </button>
      <input ref={ref} type="file" hidden onChange={(e) => { if (e.target.files[0]) onChange(e.target.files[0]); e.target.value = '' }} />
    </div>
  )
}

// 파일 대 파일: 세 층위를 각각 한 칸씩.
export function PairResult({ r }) {
  const { a, b, cmp } = r
  const same = a.fileHash === b.fileHash
  const noText = !a.text || !b.text
  const mh = cmp?.minhash
  const ds = cmp?.docsim
  return (
    <div className="card">
      <h2>{a.name} ↔ {b.name}</h2>
      <div className="checks">
        <div className={`check ${same ? 'ok' : 'bad'}`}>
          <div className="label">① 파일 전체 해시 (SHA-256)</div>
          <div className="value">{same ? '동일' : '상이'}</div>
        </div>
        <div className={`check ${simClass(mh?.similarity)}`}>
          <div className="label">② MinHash 자카드 유사도</div>
          <div className="value">{noText ? '텍스트 없음' : pct(mh?.similarity)}</div>
        </div>
        <div className={`check ${simClass(ds?.semantic)}`}>
          <div className="label">③ 의미 유사도 (docsim 讀心)</div>
          <div className="value">{noText ? '텍스트 없음' : ds ? pct(ds.semantic) : '—'}</div>
        </div>
      </div>
      <div className="mono">A {a.fileHash}</div>
      <div className="mono">B {b.fileHash}</div>
      {noText && <p className="hint">텍스트를 추출할 수 없는 파일이 있어 ②③은 계산하지 않았습니다 (지원: txt·md·csv·log·docx·pptx·xlsx·hwpx·odt·pdf, 스캔 PDF 제외).</p>}
      {!noText && mh && (
        <p className="hint">② 문자 5-gram 슁글의 MinHash({mh.sigSize}) 시그니처 일치 비율 — 자카드 유사도 추정치.</p>
      )}
      {!noText && cmp && !cmp.docsimConfigured && (
        <p className="hint">③ 서버에 docsim이 구성되지 않아 의미 유사도를 계산하지 못했습니다 (LM_DOCSIM 설정 필요).</p>
      )}
      {!noText && cmp?.docsimError && <p className="error">③ docsim 오류: {cmp.docsimError}</p>}
      {!noText && mh && (
        <>
          <div className="viz-h">② MinHash 자카드 — 해시 배열과 슁글 집합</div>
          <div className="viz-grid">
            <div>
              <SigGrid mh={mh} />
            </div>
            <div>
              {cmp.shingles && <ShingleVenn sh={cmp.shingles} />}
              <p className="hint" style={{ margin: 0 }}>
                MinHash 추정 {pct(mh.similarity)} vs 정확 자카드 {pct(cmp.shingles?.jaccard)} —
                128칸 표본으로 집합 전체를 추정하는 방식이므로 오차가 있습니다.
              </p>
            </div>
          </div>
        </>
      )}
      {ds && (
        <>
          <div className="viz-h">③ 의미 유사도 docsim 讀心 — 청크 연결과 포함률 <span className="hint" style={{ fontWeight: 400 }}>· 문서의 뜻(心)을 읽어(讀) 표현이 달라도 같은 내용을 찾습니다</span></div>
          <Meter value={ds.semantic} label="의미 코사인(최대)" ticks={[0.5, 0.8]} />
          <Meter value={ds.shingle} label="문자 자카드(docsim)" ticks={[0.3, 0.7]} />
          <div className="viz-grid">
            <div>
              <ChunkLinks deep={ds} />
              <p className="hint" style={{ margin: 0 }}>본문을 의미 청크로 나눠 임베딩한 뒤 가장 가까운 청크쌍을 잇습니다. 선이 굵고 진할수록 의미가 가깝습니다.</p>
            </div>
            <div>
              <ContainBars deep={ds} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>
                판정 <b>{ds.label || ds.relation}</b>{ds.confidence ? <span className="hint"> (신뢰도 {ds.confidence})</span> : null}
              </p>
              {ds.summary && <p className="hint" style={{ margin: '4px 0 0' }}>{ds.summary}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 원장 검색: ①은 해시 정확 일치 조회, ②③은 identify 후보 표.
export function LedgerResult({ r }) {
  const { a, exact, cands } = r
  return (
    <div className="card">
      <h2>{a.name} — 원장 검색</h2>
      <div className="checks">
        <div className={`check ${exact ? 'ok' : 'warn'}`}>
          <div className="label">① 파일 전체 해시 정확 일치</div>
          <div className="value">{exact ? `등록됨 · ${exact.grade || '?'}등급` : '원장에 없음'}</div>
        </div>
        <div className={`check ${simClass(cands[0]?.similarity)}`}>
          <div className="label">② 최고 MinHash 유사도</div>
          <div className="value">{!a.text ? '텍스트 없음' : cands.length ? pct(cands[0].similarity) : '후보 없음'}</div>
        </div>
        <div className={`check ${simClass(maxSemantic(cands))}`}>
          <div className="label">③ 최고 의미 유사도</div>
          <div className="value">{!a.text ? '텍스트 없음' : maxSemantic(cands) != null ? pct(maxSemantic(cands)) : '—'}</div>
        </div>
      </div>
      <div className="mono">SHA-256 {a.fileHash}</div>
      {a.contentHash !== a.fileHash && <div className="mono">원장 조회 해시(라벨 제외) {a.contentHash}</div>}
      {exact && (
        <p className="hint">① 정확 일치 문서 <code>{exact.docGuid}</code> · {orgLabel(exact.issuerOrg)}{exact.revoked ? ' · 폐기됨' : ''}</p>
      )}
      {!a.text && <p className="hint">텍스트를 추출할 수 없어 ②③ 유사 검색은 하지 않았습니다.</p>}
      {a.text && cands.length === 0 && <p className="hint">유사한 등록 문서를 찾지 못했습니다 (MinHash 유사도 0.3 미만).</p>}
      {cands.length > 0 && (
        <div className="tablewrap">
          <div className="viz-h">후보 분포 — ② MinHash × ③ 의미</div>
          <CandidateMap cands={cands} selfHash={a.contentHash} />
          <p className="hint">오른쪽 위일수록 원본·수정본, 왼쪽 위는 문장을 고쳐 쓴 재작성본, 아래는 무관합니다.</p>
          <table className="ledger">
            <thead><tr><th>② MinHash</th><th>③ 의미</th><th>문자(자카드)</th><th>판정</th><th>유사 문서(파일명)</th><th>등급</th><th>발급기관</th><th>docGuid</th></tr></thead>
            <tbody>
              {cands.map((c, i) => (
                <tr key={i} className={c.revoked ? 'revoked' : ''}>
                  <td><MiniBar value={c.similarity} /></td>
                  <td>{c.deep ? <MiniBar value={c.deep.semantic} /> : <span className="hint">의미지문 없음</span>}</td>
                  <td>{c.deep ? c.deep.shingle?.toFixed(2) : '-'}</td>
                  <td>{c.deep ? (c.deep.label || c.deep.relation) : '-'}</td>
                  <td title={c.filename}>{c.contentHash === a.contentHash ? '(이 파일 자신) ' : ''}{c.filename || '(파일명 없음)'}</td>
                  <td>{c.grade || '-'}</td>
                  <td>{orgLabel(c.issuerOrg)}</td>
                  <td className="mono" title={c.docGuid}>{c.docGuid.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">③ 의미 유사도는 발급 시 '의미 검색'을 켜 docsim 지문을 저장한 문서에만 나옵니다.</p>
        </div>
      )}
    </div>
  )
}

function maxSemantic(cands) {
  const vals = cands.filter((c) => c.deep && typeof c.deep.semantic === 'number').map((c) => c.deep.semantic)
  return vals.length ? Math.max(...vals) : null
}

function simClass(v) {
  if (typeof v !== 'number') return ''
  return v >= 0.7 ? 'ok' : v >= 0.3 ? 'warn' : 'bad'
}
function fmtSize(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB` }
