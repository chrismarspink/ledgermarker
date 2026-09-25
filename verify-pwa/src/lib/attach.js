// 부착 방식(Attacher) — Go internal/attach 의 JS 미러.
// 포맷 목록은 절대 하드코딩하지 않는다: /v1/formats(단일 진실 원천)를
// 캐시해 사용한다 (작업지시서 §0·§6-1).
//
// 정규화 규칙은 Go NormalizeText(internal/attach/normalize.go)와 동일해야
// 한다 — 규칙 변경 시 양쪽을 함께 고칠 것.
import { api } from './api.js'
import { extractEmbedded, embedLabel } from './embed.js'
import { sha256HexBytes } from './hash.js'

let catalogCache = null

// 포맷 카탈로그 (Service Worker + localStorage 이중 캐시 — 오프라인 대비)
export async function getFormatsCached() {
  if (catalogCache) return catalogCache
  try {
    const c = await api.formats()
    localStorage.setItem('lm-formats', JSON.stringify(c))
    catalogCache = c
    return c
  } catch {
    const saved = localStorage.getItem('lm-formats')
    catalogCache = saved ? JSON.parse(saved) : null
    return catalogCache
  }
}

// 확장자·매직으로 포맷 판정 (Go Catalog.Lookup 미러)
export async function resolveLocal(filename, headBytes) {
  const cat = await getFormatsCached()
  if (!cat) return { id: 'unknown', name: '미등재 형식', method: 'sidecar', survivability: 'B', normalize: false }
  const lower = filename.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  let found = cat.formats.find((f) => (f.extensions || []).includes(ext))
  if (!found && headBytes) {
    const headHex = [...headBytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    found = cat.formats.find((f) => f.magic && headHex.startsWith(f.magic.toUpperCase()))
  }
  if (!found) return { id: 'unknown', name: '미등재 형식', method: 'sidecar', survivability: 'B', normalize: false }
  return found
}

// ── 정규화 (Go NormalizeText 미러 — 골든 테스트 규칙) ─────────
// UTF-8 → BOM 제거 → CRLF를 LF로 → NFC → 파일 끝 개행 1개, 후행 공백 유지
export function normalizeText(str) {
  let s = str
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.normalize('NFC')
  s = s.replace(/\n+$/, '') + '\n'
  return s
}

// ── 마크다운 front matter (Go textAttacher 미러) ──────────────
// 선두 front matter에서 lm_* 줄 제거 → {body, labelB64}
export function stripLM(str) {
  const s = str.replace(/\r\n/g, '\n')
  if (!s.startsWith('---\n')) return { body: str, labelB64: '' }
  const rest = s.slice(4)
  const end = rest.indexOf('\n---')
  if (end < 0) return { body: str, labelB64: '' }
  const fm = rest.slice(0, end)
  let after = rest.slice(end + 4)
  if (after.startsWith('\n')) after = after.slice(1)
  let labelB64 = ''
  const kept = []
  for (const line of fm.split('\n')) {
    const t = line.trim()
    if (t.startsWith('lm_')) {
      if (t.startsWith('lm_label:')) labelB64 = t.slice('lm_label:'.length).trim()
      continue
    }
    kept.push(line)
  }
  if (kept.length === 0 || (kept.length === 1 && kept[0].trim() === '')) {
    return { body: after, labelB64 }
  }
  return { body: '---\n' + kept.join('\n') + '\n---\n' + after, labelB64 }
}

export function mdAttach(str, labelB64) {
  const s = str.replace(/\r\n/g, '\n')
  if (s.startsWith('---\n')) {
    return '---\nlm_label: ' + labelB64 + '\n' + s.slice(4)
  }
  return '---\nlm_label: ' + labelB64 + '\n---\n' + s
}

// ── ZIP 아카이브 코멘트 내장 (Go zipAttacher 미러) ─────────────
// OOXML·HWPX·ODF·ZIP: EOCD 코멘트에 "LMLABEL1:<base64>" — 리더가 무시.
const ZIP_PREFIX = 'LMLABEL1:'

function findEOCD(bytes) {
  const n = bytes.length
  const min = Math.max(0, n - 22 - 65535)
  for (let i = n - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      const cl = bytes[i + 20] | (bytes[i + 21] << 8)
      if (i + 22 + cl === n) return { off: i, commentLen: cl }
    }
  }
  return null
}

