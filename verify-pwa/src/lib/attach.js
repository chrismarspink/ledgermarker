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

// hashBody 는 라벨 제외 본문 바이트의 해시 대상 값(hex)이다
// (normalize 형식은 정규화 후 해시 — Go HashTarget 미러).
export async function hashBody(format, bodyBytes) {
  if (format.normalize) {
    const t = new TextEncoder().encode(normalizeText(new TextDecoder().decode(bodyBytes)))
    return sha256HexBytes(t)
  }
  return sha256HexBytes(bodyBytes)
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
    const labelDerBytes = labelB64
      ? Uint8Array.from(atob(labelB64), (c) => c.charCodeAt(0))
      : null
    return { contentHash, bodyBytes, labelDerBytes, labelSource: labelDerBytes ? '파일 안에 (본문 머리)' : '없음', format }
  }

  // 2) 트레일러 내장 (pdf·이미지 등 + 구버전 호환: 전 포맷 인식)
  const emb = extractEmbedded(buf)
  if (emb) {
    const contentHash = await hashBody(format, emb.original)
    return { contentHash, bodyBytes: emb.original, labelDerBytes: emb.der, labelSource: '파일 안에 (꼬리표)', format }
  }

  // 3) 라벨 없음 — 원본 그대로 해시
  const contentHash = await hashBody(format, bytes)
  return { contentHash, bodyBytes: bytes, labelDerBytes: null, labelSource: '없음', format }
}

// 내장 라벨 파일 생성 (생성 화면용). 지원하지 않으면 null.
export function buildEmbedded(format, fileName, buf, derBytes) {
  if (format.id === 'markdown') {
    const text = new TextDecoder().decode(new Uint8Array(buf))
    const b64 = btoa(String.fromCharCode(...derBytes))
    return new Blob([mdAttach(text, b64)], { type: 'text/markdown' })
  }
  if (format.method === 'embedded' && format.status === 'supported') {
    return embedLabel(new Uint8Array(buf), derBytes) // 트레일러
  }
  return null
}
