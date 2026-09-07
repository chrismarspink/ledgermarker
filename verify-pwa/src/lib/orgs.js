// 기관 식별자(issuerOrgId) → 한글 표기.
// 실운영에서는 신뢰목록·협정 데이터에 표시명을 싣는 것이 맞다(Phase 2).
// Phase 1 데모는 화면 표기용 매핑으로 처리한다.
export const ORG_NAMES = {
  KPOST: '우정사업본부',
  MSIT: '과학기술정보통신부',
  MOIS: '행정안전부',
  NTS: '국세청',
  DEVORG: '개발용 기관',
  TESTORG: '테스트 기관'
}

// "행정안전부 (MOIS)" 형태. 매핑이 없으면 ID 그대로.
export function orgLabel(id) {
  if (!id) return ''
  const name = ORG_NAMES[id.toUpperCase()]
  return name ? `${name} (${id})` : id
}