export function splitZipComment(buf) {
  const bytes = new Uint8Array(buf)
  const e = findEOCD(bytes)
  if (!e || e.commentLen === 0) return null
  const comment = new TextDecoder().decode(bytes.slice(e.off + 22))
  if (!comment.startsWith(ZIP_PREFIX)) return null
  let der
  try {
    der = Uint8Array.from(atob(comment.slice(ZIP_PREFIX.length)), (c) => c.charCodeAt(0))
  } catch { return null }
  const original = bytes.slice(0, e.off + 22)
  original[e.off + 20] = 0
  original[e.off + 21] = 0
  return { original, der }
}

export function zipAttach(bytes, derBytes) {
  const e = findEOCD(bytes)
  if (!e) throw new Error('ZIP 구조를 찾을 수 없습니다 (손상되었거나 ZIP이 아님)')
  if (e.commentLen > 0) throw new Error('이 파일의 ZIP 코멘트가 이미 사용 중입니다 — 사이드카를 사용하세요')
  const c = new TextEncoder().encode(ZIP_PREFIX + btoa(String.fromCharCode(...derBytes)))
  const out = new Uint8Array(e.off + 22 + c.length)
  out.set(bytes.slice(0, e.off + 22))
  out[e.off + 20] = c.length & 0xff
  out[e.off + 21] = (c.length >> 8) & 0xff
  out.set(c, e.off + 22)
  return out
}

// hashBody 는 라벨 제외 본문 바이트의 해시 대상 값(hex)이다
// (normalize 형식은 정규화 후 해시 — Go HashTarget 미러).
export async function hashBody(format, bodyBytes) {
  if (format.normalize) {
    const t = new TextEncoder().encode(normalizeText(new TextDecoder().decode(bodyBytes)))
    return sha256HexBytes(t)
  }
  return sha256HexBytes(bodyBytes)
}

// textHashOf 는 텍스트 해시 2차 식별자(hex)다 — Go fingerprint.TextHash 미러:
// NFC → 소문자 → 공백 전부 제거 → SHA-256. 편집기 재저장으로 바이트·공백
// 분절이 바뀌어도 유지된다. (웹은 텍스트 계열 형식만 — ZIP XML 추출은 CLI)
async function textHashOf(bodyText) {
  const stripped = bodyText.normalize('NFC').toLowerCase().replace(/\s+/g, '')
  if (!stripped) return ''
  return sha256HexBytes(new TextEncoder().encode(stripped))
}

function isTextFormat(format) {
  return format.id === 'markdown' || format.id === 'plaintext'
}

// ── 통합 처리: 파일 → {contentHash, bodyBytes, labelDerBytes|null, labelSource, format}
export async function analyzeFile(fileName, buf) {
  const bytes = new Uint8Array(buf)
  const format = await resolveLocal(fileName, bytes)

  // 1) 마크다운: front matter 내장 + 정규화 해시
  // (구버전 트레일러 내장 파일 호환: 트레일러를 먼저 뗀다 — Go와 동일)
  if (format.id === 'markdown') {
    const legacy = extractEmbedded(buf)
    if (legacy) {
      const contentHash = await hashBody(format, legacy.original)
      return { contentHash, bodyBytes: legacy.original, labelDerBytes: legacy.der, labelSource: '파일 안에 (꼬리표)', format }
    }
    const text = new TextDecoder().decode(bytes)
    const { body, labelB64 } = stripLM(text)
    const bodyBytes = new TextEncoder().encode(body)
    const contentHash = await hashBody(format, bodyBytes)
    const textHash = await textHashOf(body)
    const labelDerBytes = labelB64
      ? Uint8Array.from(atob(labelB64), (c) => c.charCodeAt(0))
      : null
    return { contentHash, textHash, bodyBytes, labelDerBytes, labelSource: labelDerBytes ? '파일 안에 (본문 머리)' : '없음', format }
  }

  // 2) ZIP 아카이브 코멘트 내장 (OOXML·HWPX·ODF·ZIP)
  const zc = splitZipComment(buf)
  if (zc) {
    const contentHash = await hashBody(format, zc.original)
    return { contentHash, bodyBytes: zc.original, labelDerBytes: zc.der, labelSource: '파일 안에 (ZIP 코멘트)', format }
  }

  // 3) 트레일러 내장 (pdf·이미지·HWP 등 + 구버전 호환: 전 포맷 인식)
  const emb = extractEmbedded(buf)
  if (emb) {
    const contentHash = await hashBody(format, emb.original)
    const textHash = isTextFormat(format) ? await textHashOf(new TextDecoder().decode(emb.original)) : ''
    return { contentHash, textHash, bodyBytes: emb.original, labelDerBytes: emb.der, labelSource: '파일 안에 (꼬리표)', format }
  }

  // 3) 라벨 없음 — 원본 그대로 해시
  const contentHash = await hashBody(format, bytes)
  const textHash = isTextFormat(format) ? await textHashOf(new TextDecoder().decode(bytes)) : ''
  return { contentHash, textHash, bodyBytes: bytes, labelDerBytes: null, labelSource: '없음', format }
}

