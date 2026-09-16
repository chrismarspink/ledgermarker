// 기관 식별자(issuerOrgId) → 한글 표기.
// 실운영에서는 신뢰목록·협정 데이터에 표시명을 싣는 것이 맞다(Phase 2).
// Phase 1 데모는 화면 표기용 매핑으로 처리한다.
import kpostLogo from '../assets/logo-kpost.svg'
import innotiumLogo from '../assets/logo-innotium.svg'
import genericLogo from '../assets/logo-generic.svg'

export const ORG_NAMES = {
  KPOST: '우정사업본부',
  INNOTIUM: '이노티움',
  MSIT: '과학기술정보통신부',
  MOIS: '행정안전부',
  NTS: '국세청',
  DEVORG: '개발용 기관',
  TESTORG: '테스트 기관'
}

// 기관별 로고 — 데모 표기용 대표 엠블럼(공식 상표 복제 아님).
export const ORG_LOGOS = {
  KPOST: kpostLogo,
  INNOTIUM: innotiumLogo
}

export function orgLogo(id) {
  if (!id) return genericLogo
  return ORG_LOGOS[id.toUpperCase()] || genericLogo
}

// "행정안전부 (MOIS)" 형태. 매핑이 없으면 ID 그대로.
export function orgLabel(id) {
  if (!id) return ''
  const name = ORG_NAMES[id.toUpperCase()]
  return name ? `${name} (${id})` : id
}
