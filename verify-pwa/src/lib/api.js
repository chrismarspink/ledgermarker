// LM Server API 래퍼. 오프라인이면 네트워크 오류를 그대로 던진다 —
// 호출부는 이를 "unavailable"(판단 보류)로 처리해야 하며,
// 절대 "검증 실패"로 표시하지 않는다 (DEV SPEC §8.1-4).
const BASE = import.meta.env.VITE_LM_SERVER || ''
// 정적 데모 모드(GitHub Pages): 서버 없이 조회만 된다. GET 은 빌드에 담긴
// 스냅샷(public/v1/**.json — scripts/snapshot-static-api.sh 가 데모 서버에서 떠 온
// 원장·키·협정)을 읽고, 발급·검증·유사도 같은 쓰기·계산 요청은 안내 오류를 던진다.
export const STATIC_DEMO = !BASE && import.meta.env.VITE_LM_STATIC === '1'
const STATIC_ROOT = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')

function staticPath(path) {
  // 쿼리(limit·필터)는 무시하고 전체 스냅샷을 준다 — /v1/checkpoints 와
  // /v1/checkpoints/latest 가 공존하도록 파일은 <경로>.json 이다.
  return STATIC_ROOT + path.split('?')[0] + '.json'
}

async function req(method, path, body, apiKey, idemKey) {
  if (STATIC_DEMO) {
    if (method !== 'GET') {
      throw new Error('정적 데모(GitHub Pages)에서는 조회만 됩니다 — 발급·검증·유사도 테스트는 lmserver 를 띄워야 합니다')
    }
    const resp = await fetch(staticPath(path))
    if (!resp.ok) throw new Error(resp.status === 404 ? '정적 데모 스냅샷에 없는 항목입니다' : `HTTP ${resp.status}`)
    return resp.json()
  }
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (apiKey) headers['X-LM-Key'] = apiKey
  if (idemKey) headers['Idempotency-Key'] = idemKey
  const resp = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

export const api = {
  // 지문 유사도 재식별 — text가 있으면 서버가 docsim 정밀 판정을 채운다.
  identify: (minhash, text) =>
    req('POST', '/v1/identify', { minhash, text: text || undefined, limit: 5 }),
  // 두 본문 텍스트의 유사도 — MinHash 자카드(서버 fingerprint) + docsim 의미(구성 시).
  compare: (textA, textB) => req('POST', '/v1/compare', { textA, textB }),
  // 지문 색인 갱신 — 파일의 해시·본문 텍스트로 원장의 색인을 교체(서버가 지문 계산).
  reindex: (contentHash, text, apiKey) =>
    req('POST', '/v1/reindex', { contentHash, text }, apiKey),
  verify: (payload) => req('POST', '/v1/verify', payload),
  issue: (payload, apiKey, idemKey) => req('POST', '/v1/labels', payload, apiKey, idemKey),
  revoke: (docGuid, reason, apiKey) =>
    req('POST', `/v1/labels/${docGuid}/revoke`, { reason }, apiKey),
  regrade: (docGuid, grade, approvalToken, reason, apiKey) =>
    req('POST', `/v1/labels/${docGuid}/regrade`, { grade, approvalToken, reason }, apiKey),
  destroy: (docGuid, reason, approvalToken, apiKey) =>
    req('POST', `/v1/labels/${docGuid}/destroy`, { reason, approvalToken }, apiKey),
  lineage: (docGuid, depth = 10, direction = 'both') =>
    req('GET', `/v1/documents/${docGuid}/lineage?depth=${depth}&direction=${direction}`),
  trustList: () => req('GET', '/v1/trust/list'),
  latestCheckpoint: () => req('GET', '/v1/checkpoints/latest'),
  keys: () => req('GET', '/v1/keys'),
  treaties: () => req('GET', '/v1/treaties'),
  formats: () => req('GET', '/v1/formats'),
  labelByHash: (hashHex) => req('GET', `/v1/labels/by-hash/${hashHex}`),
  labelByTextHash: (hashHex) => req('GET', `/v1/labels/by-hash/${hashHex}?kind=text`),
  // 정체성 복원(재수화): 해시→텍스트해시→지문 사다리를 한 번에. apply=true면
  // 유사 수정본에 원본 귀속을 상속한 새 라벨을 발급(발급이므로 API 키 필요).
  restore: (payload, apiKey) => req('POST', '/v1/restore', payload, apiKey),
  // 파일을 업로드하지 않는다 — 파일명과 앞 16바이트 매직넘버만 (§3.2)
  formatsResolve: (filename, magicHex) =>
    req('POST', '/v1/formats/resolve', { filename, magicHex }),
  adminStats: (apiKey) => req('GET', '/v1/admin/stats', null, apiKey),
  ledgerEvents: (apiKey, limit = 50) =>
    req('GET', `/v1/ledger/events?limit=${limit}`, null, apiKey),
  // 봉인(체크포인트) 목록 — 원장 시각화의 봉인 구간
  checkpoints: (limit = 100) => req('GET', `/v1/checkpoints?limit=${limit}`),
  // 게이트 관측 로그 — 기관 간 보냄·수신·검증 기록(원장과 분리된 추가 전용 로그)
  observations: (params = {}, apiKey) => {
    const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return req('GET', `/v1/observations${q ? '?' + q : ''}`, null, apiKey)
  },
  observe: (payload, apiKey) => req('POST', '/v1/observations', payload, apiKey),
  // 샘플 파일 일괄 발급(기능 테스트) — 서버의 LM_SAMPLE_DIR/manifest.json 실행
  loadSamples: (apiKey) => req('POST', '/v1/admin/load-samples', {}, apiKey)
}

// 현재 기관 페르소나 — 모델 A(단일 서버 다중 기관). 발급 시 기본 발급기관,
// 검증 시 verifierOrg(협정 번역 기준)가 된다. 저장은 브라우저 로컬.
export function currentOrg() {
  return localStorage.getItem('lm-org') || ''
}
export function setCurrentOrg(id) {
  if (id) localStorage.setItem('lm-org', id)
  else localStorage.removeItem('lm-org')
  window.dispatchEvent(new Event('lm-org-changed'))
}

// 신뢰목록은 Service Worker 캐시 + localStorage 이중 보관 —
// SW 미등록 첫 방문 오프라인까지 대비한다.
export async function getTrustListCached() {
  try {
    const t = await api.trustList()
    localStorage.setItem('lm-trust', JSON.stringify(t))
    return t
  } catch {
    const saved = localStorage.getItem('lm-trust')
    return saved ? JSON.parse(saved) : null
  }
}