// 재식별용 본문 텍스트 추출 (브라우저). txt·md·csv·log는 그대로,
// docx·pptx·xlsx·hwpx·odt는 ZIP 내 XML에서 태그 제거. 서버가 최종 지문을
// 계산하므로 완벽 일치는 불필요(대략적 텍스트면 유사도 후보에 충분).
// 추출 불가면 null (PDF 등은 CLI lm identify 사용).
export async function extractTextForIdentify(fileName, buf) {
  const name = fileName.toLowerCase()
  const ext = name.slice(name.lastIndexOf('.'))
  if (['.txt', '.md', '.markdown', '.csv', '.log'].includes(ext)) {
    const bytes = new Uint8Array(buf)
    const emb = extractEmbedded(buf)
    const text = new TextDecoder().decode(emb ? emb.original : bytes)
    return stripLM(text).body ?? text
  }
  if (['.docx', '.pptx', '.xlsx', '.hwpx', '.odt', '.ods', '.odp'].includes(ext)) {
    return extractZipXmlText(new Uint8Array(buf))
  }
  if (ext === '.pdf') {
    return extractPdfText(buf)
  }
  return null
}

// PDF 텍스트 레이어 추출 (pdf.js). 스캔 PDF(텍스트 없음)는 null.
async function extractPdfText(buf) {
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise
    let out = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      out += tc.items.map((it) => it.str).join(' ') + ' '
    }
    return out.trim() || null
  } catch {
    return null
  }
}

// 최소 ZIP 파서 — deflate 해제를 위해 DecompressionStream(브라우저 내장) 사용.
async function extractZipXmlText(bytes) {
  try {
    const entries = parseZipEntries(bytes)
    let out = ''
    for (const e of entries) {
      const n = e.name.toLowerCase()
      if (!n.endsWith('.xml')) continue
      if (!(n.startsWith('word/') || n.startsWith('ppt/slides/') || n.startsWith('xl/') ||
        n === 'content.xml' || n.startsWith('contents/'))) continue
      let data = e.data
      if (e.method === 8) {
        const ds = new DecompressionStream('deflate-raw')
        const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer()
        data = new Uint8Array(buf)
      }
      const xml = new TextDecoder().decode(data).replace(/></g, '> <')
      out += xml.replace(/<[^>]*>/g, '') + ' '
    }
    return out.trim() || null
  } catch {
    return null
  }
}

// ZIP local file header들을 훑어 (name, method, data) 목록을 만든다.
function parseZipEntries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = []
  let i = 0
  while (i + 4 <= bytes.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true)
    const compSize = dv.getUint32(i + 18, true)
    const nameLen = dv.getUint16(i + 26, true)
    const extraLen = dv.getUint16(i + 28, true)
    const nameStart = i + 30
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLen))
    const dataStart = nameStart + nameLen + extraLen
    if (compSize === 0 && (dv.getUint16(i + 6, true) & 0x08)) break // data descriptor — 생략
    out.push({ name, method, data: bytes.slice(dataStart, dataStart + compSize) })
    i = dataStart + compSize
  }
  return out
}

// 내장 라벨 파일 생성 (생성 화면용). 지원하지 않으면 null.
export function buildEmbedded(format, fileName, buf, derBytes) {
  if (format.id === 'markdown') {
    const text = new TextDecoder().decode(new Uint8Array(buf))
    const b64 = btoa(String.fromCharCode(...derBytes))
    return new Blob([mdAttach(text, b64)], { type: 'text/markdown' })
  }
  if (format.method === 'container' && format.status === 'supported') {
    // ZIP 아카이브 코멘트 (실패 시 호출자에서 사이드카 폴백)
    return new Blob([zipAttach(new Uint8Array(buf), derBytes)], { type: 'application/octet-stream' })
  }
  if (format.method === 'embedded' && format.status === 'supported') {
    return embedLabel(new Uint8Array(buf), derBytes) // 트레일러
  }
  return null
}
