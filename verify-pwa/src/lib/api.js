// LM Server API 래퍼. 오프라인이면 네트워크 오류를 그대로 던진다 —
// 호출부는 이를 "unavailable"(판단 보류)로 처리해야 하며,
// 절대 "검증 실패"로 표시하지 않는다 (DEV SPEC §8.1-4).
const BASE = import.meta.env.VITE_LM_SERVER || ''

async function req(method, path, body, apiKey, idemKey) {
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
  verify: (payload) => req('POST', '/v1/verify', payload),
  issue: (payload, apiKey, idemKey) => req('POST', '/v1/labels', payload, apiKey, idemKey),
  lineage: (docGuid, depth = 10, direction = 'both') =>
    req('GET', `/v1/documents/${docGuid}/lineage?depth=${depth}&direction=${direction}`),
  trustList: () => req('GET', '/v1/trust/list'),
  latestCheckpoint: () => req('GET', '/v1/checkpoints/latest'),
  keys: () => req('GET', '/v1/keys'),
  treaties: () => req('GET', '/v1/treaties'),
  adminStats: (apiKey) => req('GET', '/v1/admin/stats', null, apiKey),
  ledgerEvents: (apiKey, limit = 50) =>
    req('GET', `/v1/ledger/events?limit=${limit}`, null, apiKey)
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
