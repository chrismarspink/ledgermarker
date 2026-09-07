// 라벨 트레일러 내장 (Phase 1.5 — 포맷 불문 공통 방식)
//
// 형식:  [원본 바이트][CMS DER][DER 길이 uint64 BE 8바이트][매직 "LMLABEL1" 8바이트]
//
// - contentHash(서명 대상)는 항상 **원본 바이트** 기준이다. 검증자는
//   트레일러를 떼어낸 앞부분을 해시한다.
// - PDF·JPEG 등 꼬리 데이터를 무시하는 포맷에서 안전하다. ZIP 기반
//   (docx/hwpx)은 일부 엄격한 리더가 경고할 수 있다 — 규격은
//   docs/label-profile.md 부록 참조. 포맷별 정식 내장은 Phase 2.

export const MAGIC = 'LMLABEL1'
const MAGIC_BYTES = new TextEncoder().encode(MAGIC)

// extractEmbedded(ArrayBuffer) → { original: Uint8Array, der: Uint8Array } | null
export function extractEmbedded(buf) {
  const bytes = new Uint8Array(buf)
  const n = bytes.length
  if (n < 16 + 4) return null
  for (let i = 0; i < 8; i++) {
    if (bytes[n - 8 + i] !== MAGIC_BYTES[i]) return null
  }
  const dv = new DataView(buf, n - 16, 8)
  const derLen = dv.getUint32(0) * 2 ** 32 + dv.getUint32(4)
  if (derLen === 0 || derLen > n - 16) return null
  return {
    original: bytes.slice(0, n - 16 - derLen),
    der: bytes.slice(n - 16 - derLen, n - 16)
  }
}

// embedLabel(Uint8Array 원본, Uint8Array DER) → Blob (라벨 내장 파일)
export function embedLabel(originalBytes, derBytes) {
  const trailer = new Uint8Array(16)
  const dv = new DataView(trailer.buffer)
  dv.setUint32(0, Math.floor(derBytes.length / 2 ** 32))
  dv.setUint32(4, derBytes.length >>> 0)
  trailer.set(MAGIC_BYTES, 8)
  return new Blob([originalBytes, derBytes, trailer], { type: 'application/octet-stream' })
}
