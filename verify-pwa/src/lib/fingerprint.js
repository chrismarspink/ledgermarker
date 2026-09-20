// 내용 유사도 지문 — Go internal/fingerprint 의 바이트 단위 미러.
// 발급 시 브라우저가 지문을 계산해 base64로 제출하면(본문 미전송),
// 서버가 identify 질의 시 텍스트로 계산하는 지문과 정확히 일치해 유사도가
// 성립한다. 알고리즘: NFC→소문자→공백 전부 제거 → 문자 5-gram FNV-1a
// 슁글 → MinHash(128, splitmix64 mix) → uint64×128 big-endian → base64.
//
// 이 파일을 바꾸면 Go 쪽과 어긋나 유사도가 깨진다 — 두 구현은 함께 바뀌어야 한다.

const MASK = (1n << 64n) - 1n
const SIG_SIZE = 128
const SHINGLE_K = 5
const SEED_BASE = 0x4c4d5f4650n // "LM_FP"
const GOLDEN = 0x9e3779b97f4a7c15n

// isSpace: Unicode White_Space (Go unicode.IsSpace 와 동일 집합).
function isSpace(cp) {
  return (cp >= 0x09 && cp <= 0x0d) || cp === 0x20 || cp === 0x85 || cp === 0xa0 ||
    cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 ||
    cp === 0x202f || cp === 0x205f || cp === 0x3000
}

// NormalizeForFP: NFC → 소문자 → 공백 전부 제거.
function normalize(text) {
  const s = text.normalize('NFC').toLowerCase()
  let out = ''
  for (const ch of s) {
    if (!isSpace(ch.codePointAt(0))) out += ch
  }
  return out
}

// FNV-1a 64bit — Go hash/fnv New64a 미러.
function fnv1a64(bytes) {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i])
    h = (h * 0x100000001b3n) & MASK
  }
  return h
}

// splitmix64 finalizer — Go mix() 미러.
function mix(x) {
  x = (x + GOLDEN) & MASK
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & MASK
  return (x ^ (x >> 31n)) & MASK
}

// Shingles: 정규화 텍스트의 문자 5-gram FNV 해시 집합.
function shingles(text) {
  const runes = Array.from(text)
  const enc = new TextEncoder()
  const set = new Set()
  if (runes.length < SHINGLE_K) {
    if (runes.length > 0) set.add(fnv1a64(enc.encode(runes.join(''))))
    return set
  }
  for (let i = 0; i + SHINGLE_K <= runes.length; i++) {
    set.add(fnv1a64(enc.encode(runes.slice(i, i + SHINGLE_K).join(''))))
  }
  return set
}

// MinHash(128) — Go MinHash 미러.
function minhash(shSet) {
  const sig = new Array(SIG_SIZE).fill(MASK)
  // 시드 상수 미리 계산: seed_i = (SEED_BASE + i*GOLDEN) mod 2^64
  const seeds = new Array(SIG_SIZE)
  for (let i = 0; i < SIG_SIZE; i++) {
    seeds[i] = (SEED_BASE + (BigInt(i) * GOLDEN)) & MASK
  }
  for (const sh of shSet) {
    for (let i = 0; i < SIG_SIZE; i++) {
      const h = mix((sh ^ seeds[i]) & MASK)
      if (h < sig[i]) sig[i] = h
    }
  }
  return sig
}

// Encode: uint64×128 big-endian → base64 (Go Encode 미러).
function encodeB64(sig) {
  const bytes = new Uint8Array(SIG_SIZE * 8)
  const dv = new DataView(bytes.buffer)
  for (let i = 0; i < sig.length; i++) dv.setBigUint64(i * 8, sig[i], false)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

// minhashB64: 텍스트 → base64 MinHash 지문 (발급 시 fingerprint.minhash 로 제출).
export function minhashB64(text) {
  return encodeB64(minhash(shingles(normalize(text))))
}
