// LedgerMarker 공모 제출 발표자료 생성 (pptxgenjs)
const pptxgen = require('pptxgenjs')
const fs = require('fs')

const C = { navy: '1A2B4A', ok: '1E7D46', warn: 'B07A00', bad: 'B02A2A', ink: '111827', muted: '6B7280',
  line: 'E5E7EB', light: 'EEF1F6', white: 'FFFFFF', bg: 'F7F8FA', okSoft: 'E6F4EC', warnSoft: 'FFF4DC', badSoft: 'FDECEC', navySoft: 'DDE3EE' }
// 제출본은 Apple SD Gothic Neo(macOS 기본 한글, PowerPoint에서 자동 대체 가능). 검수 렌더링용 폰트는 DECK_FONT 로 바꾼다.
const F = process.env.DECK_FONT || 'Apple SD Gothic Neo'
const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5
pres.author = 'LedgerMarker'
pres.title = 'innoAI Persistent Tagging PoC 공모 제안 — LedgerMarker'

let page = 0
function base(opts = {}) {
  const s = pres.addSlide()
  page++
  s.background = { color: opts.dark ? C.navy : C.white }
  if (!opts.noFooter) {
    s.addText(`LedgerMarker · innoAI Persistent Tagging PoC 공모 제안`, { x: 0.6, y: 7.05, w: 8, h: 0.3, fontFace: F, fontSize: 9, color: opts.dark ? 'C3CAD6' : C.muted, isTextBox: true, margin: 0 })
    s.addText(String(page), { x: 12.2, y: 7.05, w: 0.55, h: 0.3, fontFace: F, fontSize: 9, color: opts.dark ? 'C3CAD6' : C.muted, align: 'right', isTextBox: true, margin: 0 })
  }
  return s
}
function title(s, t, sub) {
  s.addText(t, { x: 0.6, y: 0.35, w: 12.1, h: 0.7, fontFace: F, fontSize: 26, bold: true, color: C.navy, isTextBox: true, margin: 0 })
  if (sub) s.addText(sub, { x: 0.6, y: 1.02, w: 12.1, h: 0.4, fontFace: F, fontSize: 12.5, color: C.muted, isTextBox: true, margin: 0 })
}
function bullets(items, size = 13, color = C.ink) {
  return items.map((t, i) => (typeof t === 'string'
    ? { text: t, options: { bullet: true, breakLine: i < items.length - 1, fontSize: size, color, paraSpaceAfter: 6 } }
    : { text: t.text, options: { bullet: t.bullet !== false, bold: !!t.bold, breakLine: i < items.length - 1, fontSize: t.size || size, color: t.color || color, paraSpaceAfter: 6, indentLevel: t.indent || 0 } }))
}
function textBox(s, x, y, w, h, items, size) {
  s.addText(bullets(items, size), { x, y, w, h, fontFace: F, valign: 'top', isTextBox: true, margin: 0.04 })
}
function card(s, x, y, w, h, head, body, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: opts.fill || C.light }, line: { color: opts.line || C.line, width: 0.75 }, rectRadius: 0.08 })
  s.addText(head, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.38, fontFace: F, fontSize: opts.headSize || 13, bold: true, color: opts.headColor || C.navy, isTextBox: true, margin: 0 })
  if (Array.isArray(body)) {
    s.addText(bullets(body, opts.size || 11), { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: h - 0.6, fontFace: F, valign: 'top', isTextBox: true, margin: 0 })
  } else if (body) {
    s.addText(body, { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: h - 0.6, fontFace: F, fontSize: opts.size || 11, color: opts.bodyColor || C.ink, valign: 'top', isTextBox: true, margin: 0 })
  }
}
function stat(s, x, y, w, h, big, label, color = C.navy) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: C.white }, line: { color: C.line, width: 0.75 }, rectRadius: 0.08 })
  s.addText(big, { x, y: y + 0.12, w, h: h * 0.55, fontFace: F, fontSize: 30, bold: true, color, align: 'center', isTextBox: true, margin: 0 })
  s.addText(label, { x: x + 0.1, y: y + h * 0.62, w: w - 0.2, h: h * 0.35, fontFace: F, fontSize: 10.5, color: C.muted, align: 'center', valign: 'top', isTextBox: true, margin: 0 })
}
function table(s, rows, x, y, w, colW, opts = {}) {
  const size = opts.size || 10.5
  const body = rows.map((r, ri) => r.map((c) => {
    const cell = typeof c === 'string' ? { text: c } : { ...c }
    cell.options = { fontFace: F, fontSize: size, color: C.ink, valign: 'middle', margin: 0.05, ...(cell.options || {}) }
    if (ri === 0) cell.options = { ...cell.options, bold: true, color: C.white, fill: { color: C.navy } }
    return cell
  }))
  s.addTable(body, { x, y, w, colW, border: { type: 'solid', pt: 0.5, color: C.line }, fill: { color: C.white }, rowH: opts.rowH || 0.3, autoPage: false })
}
const G = (g) => ({ text: g, options: { bold: true, color: g === 'C' ? C.bad : g === 'S' ? C.warn : C.ok, align: 'center' } })
const OK = { text: '충족', options: { bold: true, color: C.ok, align: 'center' } }
const PART = { text: '부분', options: { bold: true, color: C.warn, align: 'center' } }
const NO = { text: '미구현', options: { bold: true, color: C.bad, align: 'center' } }
const NA = { text: '의도적 미채택', options: { bold: true, color: C.muted, align: 'center' } }
// 표 위 핵심 한 줄 — 발표 중 표를 읽지 않아도 메시지가 전달되게
function keyMsg(s, text) {
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.42, w: 12.1, h: 0.42, fill: { color: C.navySoft }, line: { color: C.navySoft }, rectRadius: 0.06 })
  s.addText(text, { x: 0.75, y: 1.44, w: 11.8, h: 0.38, fontFace: F, fontSize: 11, bold: true, color: C.navy, valign: 'middle', isTextBox: true, margin: 0 })
}
const OK2 = (t) => ({ text: t, options: { bold: true, color: C.ok } })
const NO2 = (t) => ({ text: t, options: { bold: true, color: C.bad } })

// ───────────────────────── 1. 표지
{
  const s = base({ dark: true, noFooter: true })
  s.addText('innoAI Persistent Tagging PoC 기술 공모 제안', { x: 0.8, y: 0.9, w: 8, h: 0.5, fontFace: F, fontSize: 16, color: 'C3CAD6', isTextBox: true, margin: 0 })
  s.addText('LedgerMarker', { x: 0.8, y: 1.5, w: 8, h: 1.2, fontFace: F, fontSize: 60, bold: true, color: C.white, isTextBox: true, margin: 0 })
  s.addText('ECM 밖에서도 살아남는 문서 신원', { x: 0.8, y: 2.75, w: 8, h: 0.6, fontFace: F, fontSize: 24, color: C.white, isTextBox: true, margin: 0 })
  s.addText('서명 라벨(여권) · 불변 원장(대장) · 4단 재식별 사다리 · 기관 간 등가성 협정\ndocsim 讀心(문서의 뜻을 읽다) 결합 · v2.71', { x: 0.8, y: 3.45, w: 8, h: 0.9, fontFace: F, fontSize: 14, color: 'C3CAD6', isTextBox: true, margin: 0 })
  s.addText('[부서명] · (이름) · 2026-09-30', { x: 0.8, y: 6.3, w: 8, h: 0.4, fontFace: F, fontSize: 13, color: C.white, isTextBox: true, margin: 0 })
  // 오른쪽: 4단 사다리
  const steps = [['① 라벨', '서명된 등급 라벨을 파일 안에 내장', C.navy], ['② 원시 해시', '불변 원장 조회 → 라벨 복원', '2A3F6B'], ['③ 텍스트 해시', '재저장·재압축 생존 재식별', '3B5487'], ['④ 지문 + 의미', 'MinHash 후보 → docsim 讀心 판정', '4C69A3']]
  steps.forEach(([h, b, col], i) => {
    const y = 1.3 + i * 1.25
    s.addShape(pres.ShapeType.roundRect, { x: 9.3, y, w: 3.4, h: 1.05, fill: { color: col }, line: { color: 'C3CAD6', width: 0.75 }, rectRadius: 0.1 })
    s.addText(h, { x: 9.5, y: y + 0.1, w: 3, h: 0.4, fontFace: F, fontSize: 15, bold: true, color: C.white, isTextBox: true, margin: 0 })
    s.addText(b, { x: 9.5, y: y + 0.5, w: 3.1, h: 0.45, fontFace: F, fontSize: 11, color: 'E5E7EB', isTextBox: true, margin: 0 })
  })
  s.addText('어느 단이 깨져도 다음 단이 받는다', { x: 9.3, y: 6.35, w: 3.4, h: 0.4, fontFace: F, fontSize: 11, italic: true, color: 'C3CAD6', align: 'center', isTextBox: true, margin: 0 })
  s.addNotes('표지. 제출 파일명 규칙: [부서명] innoAI Persistent Tagging PoC 공모 제안_(이름). VisuPlanner 02.공모제출 폴더.')
}

// ───────────────────────── 2. 한 장 요약 + 제출 세트
{
  const s = base()
  title(s, '한 장 요약 — 무엇을 만들었고, 무엇을 제출하는가', '요강 05 "PoC Submission Package" 5개 항목을 하나의 세트로 제출한다 · 3쪽 시연 스토리 → 4쪽 평가 기준 대응표 순으로 읽으면 3분 안에 결론이 잡힌다')
  textBox(s, 0.6, 1.55, 6.3, 5.2, [
    { text: 'LedgerMarker는 ECM이 부여한 File ID·보안등급·Tag를 서명 라벨로 파일 안에 결속하고, 그 사실을 수정 불가 원장에 기록한다.', size: 13 },
    { text: '파일이 복사·개명·이동·재저장·수정·변환·라벨 유실을 겪어도 4단 사다리(라벨 → 해시 → 텍스트 해시 → 지문·의미)로 신원을 되찾고 정책을 재적용한다.', size: 13 },
    { text: '필수 시연 8종 전부 실동작. 스크립트 하나(poc-demo.sh)로 재현되고 자동 테스트 7패키지가 고정한다.', size: 13 },
    { text: '기관 간 연계(우정사업본부↔이노티움 등가성 협정)와 원장 가시화 관리콘솔(6개 화면)까지 포함해 "실제로 동작하는가"에 답한다.', size: 13 },
    { text: '사내 선행 3부작 흡수: SigNET(라벨 보존성) · docsim 讀心(문서 유사도) · LedgerMarker(불변 원장).', size: 12, color: C.muted }
  ])
  const pk = [['01 실행 가능한 PoC', 'Go 서버·CLI·웹 PWA·Gate SDK 소스 전체 + 원커맨드 데모 스택', '26'],
    ['02 실제 시연', '필수 8종 + 위조 4종 + 기관 간 4종, 웹·CLI 양쪽', '12~15'],
    ['03 구현 설명서', '구조·기술·알고리즘·식별·복원·실행방법', '6~11'],
    ['04 테스트 결과', '시나리오 성공/실패, 정확도, 성능, 제한', '17~20'],
    ['05 한계·적용방안', '미지원 조건, innoAI/innoECM 추가 개발, 비즈니스 모델', '22~25']]
  pk.forEach(([h, b, p], i) => {
    const y = 1.55 + i * 1.02
    s.addShape(pres.ShapeType.roundRect, { x: 7.2, y, w: 5.5, h: 0.9, fill: { color: C.light }, line: { color: C.line, width: 0.75 }, rectRadius: 0.08 })
    s.addText(h, { x: 7.35, y: y + 0.08, w: 3.6, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: C.navy, isTextBox: true, margin: 0 })
    s.addText('충족 · ' + p + '쪽', { x: 11.0, y: y + 0.1, w: 1.6, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.ok, align: 'right', isTextBox: true, margin: 0 })
    s.addText(b, { x: 7.35, y: y + 0.45, w: 5.2, h: 0.4, fontFace: F, fontSize: 10.5, color: C.ink, isTextBox: true, margin: 0 })
  })
}

// ───────────────────────── 3. 3분 시연 스토리 — 문서 하나의 여정
{
  const s = base()
  title(s, '3분 시연 스토리 — 문서 하나의 여정, 여덟 번 되살아나는 신원', '같은 문서(문서관리규정.docx)가 발급 → 복사 → 유실 → 재저장 → 수정 → 변환 → 기관 이동을 겪는다. 각 칸의 근거는 13·14쪽 실측 캡처')
  const st = [
    ['① 발급', '서명 라벨을 파일 안에 내장, 원장 seq 기록', '① 라벨', '서명 valid · 원장 등록', C.navy],
    ['② 복사·개명·이동', '이름을 바꾸고 다른 폴더·외장매체로', '① 라벨 · ② 해시', '같은 docGuid·등급 귀속 (해시 동일)', C.navy],
    ['③ 라벨 제거', '메타정보를 지운 사본이 유통', '② 원시 해시', '원장 폴백 → 등급 S 귀속 → 라벨 복원', '2A3F6B'],
    ['④ 편집기 재저장', 'Pages가 ZIP을 재조립, 바이트 전면 변경', '③ 텍스트 해시', '라벨 소실에도 같은 docGuid 재식별·복원', '2A3F6B'],
    ['⑤ 일부 수정', '조항 하나 고치고 하나 추가한 개정안', '④ 지문 + 의미', 'MinHash 73% → docsim 讀心 "재작성" 0.97 → 상속 복원', '3B5487'],
    ['⑥ DOCX → PDF', '같은 내용을 PDF로 변환', '④ 지문', '지문 100% · 의미 1.00 "동일 문서"', '3B5487'],
    ['⑦ 이노티움으로 전달', '협정이 있는 기관 게이트', '협정 번역', 'S → S 번역, 통과 권고', '4C69A3'],
    ['⑧ 국세청 전달 · C등급', '협정 없는 기관 / 내부 전용 등급', '협정 없음 · 차단', '서명만 확인, 검토 권고 / C는 차단 권고', '4C69A3']
  ]
  st.forEach(([h, what, rung, ev, col], i) => {
    const colIdx = i % 4, row = Math.floor(i / 4)
    const x = 0.6 + colIdx * 3.05, y = 1.55 + row * 2.45
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.9, h: 2.25, fill: { color: C.white }, line: { color: C.line, width: 0.75 }, rectRadius: 0.08 })
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.9, h: 0.5, fill: { color: col }, line: { color: col }, rectRadius: 0.08 })
    s.addText(h, { x: x + 0.12, y: y + 0.06, w: 2.7, h: 0.38, fontFace: F, fontSize: 12.5, bold: true, color: C.white, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText([
      { text: '일어나는 일  ', options: { bold: true, color: C.muted, fontSize: 8.5 } }, { text: what, options: { color: C.ink, fontSize: 10, breakLine: true } },
      { text: '받아 주는 단  ', options: { bold: true, color: C.muted, fontSize: 8.5 } }, { text: rung, options: { color: C.navy, bold: true, fontSize: 10, breakLine: true } },
      { text: '결과  ', options: { bold: true, color: C.muted, fontSize: 8.5 } }, { text: ev, options: { color: C.ok, bold: true, fontSize: 10 } }
    ], { x: x + 0.12, y: y + 0.58, w: 2.68, h: 1.62, fontFace: F, valign: 'top', isTextBox: true, margin: 0, paraSpaceAfter: 4 })
    if (colIdx < 3) s.addShape(pres.ShapeType.rightArrow, { x: x + 2.92, y: y + 0.95, w: 0.12, h: 0.3, fill: { color: C.muted }, line: { color: C.muted } })
  })
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 6.5, w: 12.1, h: 0.45, fill: { color: C.okSoft }, line: { color: C.ok, width: 0.75 }, rectRadius: 0.06 })
  s.addText('어느 단이 깨져도 다음 단이 받는다: 라벨(①②) → 원시 해시(③) → 텍스트 해시(④) → 지문·의미(⑤⑥) → 협정(⑦⑧). 여덟 칸 전부 poc-demo.sh 한 번으로 재현된다.', { x: 0.75, y: 6.52, w: 11.8, h: 0.4, fontFace: F, fontSize: 10.5, color: C.ink, valign: 'middle', isTextBox: true, margin: 0 })
}

// ───────────────────────── 16. 평가 기준 대응 (핵심)
{
  const s = base()
  title(s, '요강 06 평가 기준 대응표', '평가항목 · 배점 · 주요 평가내용 · 우리가 구현한 것 · 확인 방법')
  table(s, [
    ['평가항목', '배점', '주요 평가내용', '구현 항목', '확인 방법'],
    ['실제 동작 및 PoC 완성도', '40', '시연 성공 여부, 안정성, 재현 가능성', '필수 8종 + 위조 4종 + 기관 간 4종 실동작. 서버·CLI·웹·SDK 완비. 데모 스택 원커맨드(run-demo.sh), 시연 스크립트 8단계(poc-demo.sh), 샘플 일괄 로딩 버튼(멱등)', '13·14쪽 캡처, poc-demo.sh, go test'],
    ['파일 식별·Tag 유지/복원 정확도', '25', '복사·이동·수정·변환 상황에서 식별 성능', '복사·개명·이동·라벨제거 100% · 변환 100% · 국소 수정 0.77~0.86 · 재작성 의미 0.91 · 무관 오탐 0 · 재저장본 텍스트 해시 재식별 · 완전/상속 복원', '17~20쪽 표, accuracy_test, demo/ 케이스'],
    ['다양한 환경 대응성', '15', '파일시스템, 외부 저장매체, 변환 등 예외 대응', 'OS 메타 대신 포맷 내장(ADS/xattr 소멸 경로 생존) · 미등재 포맷 자동 사이드카 · 오프라인 L1 검증 · 재저장·재압축 생존 · 5기관 협정 번역·만료·차단 · 한글/영문·7개 형식 샘플', '15쪽, 형식 카탈로그, 오프라인 검증'],
    ['제품 적용 가능성', '10', 'innoAI/innoECM 실제 제품 적용 수준', 'REST API + Gate SDK, 포맷 카탈로그 단일 진실원천, 교체 가능한 암호모듈 인터페이스, 본문 미전송·미저장 원칙, 관리콘솔 6화면, 적용 로드맵 7항', '23·25쪽 적용방안·비즈니스 모델, API 명세'],
    ['기술 독창성 및 확장성', '10', '기존 구조 대비 개선점, 신규 기술, 확장성', '서명 라벨+불변 원장+텍스트 해시+지문+의미의 상호 보완 결합 · 선언적/관찰적 이중 계보 · 등가성 협정(여권) 모델 · 게이트 관측 로그 분리 · 특허 소재 3건(별지)', '24쪽 차별점, 비공개 별지']
  ], 0.6, 1.45, 12.1, [1.9, 0.6, 2.3, 5.0, 2.3], { size: 9.5, rowH: 0.8 })
}

// ───────────────────────── 3. 요강 기술 항목 대응
{
  const s = base()
  title(s, '요강 3.x 구현 방식 후보 대비 채택 현황', '"구현 방식은 다음 기술에 한정하지 않는다" — 채택·미채택의 이유를 명시한다')
  table(s, [
    ['요강 기술', '채택', 'LedgerMarker 구현', '이유·비고'],
    ['NTFS ADS', NA, '—', '복사·압축·메일·웹 업로드·타 OS에서 소멸 → 외부 채널 생존 불가'],
    ['xAttr', NA, '—', 'ADS와 동일. 대신 파일 내용에 결속하는 방식 선택'],
    ['Embedded Metadata', OK, '서명 라벨 포맷 내장: ZIP 코멘트(OOXML·HWPX·ODF)·트레일러(PDF·HWP·이미지)·front matter(md) + 사이드카 폴백', '라벨 = File ID·등급·Tag·계보를 담은 전자서명. 1바이트 위조도 탐지'],
    ['SHA-256 등 Hash', OK, '본문 해시(라벨 제외 HashTarget) + 정규화 텍스트 해시(2차 색인)', '원장 조회로 라벨 복원. 재저장·재압축본은 텍스트 해시로 정확 재식별'],
    ['구조 Fingerprint', NO, '— (로드맵)', 'DOCX 구조 지문은 미구현. 텍스트·의미 지문이 그 역할을 대신'],
    ['콘텐츠 Fingerprint', OK, '문자 5-gram MinHash(128) + LSH(32×4) 색인, 자카드 유사도 추정', '수정본·변환본 후보를 수 ms에 조회. 본문 미저장(단방향)'],
    ['AI 의미 Fingerprint', OK, 'docsim 讀心 — ko-sroberta 의미 임베딩 지문 저장·compare-fp 정밀 판정', '재작성본(글자 겹침 5%)도 의미 0.91로 같은 문서 판정'],
    ['자체 Registry', OK, 'PostgreSQL append-only 원장(해시체인·머클 봉인·UPDATE/DELETE 차단) + 게이트 관측 로그', '발급 사실(원장)과 기관 간 이동·검증(관측)을 분리 기록']
  ], 0.6, 1.95, 12.1, [2.0, 1.2, 4.9, 4.0], { size: 10, rowH: 0.5 })
  keyMsg(s, '채택 5 · 의도적 미채택 2 · 미구현 1 — 파일시스템 메타(ADS/xAttr)는 외부 채널에서 사라지므로 버리고, 파일 내용에 결속하는 방식만 골랐다')
}

// ───────────────────────── 4. 전체 구조
{
  const s = base()
  title(s, '구현 설명서 ① 전체 구조', '파일 본문은 서버로 가지 않는다 — 해시·지문·라벨만 오간다')
  const box = (x, y, w, h, head, body, fill) => {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill || C.light }, line: { color: C.navy, width: 1 }, rectRadius: 0.08 })
    s.addText(head, { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: fill === C.navy ? C.white : C.navy, isTextBox: true, margin: 0 })
    s.addText(body, { x: x + 0.12, y: y + 0.45, w: w - 0.24, h: h - 0.55, fontFace: F, fontSize: 10.5, color: fill === C.navy ? 'E5E7EB' : C.ink, valign: 'top', isTextBox: true, margin: 0 })
  }
  box(0.6, 1.6, 3.2, 1.35, 'LM CLI (lm)', '발급·검증·재식별·복원·계보\n전달(send)·수신(receive)·원장 운영')
  box(0.6, 3.15, 3.2, 1.35, 'LedgerMarker Web (PWA)', '드래그앤드롭 검증·발급·원장 6화면\n유사도 테스트·기관 페르소나·수신함')
  box(0.6, 4.7, 3.2, 1.35, 'Gate SDK (Go + REST)', 'CDS/DLP/AI필터 게이트가 호출\nverdictHint는 참고값, 판정은 게이트 정책')
  s.addShape(pres.ShapeType.rightArrow, { x: 3.95, y: 3.35, w: 0.7, h: 0.6, fill: { color: C.muted }, line: { color: C.muted } })
  s.addText('해시·지문·라벨만', { x: 3.85, y: 3.95, w: 0.95, h: 0.3, fontFace: F, fontSize: 8.5, color: C.muted, align: 'center', isTextBox: true, margin: 0 })
  box(4.8, 1.6, 4.7, 4.45, 'LM Server (Go)',
    '발급: 라벨 조립·기관 키 서명·멱등 발급 (5기관 발급 가능)\n검증: 서명 · 원장 · 폐기 · 유효기간 · 협정(L3) 5항목 분리 판정\n재식별: 해시 → 텍스트 해시 → MinHash/LSH → docsim 讀心\n복원: 완전 복원(원본 라벨 회수) · 상속 복원(재수화 발급)\n계보: parentHash DAG · 변환 종류 · 최초 조상\n협정: 등가성 협정 번역표(gradeMap) · 만료\n관측: 기관 간 SENT/VERIFIED 로그(원장과 분리)\n원장 운영: 해시체인 점검 · 머클 체크포인트 봉인', C.navy)
  box(9.7, 1.6, 3.0, 2.1, 'PostgreSQL 16', 'append-only 원장·지문 색인·관측 로그\nUPDATE/DELETE 트리거 차단 + 권한 회수\n인메모리 모드(데모·테스트) 동일 계약')
  box(9.7, 3.95, 3.0, 2.1, 'docsim 讀心 (사내 모듈)', '슁글 + 의미 임베딩 2엔진\n서브프로세스 어댑터로만 결합 (코드 무수정)\n발급 시 의미 지문 저장, 재식별 시 compare-fp')
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 6.25, w: 12.1, h: 0.65, fill: { color: C.okSoft }, line: { color: C.ok, width: 0.75 }, rectRadius: 0.06 })
  s.addText('설계 불변식 4개  ①원장은 수정·삭제되지 않는다  ②등급 필드는 평문이다(게이트가 복호화 없이 읽음)  ③서버는 본문을 저장하지 않는다  ④귀속과 판정을 분리한다', { x: 0.75, y: 6.3, w: 11.8, h: 0.55, fontFace: F, fontSize: 11, color: C.ink, valign: 'middle', isTextBox: true, margin: 0 })
}

// ───────────────────────── 5. 사용 기술·오픈소스
{
  const s = base()
  title(s, '구현 설명서 ② 사용 기술 · 오픈소스 사용내역', '요강 6.1 — 외부 라이브러리·오픈소스 사용내역 명시, AI 생성 코드 포함 전체 동작 설명·재현 가능')
  table(s, [
    ['구성요소', '기술 · 버전', '라이선스', '용도'],
    ['서버·CLI·SDK', 'Go 1.26 표준 라이브러리, cobra, google/uuid, pgx v5, golang-migrate, golang.org/x/text', 'BSD · Apache-2.0 · MIT', '서명·해시·원장·API·마이그레이션·NFC 정규화'],
    ['PDF 텍스트', 'ledongthuc/pdf', 'MIT', '지문용 PDF 텍스트 레이어 추출'],
    ['데이터베이스', 'PostgreSQL 16 (Docker)', 'PostgreSQL', 'append-only 원장·트리거·권한'],
    ['웹', 'React 18, Vite 5, vite-plugin-pwa/Workbox, react-router', 'MIT', 'PWA·오프라인 L1 검증·라우팅'],
    ['웹 암호·파싱', 'pkijs, asn1js, pdfjs-dist, cytoscape', 'BSD-3 · Apache-2.0 · MIT', '브라우저 서명 검증·PDF 추출·계보 그래프'],
    ['의미 엔진', 'docsim 讀心(사내) — ko-sroberta-multitask 임베딩', '사내 · Apache-2.0(모델)', '의미 지문·정밀 판정(compare-fp)'],
    ['개발 도구', 'Claude Code(AI 코딩 보조), Docker Desktop', '—', '코드 작성 보조. 전체 동작은 제출자가 설명·재현']
  ], 0.6, 1.55, 12.1, [1.8, 4.5, 2.2, 3.6], { size: 10.5, rowH: 0.5 })
  s.addText('전 구성요소가 허용적 오픈소스 라이선스(MIT·BSD·Apache)이며 사내 모듈은 docsim 讀心 하나다. 암호모듈은 개발용 소프트웨어 키스토어이며 KCMVP 검증필 모듈로 교체 가능한 인터페이스(internal/crypto)로 분리되어 있다.', { x: 0.6, y: 6.0, w: 12.1, h: 0.7, fontFace: F, fontSize: 11, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 6. 파일 식별 방식
{
  const s = base()
  title(s, '구현 설명서 ③ 파일 식별 방식 — 4단 사다리와 판정 기준', '요강 3.4 "100% 동일성이 어려운 경우 식별 정확도·유사도 기준을 명확히 정의"')
  table(s, [
    ['단', '메커니즘', '살아남는 상황', '판정 기준 (명시)'],
    ['① 라벨', '서명된 등급 라벨을 파일 안에 내장(포맷별) 또는 사이드카(.lmsig)', '복사·개명·이동·외장매체·망간 이동', '전자서명 검증 valid/invalid. 등급·File ID·Tag 1바이트 변조도 invalid'],
    ['② 원시 해시', 'SHA-256(라벨 제외 본문) → 원장 조회 → 보관 라벨 회수', '라벨·메타정보 완전 유실', '정확 일치(100%). confidence 1.0 (선언적)'],
    ['③ 텍스트 해시', '정규화 본문 텍스트(NFC·소문자·공백 제거) SHA-256 2차 색인', '편집기 재저장·재압축으로 바이트 전면 변경', '정확 일치(100%). 원시 해시 미등록 시에만 적용'],
    ['④ 지문', '문자 5-gram MinHash(128)+LSH → 자카드 유사도 추정', '내용 일부 수정, DOCX→PDF 변환, 다른 이름 저장', '후보 하한 0.30 · 자동 상속 복원 0.70 이상 · 그 사이는 운영자 확정. confidence < 1 (추정)'],
    ['④′ 의미', 'docsim 讀心: 의미 임베딩 코사인 + 슁글 → 관계 판정', '재작성(같은 내용, 다른 표현), 발췌', '판정 동일/수정/발췌/재작성/무관. 실측: 재작성 ≥0.86, 무관 ≤0.54']
  ], 0.6, 1.95, 12.1, [1.3, 3.9, 3.0, 3.9], { size: 10, rowH: 0.62 })
  keyMsg(s, '정확 일치(①②③)는 100%, 추정(④)은 0.30 후보 · 0.70 자동 복원 · 그 사이 운영자 확정 — 숫자를 미리 못 박아 둔다')
  s.addText('원칙: 선언적 계보(라벨·원장, confidence 1.0)와 관찰적 재식별(지문·의미, confidence < 1)을 분리 표시하고, 추정 결과의 채택은 운영자·게이트가 정한다(불변식 ④).', { x: 0.6, y: 6.05, w: 12.1, h: 0.6, fontFace: F, fontSize: 11, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 7. Tag 유지·복원 방식
{
  const s = base()
  title(s, '구현 설명서 ④ Tag 유지 · 복원 방식', '포맷별 부착(유지)과 두 가지 복원(완전 복원 · 상속 복원)')
  table(s, [
    ['포맷', '부착 방식', '원리'],
    ['DOCX·XLSX·PPTX·HWPX·ODF·ZIP', 'ZIP 아카이브 코멘트', '모든 ZIP 리더가 코멘트를 무시 → 파일 무손상'],
    ['HWP·MSG (CFB)', '파일 끝 트레일러', 'CFB 파서는 섹터 기반, 꼬리 데이터 무시'],
    ['PDF·JPEG·PNG', '트레일러 (LMLABEL1 매직)', '꼬리 데이터 허용 포맷'],
    ['Markdown·TXT', 'YAML front matter + 텍스트 정규화', 'BOM·CRLF·NFC 변환 후에도 해시 일치'],
    ['EXE·DLL', '사이드카 고정', '내장 시 코드서명 파괴 → 정책상 금지'],
    ['미등재 형식', '자동 사이드카 폴백', '"지원 안 되는 파일" 없음. 폴백 사유 원장 기록']
  ], 0.6, 1.55, 6.6, [2.3, 2.0, 2.3], { size: 10, rowH: 0.5 })
  card(s, 7.5, 1.55, 5.2, 2.2, '완전 복원 — 원본과 동일 (해시 일치)', ['라벨을 잃었지만 본문이 같은 파일', '원장 조회 → 보관된 원본 서명 라벨 회수 → 재부착(lm restore --embed)', '서명이 원본 그대로 살아나므로 정책 재적용 즉시 가능'], { size: 10.5 })
  card(s, 7.5, 3.95, 5.2, 2.2, '상속 복원(재수화) — 유사 원본에서', ['수정본은 원본 라벨을 붙이면 서명이 깨진다', '지문·의미로 원본을 식별해 File ID 계보·등급·Tag를 상속한 새 서명 라벨 발급(DERIVE)', '유사도 0.70 미만은 자동 발급하지 않고 운영자 검토(오탐 방지)'], { size: 10.5 })
  s.addText('재저장 시 내장 라벨이 소실되어도(Pages 실측 H-1 ✗) 텍스트 해시 색인이 재식별·복원을 보장한다(H-5 ○). 라벨을 제외한 본문만 해시하는 HashTarget 규약으로 부착 전·후·제거 후 해시가 항상 같다.', { x: 0.6, y: 6.25, w: 12.1, h: 0.6, fontFace: F, fontSize: 11, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 8. 수정·변환 파일 추적
{
  const s = base()
  title(s, '요강 3.4 수정·변환 파일 추적 — 파생 5유형별 식별 경로와 실측', '단순 복사를 넘어 파생 파일의 원본 연관성을 어떻게 잡는가')
  table(s, [
    ['파생 유형', '식별 경로', '실측 (데모 서버)', '결과'],
    ['문서 내용 일부 수정', '④ 지문 후보 → 의미 판정, 필요 시 상속 복원', '조문 1개 교체: MinHash 0.86 · 개정안(수정+추가): 0.77, 의미 0.94', '식별 (재작성/추가 판정)'],
    ['DOCX → PDF 변환', '③ 텍스트 해시 또는 ④ 지문(공백 제거 정규화)', 'MinHash 1.00 · 의미 1.00 → "동일 문서"', '식별 (100%)'],
    ['파일 일부 추출', '④ 지문 부분 포함률 + 의미, 계보 transform=extract', '제품기능명세서 → 요약본: 발췌 판정(포함률 0.89)', '식별 (발췌 판정)'],
    ['다른 이름으로 저장', '① 라벨 그대로 / ② 원시 해시 정확 일치', '개명·폴더 이동·외장매체 이동: 해시 동일', '식별 (100%)'],
    ['콘텐츠 일부 재구성(재작성)', '④′ 의미 임베딩 (글자 지문은 실패)', '자카드 0.05인데 의미 0.91 → "재작성" 판정', '식별 (의미 기준)']
  ], 0.6, 1.55, 12.1, [2.2, 3.5, 4.2, 2.2], { size: 10, rowH: 0.58 })
  stat(s, 0.6, 5.35, 2.85, 1.35, '0.30 / 0.70', '지문 후보 하한 / 자동 복원 임계', C.navy)
  stat(s, 3.65, 5.35, 2.85, 1.35, '0건', '무관 문서 30종 오탐(≥0.3)', C.ok)
  stat(s, 6.7, 5.35, 2.85, 1.35, '5% → 0.91', '재작성본 자카드 → 의미 유사도', C.warn)
  stat(s, 9.75, 5.35, 2.95, 1.35, '20%+', '무작위 치환 시 지문 미식별 구간 → 의미가 받음', C.muted)
}

// ───────────────────────── 9. 정책 재적용
{
  const s = base()
  title(s, '요강 3.5 정책 재적용 — 식별된 파일에 기존 정책 다시 적용', '재식별 결과는 "이 문서가 무엇인가"이며, 그 위에 보안등급·Tag 기준 정책이 다시 얹힌다')
  table(s, [
    ['정책', '구현', '어떻게'],
    ['접근 허용 / 차단', OK, '검증 5항목 + verdictHint(allow·review·deny). 위조·폐기·미등록은 deny, 라벨 부재·기간 외는 review. Gate SDK로 게이트가 호출'],
    ['외부 반출 통제', OK, '기관 간 등가성 협정으로 등급 번역. C(비밀)·잠정 라벨은 협정 대상 아님 → 차단 권고. 협정 없음·만료 → 검토 권고. 반출 승인자(exportApprover) 필드'],
    ['암호화', PART, '라벨 프로파일에 본문 암호화 자리(클라이언트 측, 등급은 평문 유지). PoC에서 암호화 실행부는 미구현'],
    ['워터마크', NO, '미구현. 로드맵: 검증 결과의 등급으로 워터마크 삽입 훅(게이트·뷰어 측)'],
    ['보존 / 폐기', OK, '라벨 유효기간(notAfter)·시한부 공개 전환 신호·REVOKE·DESTROY(파기 심의 토큰). 파기 후 사본 유통은 원장 증적으로 차단 근거'],
    ['경고 또는 로그 기록', OK, '원장(발급·등급변경·폐기·파기, 해시체인) + 게이트 관측 로그(SENT·VERIFIED, 판정·번역 등급). 원장 화면에서 열람'],
    ['라벨(정책) 재적용 자체', OK, '완전 복원: 원본 라벨 회수·재내장(lm restore --embed) / 상속 복원: 등급·Tag 상속 라벨 발급 → 서명 valid 복귀']
  ], 0.6, 1.95, 12.1, [2.2, 1.0, 8.9], { size: 10, rowH: 0.55 })
  keyMsg(s, '정책 7항목 중 5 충족 · 1 부분(암호화) · 1 미구현(워터마크) — 재식별이 "무엇인가"를 답하면 정책은 그 위에 그대로 얹힌다')
}

// ───────────────────────── 10. 필수 시연 8종
{
  const s = base()
  title(s, '요강 04 필수 PoC 시연 기준 — 8개 시나리오 전부 실동작', '최소 3개 요구 → 8개 모두 시연. poc-demo.sh ①~⑧ 원커맨드 재현 + 웹 화면')
  table(s, [
    ['#', '요강 시나리오', '시연 방법', '결과'],
    ['1', '원본 등록 → File ID/Tag 부여 → 동일 PC 복사 후 식별', 'lm issue --embed → 복사본 lm verify: 동일 docGuid·등급', OK],
    ['2', '파일명 변경 · 다른 폴더 이동 후 동일 파일 식별', '개명·이동본 검증: 내용 해시 기준 동일 귀속', OK],
    ['3', '외장 저장장치 이동 후 File ID/Tag 유지·복원', '라벨이 파일 안(또는 사이드카)에 동행, 오프라인 L1 서명 검증', OK],
    ['4', '메타정보 제거 후 Hash·Fingerprint 재식별', '라벨 제거본 → 원장 해시 폴백 → 등급 귀속 → 라벨 복원', OK],
    ['5', '파일 일부 수정 후 원본 연관성 식별', '개정안 → MinHash 후보 + docsim 讀心 판정(재작성·의미 0.97)', OK],
    ['6', 'DOCX → PDF 변환 후 파생관계 식별', '동일 본문 PDF → 지문 100%, 의미 1.00 "동일 문서"', OK],
    ['7', '식별된 파일에 기존 보안정책 자동 재적용', 'lm restore --embed 원본 라벨 회수·재내장 → 서명 valid, 웹 "이름표 받기"', OK],
    ['8', '이동·수정·변환 이력 Lineage/Audit Log 확인', '원장 6화면(표·레인·그래프·분류·기관 지도·흐름) + 체인 무결성 점검', OK]
  ], 0.6, 1.55, 12.1, [0.5, 4.2, 6.2, 1.2], { size: 10.5, rowH: 0.5 })
  s.addText('실제 출력은 다음 두 쪽: 8단계 CLI 로그(13쪽), 위조 4종 탐지·재저장 전후 결과 카드(14쪽). 기관 간 전달 4종은 15쪽', { x: 0.6, y: 6.25, w: 12.1, h: 0.5, fontFace: F, fontSize: 11, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 13. 시연 로그 — 8단계 CLI 출력 캡처
{
  const s = base()
  title(s, '시연 캡처 ① 필수 8단계 CLI 출력 — poc-demo.sh 한 번의 실제 결과', '2026-09-25 데모 서버 실행 로그. 초록 = 통과·재식별·복원, 노랑 = 라벨 없음·검토(설계된 판정)')
  s.addImage({ path: 'demolog.png', x: 0.6, y: 1.45, w: 9.85, h: 9.85 * 1580 / 2824 })
  const notes = [
    ['③ 라벨 제거 → 복원', '서명 absent인데 원장 registered → 원본 라벨 회수 후 다시 valid'],
    ['④ 수정본', '지문 73%로 후보를 좁히고 docsim 讀心이 "재작성 · 의미 0.97"로 확정'],
    ['⑥ 재저장', '원시 해시 미등록 → 텍스트 해시로 같은 docGuid 재식별 → 라벨 복원'],
    ['⑧ 기관 간', '이노티움 게이트: 협정 translated · allow (국세청은 no_treaty · review)']
  ]
  notes.forEach(([h, b], i) => {
    const y = 1.45 + i * 1.32
    s.addShape(pres.ShapeType.roundRect, { x: 10.65, y, w: 2.05, h: 1.2, fill: { color: C.light }, line: { color: C.line, width: 0.75 }, rectRadius: 0.06 })
    s.addText(h, { x: 10.75, y: y + 0.06, w: 1.85, h: 0.3, fontFace: F, fontSize: 10, bold: true, color: C.navy, isTextBox: true, margin: 0 })
    s.addText(b, { x: 10.75, y: y + 0.38, w: 1.85, h: 0.8, fontFace: F, fontSize: 8.5, color: C.ink, valign: 'top', isTextBox: true, margin: 0 })
  })
}

// ───────────────────────── 14. 위조 탐지 4종 · 재저장 전후
{
  const s = base()
  title(s, '시연 캡처 ② 위조 4종 전부 탐지 · 편집기 재저장 전후', '왼쪽: 같은 문서를 네 가지로 위조해 검증한 결과 카드(실측) · 오른쪽: ZIP 재조립으로 라벨이 사라진 파일이 텍스트 해시로 되살아나는 장면')
  // 왼쪽: 위조 4종 결과 카드 격자 + 해설 · 오른쪽: 재저장 전/후 카드 세로 배치 + 실측 해석
  s.addImage({ path: 'attack.png', x: 0.6, y: 1.45, w: 7.4, h: 7.4 * 1690 / 2720 })
  s.addText('내용 1바이트 변조 → 서명 무효·원장 미등록 · 등급 위조(S→O) → 서명 무효 · 서명값 변조 → 서명 무효 · 라벨 제거 → 라벨 없음이지만 원장 등록(폴백 귀속 → 복원 가능). 세 위조는 차단 권고, 제거는 검토 권고. 다섯 항목을 O/X 하나로 합치지 않는 이유가 여기 있다.', { x: 0.6, y: 6.1, w: 7.4, h: 0.7, fontFace: F, fontSize: 9, color: C.muted, isTextBox: true, margin: 0 })
  s.addText('재저장 전 — 문서관리규정.docx, 라벨 내장 · 서명 유효', { x: 8.2, y: 1.42, w: 4.5, h: 0.25, fontFace: F, fontSize: 9.5, bold: true, color: C.navy, isTextBox: true, margin: 0 })
  s.addImage({ path: 'resave_a.png', x: 8.2, y: 1.68, w: 4.0, h: 4.0 * 830 / 1360 })
  s.addText('재저장 후 — ZIP 재조립으로 라벨 소실 → 텍스트 해시로 같은 docGuid 재식별 (H-5 ○)', { x: 8.2, y: 4.2, w: 4.5, h: 0.4, fontFace: F, fontSize: 9.5, bold: true, color: C.ok, isTextBox: true, margin: 0 })
  s.addImage({ path: 'resave_b.png', x: 8.2, y: 4.6, w: 4.0, h: 4.0 * 830 / 1360 })
  s.addNotes('왜 다섯 항목을 따로 보이나: 서명·원장·폐기·유효기간·협정을 O/X 하나로 합치지 않는다. 위조(서명 무효)와 유실(라벨 없음)은 원인이 다르고 대응도 다르다. 라벨이 없어도 원장에 있으면 되살리고, 서명이 깨지면 원장에 있어도 차단을 권고한다. 판정은 참고값(verdictHint)이며 통과 여부는 게이트 정책이 정한다(불변식 ④). 재저장 실측: H-1 라벨 생존 ✗, H-4 원시 해시 ✗, H-5 텍스트 해시 재식별 ○ — 라벨 유실은 "재식별 후 복원"의 문제이지 신원 상실이 아니다.')
}

// ───────────────────────── 11. 기관 간 연계
{
  const s = base()
  title(s, '다양한 환경 대응 — 기관 간 전달과 등가성 협정 (모델 A)', '우정사업본부(KPOST)와 이노티움(INNOTIUM)은 과제 협력 관계로 협정 체결. 5개 기관이 한 서버에서 발급·검증(페르소나 전환)')
  textBox(s, 0.6, 1.6, 5.6, 2.3, [
    '보내기: 보내는 기관이 검증 후 관측 로그에 SENT. lm send --to / 웹 "타 기관으로 보내기"',
    '받기: 받는 기관 게이트가 원장 조회(L2) + 협정 번역(L3) → VERIFIED. lm receive --as / 웹 수신함',
    '원장 행은 늘지 않는다 — 발급 사실이 아니라 게이트가 보고한 사실(관측 로그)',
    '협정: KPOST↔INNOTIUM(~2027-12) · KPOST↔MOIS(~2027-08) · KPOST↔MSIT(2026-12 만료 예정). NTS는 협정 없음'
  ], 11)
  table(s, [
    ['전달', '문서 등급', '협정 판정', '번역', '힌트'],
    ['KPOST → INNOTIUM', G('S'), 'translated', 'S → S', { text: 'allow', options: { color: C.ok, bold: true } }],
    ['KPOST → NTS', G('S'), 'no_treaty', '미번역(서명만)', { text: 'review', options: { color: C.warn, bold: true } }],
    ['KPOST → INNOTIUM', G('C'), 'not_translatable', '불가(내부 전용)', { text: 'deny', options: { color: C.bad, bold: true } }],
    ['KPOST → MSIT (2027-02)', G('O'), 'expired', '미번역', { text: 'review', options: { color: C.warn, bold: true } }]
  ], 0.6, 4.05, 5.6, [1.8, 0.7, 1.2, 1.1, 0.8], { size: 10, rowH: 0.36 })
  s.addImage({ path: 'card.png', x: 6.5, y: 1.6, w: 6.2, h: 6.2 * 330 / 850 })
  s.addImage({ path: 'inbox.png', x: 6.5, y: 4.15, w: 6.2, h: 6.2 * 250 / 900 })
  s.addText('위: 협정 없는 국세청 게이트의 결과 카드(협정 없음 — 서명 진위만, 검토 필요) · 아래: 우정사업본부 게이트 수신함', { x: 6.5, y: 6.0, w: 6.2, h: 0.5, fontFace: F, fontSize: 10, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 12. 관리콘솔 — 원장 가시화
{
  const s = base()
  title(s, 'UI / 관리콘솔 — 원장 가시화 6화면 (선택 제출 5.2)', '표 · 레인 차트 · 전체 그래프 · 분류·온톨로지 · 기관 지도 · 기관 간 흐름. 모두 실제 원장 데이터로 그린다')
  s.addImage({ path: 'lane.png', x: 0.6, y: 1.55, w: 4.1, h: 4.1 * 1100 / 900 })
  s.addImage({ path: 'passport.png', x: 4.9, y: 1.55, w: 4.0, h: 4.0 * 740 / 900 })
  s.addImage({ path: 'stamps.png', x: 4.9, y: 4.95, w: 4.0, h: 4.0 * 460 / 900 })
  s.addImage({ path: 'graph.png', x: 9.1, y: 1.55, w: 3.6, h: 3.6 * 560 / 900 })
  s.addImage({ path: 'taxonomy.png', x: 9.1, y: 3.95, w: 3.6, h: 3.6 * 700 / 900 })
  s.addNotes('레인 차트: seq × 문서, 등급 색·등급변경·폐기·파기·봉인 · 기관 지도: 협정 유효/만료/없음, 등급 번역 매트릭스 · 기관 간 흐름: 여권 스탬프 타임라인과 발급→검증 산키 · 전체 그래프: 기관·문서·계보·해시체인 · 분류: BRM 트리맵·근거 호수·태그·온톨로지 스키마(JSON-LD)')
}

// ───────────────────────── 13. 테스트 결과 1
{
  const s = base()
  title(s, '테스트 결과 ① 시나리오 성공/실패 · 지문 재식별 정확도', '요강 5.1 — 적용 시나리오, 성공/실패, 식별 정확도 또는 제한사항')
  stat(s, 0.6, 1.55, 2.3, 1.3, '8 / 8', '필수 시나리오 성공', C.ok)
  stat(s, 3.05, 1.55, 2.3, 1.3, '4 / 4', '위조 시나리오 탐지', C.ok)
  stat(s, 5.5, 1.55, 2.3, 1.3, '4 / 4', '기관 간 전달 판정 정확', C.ok)
  stat(s, 7.95, 1.55, 2.3, 1.3, '7 / 7', 'Go 테스트 패키지 통과', C.ok)
  stat(s, 10.4, 1.55, 2.3, 1.3, '0', '무관 문서 오탐', C.navy)
  table(s, [
    ['조건 (지문 재식별, 자동 테스트로 고정)', 'LM 유사도', 'LM 판별(하한 0.30)', '청크 해시 방식이면'],
    ['동일 문서 / 서식만 변경(줄바꿈·공백·인코딩)', '1.00 / ~1.00', OK2('식별'), '동일은 식별 · 서식 변경은 바이트가 달라져 미식별'],
    ['DOCX ↔ 동일 본문 TXT·PDF (형식 변환)', '1.00', OK2('식별'), NO2('미식별 — 컨테이너 바이트가 전혀 다름')],
    ['조문 1개 교체 (국소 수정, 실사용 유형)', '0.86', OK2('식별'), '부분 식별(바뀐 청크 밖은 일치) · 등급·출처는 알 수 없음'],
    ['단어 5% / 10% 무작위 흩뿌림 치환 (최악 조건)', '0.63 / 0.48', OK2('식별'), NO2('미식별 — 거의 모든 청크가 깨짐')],
    ['단어 20% / 30% / 50% 무작위 치환', '0.28 / 0.27 / 0.18', '미식별 → docsim 讀心 의미 판정이 받음', NO2('미식별')],
    ['무관 문서 30종', '최대 < 0.30', OK2('오탐 0건'), '오탐 0건']
  ], 0.6, 3.1, 12.1, [4.3, 1.7, 2.6, 3.5], { size: 10, rowH: 0.4 })
  s.addText('해석: 국소 수정은 높은 유사도로 잡히고, 20%+ 무작위 치환(사실상 재작성)은 글자 지문이 잡지 않는다(오탐 0 우선) — 그 구간은 의미 엔진이 담당한다(다음 쪽). 청크 해시 열은 같은 조건을 파일·청크 해시 색인으로 처리할 때의 예상이며, 식별되더라도 등급·출처·폐기 여부는 답하지 못한다.', { x: 0.6, y: 6.15, w: 12.1, h: 0.6, fontFace: F, fontSize: 11, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 14. 테스트 결과 2
{
  const s = base()
  title(s, '테스트 결과 ② 의미 판정 실측 · 편집기 재저장 실측 · 성능', 'docsim 讀心 결합 케이스, Apple Pages 재저장(SigNET 가설), 처리 시간')
  table(s, [
    ['케이스 (demo/ 폴더, 유사도 테스트 메뉴)', 'MinHash', '의미(코사인)', 'docsim 판정'],
    ['1 수정본 — 조문 수정+추가 (한글)', '77%', '0.94', '재작성 (같은 내용, 다른 표현)'],
    ['1 수정본 (영문)', '70%', '0.98', '추가·확장 (A→B)'],
    ['2 재작성본 — 문장 구조 전면 변경 (한글)', '5%', '0.91', '재작성 — 글자로는 남남, 뜻으로는 같은 문서'],
    ['2 재작성본 (영문, 한국어 특화 모델)', '4%', '0.75', '일부 유사'],
    ['3 무관 대조군 (한글 / 영문)', '0% / 0%', '0.40 / 0.54', '무관']
  ], 0.6, 1.55, 7.3, [3.6, 0.9, 1.0, 1.8], { size: 10, rowH: 0.42 })
  table(s, [
    ['재저장 실측 (Pages, docx→docx)', '결과'],
    ['H-1 내장 라벨 생존', { text: '✗ (ZIP 전면 재조립)', options: { color: C.bad } }],
    ['H-4 원시 해시 유지', { text: '✗ (바이트 전면 변경)', options: { color: C.bad } }],
    ['H-5 텍스트 해시 재식별', { text: '○ 동일 docGuid 귀속·복원', options: { color: C.ok, bold: true } }]
  ], 8.2, 1.55, 4.5, [2.5, 2.0], { size: 10, rowH: 0.42 })
  table(s, [
    ['성능 (PostgreSQL, 순차 100회)', '평균', 'p95'],
    ['발급 (서명+원장 기록)', '7.8 ms', '7.8 ms'],
    ['검증 (서명+원장 조회)', '3.2 ms', '4.5 ms'],
    ['지문 재식별 (LSH 후보)', '1.1 ms', '1.4 ms'],
    ['docsim 讀心 정밀 판정', '~3 s', '모델 로드 포함']
  ], 8.2, 3.55, 4.5, [2.5, 1.0, 1.0], { size: 10, rowH: 0.36 })
  s.addText('자동 테스트: go test 7패키지 — 라벨 1바이트 변조 100% 탐지 · 원장 UPDATE/DELETE DB 차단 · 슈퍼유저 조작 시 체인 점검이 조작 seq 지목 · 오프라인(접속 불가)과 미등록 엄격 구분 · 멱등 발급 · 3세대 계보 · 협정 L3(번역·없음·만료·C차단) · 관측 로그 · 샘플 로더 멱등성 · 정확도 곡선. 재저장 가설의 한컴·MS Office 실측은 동일 스크립트(resave-measure.sh)로 수행 예정.', { x: 0.6, y: 5.75, w: 12.1, h: 1.0, fontFace: F, fontSize: 10.5, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 15. 유사도 테스트 화면 — 왜 의미 비교(docsim 讀心)인가
{
  const s = base()
  title(s, '유사도 테스트 화면 — 글자로는 남남, 뜻으로는 같은 문서', '한 화면에서 ① 파일 해시 · ② MinHash 자카드 · ③ 의미 유사도를 나란히 본다. 재작성 유출은 ③만 잡는다')
  s.addImage({ path: 'simpair.png', x: 0.6, y: 1.5, w: 6.0, h: 6.0 * 700 / 850 })
  s.addImage({ path: 'simledger.png', x: 6.85, y: 1.5, w: 3.1, h: 3.1 * 720 / 850 })
  s.addText('원장 검색 모드 — 후보 사분면(MinHash × 의미)', { x: 6.85, y: 4.15, w: 3.1, h: 0.3, fontFace: F, fontSize: 8.5, color: C.muted, isTextBox: true, margin: 0 })
  // 오른쪽 열: 왜 중요한가 · 우리 장점
  const pts = [
    ['5% vs 91%', '같은 개인정보 처리방침을 문장 구조만 바꿔 다시 쓴 문서. 글자 지문(자카드)은 5%로 남남, 의미는 0.91로 "재작성" 판정.', C.warn],
    ['유출은 재작성으로 온다', '보안 문서를 그대로 내보내는 사람은 드물다. 요약·재구성·번역이 새 문서로 둔갑할 때 청크 해시·DLP 지문은 침묵한다.', C.bad],
    ['2단이라 값싸다', 'MinHash/LSH가 ms 단위로 후보를 좁히고, 의미 판정은 후보에만. 본문은 저장하지 않고 지문(단방향)만 남긴다.', C.navy],
    ['설명할 수 있다', '해시 배열·슁글 벤 다이어그램·청크 연결·포함률을 그대로 보여 주므로 운영자가 판정 근거를 눈으로 확인한다.', C.ok]
  ]
  pts.forEach(([h, b, col], i) => {
    const y = 1.5 + i * 1.3
    s.addShape(pres.ShapeType.roundRect, { x: 10.15, y, w: 2.55, h: 1.18, fill: { color: C.light }, line: { color: col, width: 1 }, rectRadius: 0.08 })
    s.addText(h, { x: 10.27, y: y + 0.07, w: 2.3, h: 0.32, fontFace: F, fontSize: 12, bold: true, color: col, isTextBox: true, margin: 0 })
    s.addText(b, { x: 10.27, y: y + 0.4, w: 2.3, h: 0.75, fontFace: F, fontSize: 8.5, color: C.ink, valign: 'top', isTextBox: true, margin: 0 })
  })
  s.addShape(pres.ShapeType.roundRect, { x: 6.85, y: 4.55, w: 3.1, h: 2.15, fill: { color: C.navy }, line: { color: C.navy }, rectRadius: 0.08 })
  s.addText([
    { text: '왼쪽 화면 읽는 법', options: { bold: true, color: C.white, breakLine: true, fontSize: 11 } },
    { text: '① 해시 상이 — 바이트가 다른 두 파일', options: { color: 'E5E7EB', breakLine: true, fontSize: 9 } },
    { text: '② 해시 배열 128칸 중 7칸 일치, 벤 다이어그램 공통 슁글 21개 → 5%', options: { color: 'E5E7EB', breakLine: true, fontSize: 9 } },
    { text: '③ 청크 연결 코사인 0.908, 판정 "재작성(같은 내용, 다른 표현)"', options: { color: 'E5E7EB', breakLine: true, fontSize: 9 } },
    { text: '오른쪽 위: 원장 검색은 후보를 사분면에 놓아 동일·수정본 / 재작성 / 무관을 한눈에 가른다', options: { color: 'E5E7EB', fontSize: 9 } }
  ], { x: 6.97, y: 4.62, w: 2.9, h: 2.0, fontFace: F, valign: 'top', isTextBox: true, margin: 0 })
  s.addText('demo/2_재작성본_자카드낮음_의미높음 (한글 txt) 실측 · 원장 검색은 sample/ 개인정보처리방침_v4.docx', { x: 0.6, y: 6.5, w: 6.0, h: 0.3, fontFace: F, fontSize: 8.5, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 15. 성능 — MinHash · docsim (시간·공간) — 그래프와 저장 공간 산출
{
  const s = base()
  title(s, '성능 — 시간은 O(n)과 O(청크)의 두 곡선, 공간은 "정부 1억 문서"로 환산', '왼쪽: 본문 크기별 지문 계산 시간(로그 눈금, 실측+외삽) · 오른쪽: 원본 대비 저장 공간')
  // ── 왼쪽: 시간 곡선 (로그 축). 실측(5KB·50KB)에서 선형 외삽.
  const sizes = ['5 KB', '50 KB', '500 KB', '5 MB']
  // 네이티브 차트는 Keynote 등 일부 뷰어가 로그축을 못 읽어 비어 보인다 → 이미지로 넣는다(chart.html → timechart.png).
  s.addImage({ path: 'timechart.png', x: 0.6, y: 1.5, w: 6.3, h: 6.3 * 1720 / 2520 })
  s.addText('해석: 글자 지문은 5MB 문서도 1초 미만. 의미 지문은 청크 수에 비례해 수십 초 → 후보 상위 N건에만 쓴다. 지문끼리 비교는 79 ns(MinHash)·0.2 s(docsim)로 둘 다 즉시.', { x: 0.6, y: 5.85, w: 6.3, h: 0.7, fontFace: F, fontSize: 9.5, color: C.muted, isTextBox: true, margin: 0 })

  // ── 오른쪽: 저장 공간 자(尺). 가정: 정부 누적 전자문서 1억 건, 원본 평균 500 KB, 본문 텍스트 평균 20 KB(≈청크 20개).
  const bx = 7.3, bw = 5.4, by = 1.9
  s.addText('저장 공간 — 정부 누적 전자문서 1억 건을 모두 등록한다면', { x: bx, y: 1.5, w: bw, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.navy, isTextBox: true, margin: 0 })
  const bars = [
    ['원본 문서 자체 (평균 500 KB)', 50, '50 TB', C.line, C.ink],
    ['의미 지문 docsim 讀心 (전 문서, 30 KB/건)', 3, '3 TB · 원본의 6%', C.warn, C.white],
    ['의미 지문 양자화·S/C 등급만 (2.3 KB/건 평균)', 0.23, '0.23 TB', 'D9B45A', C.ink],
    ['원장 행 + 라벨 DER (2.5 KB/건)', 0.25, '0.25 TB', C.navy, C.white],
    ['MinHash 시그니처 + LSH 버킷 (3.5 KB/건)', 0.35, '0.35 TB', '4C69A3', C.white]
  ]
  bars.forEach(([label, tb, txt, fill, ink], i) => {
    const y = by + i * 0.78
    s.addText(label, { x: bx, y, w: bw, h: 0.24, fontFace: F, fontSize: 9, color: C.muted, isTextBox: true, margin: 0 })
    const w = Math.max(0.12, (tb / 50) * bw)
    s.addShape(pres.ShapeType.roundRect, { x: bx, y: y + 0.26, w, h: 0.34, fill: { color: fill }, line: { color: fill }, rectRadius: 0.04 })
    s.addText(txt, { x: w > 2.5 ? bx + 0.12 : bx + w + 0.1, y: y + 0.26, w: 3.6, h: 0.34, fontFace: F, fontSize: 10, bold: true, color: w > 2.5 ? ink : C.ink, valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addShape(pres.ShapeType.roundRect, { x: bx, y: 5.85, w: bw, h: 0.7, fill: { color: C.okSoft }, line: { color: C.ok, width: 0.75 }, rectRadius: 0.06 })
  s.addText([
    { text: '원장 + 글자 지문 = 0.6 TB, 원본의 1.2%. ', options: { bold: true, color: C.ok } },
    { text: '의미 지문까지 전부 넣어도 3.6 TB(7%). 등급별 선택 발급·양자화면 0.8 TB(1.7%) — PostgreSQL 한 대 범위.', options: { color: C.ink } }
  ], { x: bx + 0.12, y: 5.88, w: bw - 0.24, h: 0.64, fontFace: F, fontSize: 9.5, valign: 'middle', isTextBox: true, margin: 0 })
  s.addText([
    { text: '규모별 환산(건당 비용 × 건수)  ', options: { bold: true, color: C.navy, fontSize: 9 } },
    { text: '1천만 건: 원장+글자 지문 60 GB · 의미 지문 0.3 TB (원본 5 TB)   |   1억 건: 0.6 TB · 3 TB (50 TB)   |   10억 건: 6 TB · 30 TB (500 TB). 기관 실제 보유량을 대입하면 그대로 계산된다.', options: { color: C.ink, fontSize: 9 } }
  ], { x: 0.6, y: 6.6, w: 12.1, h: 0.4, fontFace: F, isTextBox: true, margin: 0 })
}

// ───────────────────────── 17. 평가 기준 상세 (정성)
{
  const s = base()
  title(s, '평가 기준 상세 — 환경 대응성 · 제품 적용 가능성 · 독창성의 근거', '"설명할 수 있는가"보다 "실제로 동작하는가": 각 항목의 실동작 근거')
  card(s, 0.6, 1.55, 3.9, 3.55, '다양한 환경 대응성 (15)', [
    '외부 채널 생존: 태그가 OS 메타가 아닌 파일 내용에 서명으로 결속 → 복사·압축·메일·웹 업로드·타 OS에서 유지',
    '예외 대응: 미등재 형식은 자동 사이드카, 실행파일은 정책상 사이드카 고정',
    '오프라인: PWA가 신뢰목록·체크포인트를 캐시해 원장 없이 L1 검증. "접속 불가"와 "미등록"을 구분',
    '변환·재저장: docx→pdf 100%, Pages 재저장본 텍스트 해시 재식별',
    '기관 경계: 5기관 발급, 협정 번역·만료·C등급 차단'
  ], { size: 10.5 })
  card(s, 4.7, 1.55, 3.9, 3.55, '제품 적용 가능성 (10)', [
    'innoECM 훅 지점: 저장·체크인 이벤트 → 발급 API(멱등키), 새 버전 → --parent 자동 선언',
    'innoAI 결합 지점: 등급분류 결과를 grade·basisKeywords로 공급하는 인터페이스 확보',
    '게이트 연동: Gate SDK·REST 명세(openapi.yaml), verdictHint 참고값 원칙',
    '운영: PostgreSQL append-only, 마이그레이션 7단계, 관리콘솔, 감사 이력',
    '보안 전제: 본문 미전송·미저장, 원장 PII 미기록(가명 ID 원칙), KCMVP 교체 인터페이스'
  ], { size: 10.5 })
  card(s, 8.8, 1.55, 3.9, 3.55, '기술 독창성 · 확장성 (10)', [
    '단일 기법(ADS·임베딩·해시 DB)의 실패 지점을 상호 보완: 위조는 서명이, 유실은 원장이, 변형은 지문·의미가 받는다',
    '선언적 계보(parentHash, 1.0)와 관찰적 계보(지문·의미, <1)의 이중 구조와 신뢰도 분리',
    '여권 모델: 기관 간 등가성 협정으로 등급을 번역, 발급 기관 원장이 폐기의 진실원천',
    '게이트 관측 로그: 원장(발급 사실)과 분리해 기관 간 이동·판정을 기록 → 스탬프·흐름 가시화',
    '확장: 모델 B 기관별 서버 실연합, 구조 지문, OCR, 워터마크 훅'
  ], { size: 10.5 })
  // 근거 캡처: 협정 없음 결과 카드 · 기관 지도 · 기관 간 흐름 · 전체 그래프
  s.addText('근거 캡처 — 협정 없음 판정 · 기관 지도 · 여권 스탬프/산키 · 원장 그래프 (15·16쪽 확대)', { x: 0.6, y: 5.22, w: 12, h: 0.25, fontFace: F, fontSize: 9.5, bold: true, color: C.muted, isTextBox: true, margin: 0 })
  s.addImage({ path: 'card.png', x: 0.6, y: 5.5, w: 3.6, h: 3.6 * 330 / 850 })
  s.addImage({ path: 'passport.png', x: 4.35, y: 5.5, w: 1.7, h: 1.7 * 740 / 900 })
  s.addImage({ path: 'stamps.png', x: 6.2, y: 5.5, w: 2.74, h: 2.74 * 460 / 900 })
  s.addImage({ path: 'graph.png', x: 9.1, y: 5.5, w: 2.25, h: 2.25 * 560 / 900 })
}

// ───────────────────────── 17. 한계
{
  const s = base()
  title(s, '한계 — 현재 PoC에서 지원하지 않는 조건', '요강 5.1 "한계 및 제품 적용방안" ①')
  table(s, [
    ['조건', '상태', '대응·비고'],
    ['스캔 문서·이미지의 내용 식별', NO, 'OCR·지각 해시(pHash) 미지원. docsim 讀心의 OCR 폴백 결합으로 해소 예정'],
    ['DOCX 구조 Fingerprint', NO, '텍스트·의미 지문이 대체. 로드맵'],
    ['한글 본문 PDF 텍스트 추출', PART, '폰트 인코딩에 따라 제한. ASCII 실측 완료, 추출기 보강 필요'],
    ['한컴·MS Office 재저장 시 내장 라벨 보존', PART, 'Pages 실측 소실. 텍스트 해시가 재식별·복원 보장. 앱별 실측은 동일 스크립트로 수행'],
    ['암호화·워터마크 정책 실행', PART, '라벨에 자리만 확보. 실행부는 게이트·뷰어 측 개발 필요'],
    ['실시간 자동 태깅(저장 시점 후킹)', NO, 'CLI·웹 수동 발급. ECM 이벤트 연동으로 해결'],
    ['기관별 서버·키 분리(실연합)', PART, '모델 A(단일 서버 페르소나)로 정책 시뮬레이션. 모델 B(원장 원격 조회)는 로드맵'],
    ['등급 표기', PART, 'N2SF(C=비밀·S=민감·O=공개)를 따랐다. 공모 아키텍처 그림의 C(일반)/O(기밀) 표기와 반대이므로 주관 기준 확인 후 표기만 맞추면 된다']
  ], 0.6, 1.55, 12.1, [3.4, 1.1, 7.6], { size: 10.5, rowH: 0.5 })
}

// ───────────────────────── 18. 제품 적용 방안
{
  const s = base()
  title(s, '제품 적용 방안 — innoAI / innoECM 적용 시 추가 개발', '요강 5.1 "한계 및 제품 적용방안" ②')
  const items = [
    ['1 innoECM 이벤트 훅', '저장·체크인 이벤트 → 자동 발급(File ID·등급·Tag를 ECM 메타에서 공급), 새 버전 → --parent 자동 선언'],
    ['2 엔드포인트 에이전트', '반출 경로(USB·메일·메신저) 훅에서 Gate SDK 호출. 검증 API는 완비, 에이전트 측만 개발'],
    ['3 innoAI 결합', '등급분류 AI 판정을 발급 요청의 grade·근거 필드로 공급. AI 업로드 게이트에서 라벨 검증 후 반입 통제'],
    ['4 암호모듈 제품화', '개발용 키스토어 → KCMVP 검증필 모듈·HSM 교체(인터페이스 분리 완료), GPKI 연동'],
    ['5 포맷 내장 고도화', 'HWP CFB 내부 스트림·OOXML customXml 파트 삽입(재저장 보존 실측 병행), PDF 증분 갱신'],
    ['6 모델 B 실연합', '기관별 서버·키 분리, 신뢰목록에 원장 URL, 발급 기관 원장 원격 조회(폐기 진실원천)'],
    ['7 식별 확장', 'OCR·이미지 지문(pHash), DOCX 구조 지문, 워터마크 삽입 훅, 대량 소급 태깅 영속 큐']
  ]
  items.forEach(([h, b], i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15, y = 1.55 + row * 1.3
    card(s, x, y, 5.95, 1.15, h, b, { size: 10.5 })
  })
}

// ───────────────────────── 19. 선택 제출 항목
{
  const s = base()
  title(s, '선택 제출 항목 (요강 5.2)', '특허 요소 · 성능 · 정확도 비교 · 차별점 · 외부 채널 · UI/관리콘솔')
  const items = [
    ['특허 가능 기술요소', '3건 — 원장 기반 폴백 검증 · 등가성 협정 상호 인정 · 선언적+관찰적 이중 계보. 상세는 비공개 별지(제출물 미포함, 출원 전 마킹)'],
    ['성능 측정 결과', '발급 7.8ms · 검증 3.2ms · 지문 후보 1.1ms(p95 1.4ms). docsim 讀心 정밀 판정 약 3초(모델 로드 포함)'],
    ['정확도 비교표', '글자 지문(MinHash) vs 의미 지문(docsim): 국소 수정은 둘 다, 재작성은 의미만(자카드 5% / 의미 0.91), 무관은 둘 다 낮음. 17·18쪽'],
    ['기존 방식 대비 차별점', 'ADS/xattr: 외부 채널에서 소멸 → 포맷 내장으로 대체. 해시 DB 단독: 수정본 못 잡음 → 지문·의미 결합. 임베딩 단독: 위조 못 막음 → 서명·원장 결합'],
    ['추가 외부 채널 대응', '포맷 내장 라벨이 메일·클라우드·메신저 경유 후에도 동행. 기관 간 전달을 관측 로그로 기록하고 협정으로 등급 번역'],
    ['UI / 관리콘솔', '웹 7메뉴: 대시보드 · 키 관리 · 생성/폐기 · 원장(6화면) · 검증(수신함·보내기·복원·위조 시연) · 유사도 테스트(해시·자카드·의미 시각화) · 도움말']
  ]
  items.forEach(([h, b], i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.6 + col * 4.1, y = 1.55 + row * 2.6
    card(s, x, y, 3.9, 2.4, h, b, { size: 10 })
    const thumb = { 1: ['timechart.png', 2520, 1720], 2: ['simpair.png', 850, 700], 5: ['passport.png', 900, 740] }[i]
    if (thumb) {
      const th = 1.0, tw = th * thumb[1] / thumb[2]
      s.addImage({ path: thumb[0], x: x + 3.9 - tw - 0.12, y: y + 2.4 - th - 0.1, w: tw, h: th })
    }
  })
}

// ───────────────────────── 21. 비즈니스 모델 — 청크 해시 방식 대비 우리만 가능한 것
{
  const s = base()
  title(s, '비즈니스 모델 — 청크 해시가 못 하는 여섯 가지가 곧 상품이다', '청크 해시는 "같은 파일인가"까지, 우리는 "누구의 어떤 등급 문서가 어디까지 갈 수 있나"까지. 그 여섯 가지가 파일 → 조직 → 기관 간 → 국가 → 국가 간으로 같은 구조로 확장된다')
  // 왼쪽: 비교 대상
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.55, w: 3.0, h: 4.15, fill: { color: 'F1F1F1' }, line: { color: C.muted, width: 0.75 }, rectRadius: 0.08 })
  s.addText('단일 파일 청크 해시 방식', { x: 0.75, y: 1.65, w: 2.7, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: C.ink, isTextBox: true, margin: 0 })
  s.addText('(파일·청크 SHA/롤링 해시 색인, DLP 지문 DB)', { x: 0.75, y: 1.98, w: 2.7, h: 0.3, fontFace: F, fontSize: 9, color: C.muted, isTextBox: true, margin: 0 })
  s.addText(bullets([
    { text: '할 수 있는 것', bold: true, bullet: false, color: C.ok },
    '동일·유사 파일 탐지 (한 시스템 안)',
    '중복 제거·저장 절약',
    { text: '구조적으로 못 하는 것', bold: true, bullet: false, color: C.bad },
    '해시는 누구나 만든다 → 등급·태그를 결속·증명 못 함',
    '"같음"만 안다 → 폐기·등급변경·파기를 모름',
    '재작성본은 남남 (글자 겹침 5%)',
    '상대 기관 해시 DB에 접근 불가, 등급 체계도 다름',
    '유실된 라벨을 되살릴 원본이 없음'
  ], 9.5), { x: 0.75, y: 2.3, w: 2.7, h: 3.3, fontFace: F, valign: 'top', isTextBox: true, margin: 0 })
  // 화살표
  s.addShape(pres.ShapeType.rightArrow, { x: 3.68, y: 3.3, w: 0.42, h: 0.6, fill: { color: C.navy }, line: { color: C.navy } })
  // 오른쪽: 우리만 가능한 6가지 (2행 × 3열)
  const tiles = [
    ['① 위조 불가 귀속', '기관 키 서명 라벨에 File ID·등급·Tag를 결속. 1바이트 변조도 invalid. 게이트가 복호화 없이 등급을 읽는다.', '1단 · innoECM 애드온'],
    ['② 유실 후 복원', '원장이 라벨 원본을 보관 → 해시·텍스트 해시로 회수(완전 복원), 수정본은 등급·Tag를 상속한 새 라벨(재수화).', '1·2단 · 라이선스'],
    ['③ 폐기·등급변경의 진실원천', '불변 원장의 REVOKE·REGRADE·DESTROY가 사본 유통을 막는 근거. "같은 파일"이어도 지금 유효한지를 답한다.', '2단 · 게이트 SDK'],
    ['④ 계보 + 감사', 'parentHash 선언 계보와 지문 관찰 계보, 해시체인·머클 봉인, 관측 로그 → 이동·수정·변환 이력이 증거가 된다.', '2단 · 관리콘솔'],
    ['⑤ 의미 재식별', '글자 지문(MinHash)이 놓치는 재작성본을 docsim 讀心이 의미 0.91로 되찾는다. 본문은 저장하지 않는다.', '2단 · 의미 엔진 옵션'],
    ['⑥ 기관·국가 간 상호인정', 'CA 교환 + 등가성 협정 번역표(gradeMap). 발급 기관 원장이 폐기의 진실원천이라 중앙 집중 없이 기관·국가를 더한다.', '3·4·5단 · 연합 서비스']
  ]
  tiles.forEach(([h, body, tier], i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 4.25 + col * 2.9, y = 1.55 + row * 2.12
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.75, h: 1.98, fill: { color: C.light }, line: { color: C.line, width: 0.75 }, rectRadius: 0.08 })
    s.addText(h, { x: x + 0.12, y: y + 0.08, w: 2.5, h: 0.32, fontFace: F, fontSize: 11.5, bold: true, color: C.navy, isTextBox: true, margin: 0 })
    s.addText(body, { x: x + 0.12, y: y + 0.42, w: 2.5, h: 1.2, fontFace: F, fontSize: 9, color: C.ink, valign: 'top', isTextBox: true, margin: 0 })
    s.addText(tier, { x: x + 0.12, y: y + 1.62, w: 2.5, h: 0.28, fontFace: F, fontSize: 9, bold: true, color: C.ok, isTextBox: true, margin: 0 })
  })
  // 아래: 확장 리본 (같은 구조로 5단)
  const steps = [['1 파일', '단일 라벨', C.navy], ['2 조직 내', 'ECM·게이트·원장', '2A3F6B'], ['3 기관 간', '여권 — 협정·신뢰목록', '3B5487'], ['4 국가 체계', 'N2SF 공통 등급·공증', '4C69A3'], ['5 국가 간', '비자 협정 — CA 교환·번역표', '5D7BB8']]
  steps.forEach(([h, b, col], i) => {
    const x = 0.6 + i * 2.44
    s.addShape(pres.ShapeType.chevron, { x, y: 5.9, w: 2.5, h: 0.8, fill: { color: col }, line: { color: C.white, width: 1 } })
    s.addText(h, { x: x + 0.3, y: 5.95, w: 2.0, h: 0.32, fontFace: F, fontSize: 11, bold: true, color: C.white, isTextBox: true, margin: 0 })
    s.addText(b, { x: x + 0.3, y: 6.27, w: 2.0, h: 0.4, fontFace: F, fontSize: 9, color: 'E5E7EB', isTextBox: true, margin: 0 })
  })
  s.addText('①②는 1단에서, ③④⑤는 2단에서 수익이 되고, ⑥이 3~5단(기관 연합·국가 신뢰 서비스·국제 상호인정)을 연다. PoC는 3단까지 실동작, 4·5단은 협정 데이터(CA·번역표)만 추가하면 같은 코드로 동작한다.', { x: 0.6, y: 6.72, w: 12.1, h: 0.3, fontFace: F, fontSize: 9, color: C.muted, isTextBox: true, margin: 0 })
}

// ───────────────────────── 22. 실행 방법
{
  const s = base()
  title(s, '실행 방법 · 재현 절차 (심사용)', '요강 5.1 구현 설명서 "실행방법" — macOS/Linux, Go 1.22+, Docker(PostgreSQL 16), Node 18+')
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.55, w: 7.4, h: 4.7, fill: { color: C.navy }, line: { color: C.navy }, rectRadius: 0.08 })
  s.addText([
    { text: '# 1) 데모 스택 (PostgreSQL 영속 원장 + 서버 :8090, 5기관 발급·협정 로드)', options: { color: 'C3CAD6', breakLine: true } },
    { text: 'cd ledgermarker && ./deploy/run-demo.sh        # --reset: 빈 원장으로', options: { breakLine: true } },
    { text: '', options: { breakLine: true } },
    { text: '# 2) 필수 시연 8단계 자동 실행 (파일 생성부터 재현)', options: { color: 'C3CAD6', breakLine: true } },
    { text: './scripts/poc-demo.sh', options: { breakLine: true } },
    { text: '', options: { breakLine: true } },
    { text: '# 3) 자동 테스트 7패키지 (수용 기준 T1~T13, 정확도, 협정, 관측, 샘플 로더)', options: { color: 'C3CAD6', breakLine: true } },
    { text: 'go test ./...', options: { breakLine: true } },
    { text: '', options: { breakLine: true } },
    { text: '# 4) 웹 관리콘솔 (원장 6화면·검증·유사도 테스트)', options: { color: 'C3CAD6', breakLine: true } },
    { text: 'cd verify-pwa && npm install && LM_PROXY_TARGET=http://localhost:8090 npm run dev', options: { breakLine: true } },
    { text: '', options: { breakLine: true } },
    { text: '# 5) 샘플·시연 세트', options: { color: 'C3CAD6', breakLine: true } },
    { text: '원장 메뉴 "샘플 파일 로딩(기능테스트)" → 24개 파일·5기관·이벤트·기관 간 기록', options: { breakLine: true } },
    { text: 'demo/ 폴더: 유사도 테스트 케이스 3종(수정본·재작성본·무관, txt·md·docx·pdf)', options: {} }
  ], { x: 0.8, y: 1.7, w: 7.0, h: 4.4, fontFace: 'Courier New', fontSize: 10.5, color: C.white, valign: 'top', isTextBox: true, margin: 0 })
  card(s, 8.3, 1.55, 4.4, 2.2, '기관 간 전달 시연 (CLI)', ['lm send <파일> --as KPOST --to INNOTIUM --copy-to inbox/', 'lm receive inbox/<파일> --as INNOTIUM', '웹: 결과 카드 "타 기관으로 보내기" → 기관 전환 → 수신함 "게이트 검증"'], { size: 10 })
  card(s, 8.3, 3.95, 4.4, 2.3, '제출물 구성', ['소스 전체(git) + 이 발표자료 + 비공개 별지(특허, 미포함)', '오픈소스 사용내역 5쪽 · 실행 환경 요구사항 상단', '시연 영상·화면은 웹 http://localhost:5173 실시간'], { size: 10 })
}

// ───────────────────────── 21. 마무리
{
  const s = base({ dark: true })
  s.addText('요약', { x: 0.8, y: 0.6, w: 6, h: 0.5, fontFace: F, fontSize: 16, color: 'C3CAD6', isTextBox: true, margin: 0 })
  s.addText('라벨이 사라져도 문서의 신원은 사라지지 않는다', { x: 0.8, y: 1.1, w: 11.7, h: 0.9, fontFace: F, fontSize: 30, bold: true, color: C.white, isTextBox: true, margin: 0 })
  const pts = [
    ['동작한다', '필수 8종 + 위조 4종 + 기관 간 4종 실동작, 스크립트 하나로 재현, 자동 테스트 7패키지'],
    ['정확하다', '복사·개명·이동·변환 100%, 국소 수정 0.77~0.86, 재작성 의미 0.91, 무관 오탐 0'],
    ['환경을 넘는다', 'OS 메타가 아닌 파일 내용에 결속, 오프라인 검증, 재저장 생존, 5기관 협정 번역·차단'],
    ['제품에 붙는다', 'REST·SDK·관리콘솔·교체 가능한 암호모듈, innoECM/innoAI 훅 지점 정의, 로드맵 7항']
  ]
  pts.forEach(([h, b], i) => {
    const y = 2.3 + i * 1.05
    s.addShape(pres.ShapeType.roundRect, { x: 0.8, y, w: 11.7, h: 0.9, fill: { color: '2A3F6B' }, line: { color: '3B5487', width: 0.75 }, rectRadius: 0.08 })
    s.addText(h, { x: 1.0, y: y + 0.12, w: 2.4, h: 0.65, fontFace: F, fontSize: 16, bold: true, color: C.white, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(b, { x: 3.4, y: y + 0.12, w: 8.9, h: 0.65, fontFace: F, fontSize: 12.5, color: 'E5E7EB', valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addText('LedgerMarker v2.71 · docsim 讀心 결합 · 문의: [부서명] (이름)', { x: 0.8, y: 6.55, w: 11.7, h: 0.4, fontFace: F, fontSize: 12, color: 'C3CAD6', isTextBox: true, margin: 0 })
}


// ───────────────────────── 부록 A. 주요 API
{
  const s = base()
  title(s, '부록 A. 주요 API — 질의응답용', 'REST 명세 api/openapi.yaml · Go Gate SDK sdk/go · 비공개 엔드포인트는 X-LM-Key')
  table(s, [
    ['API', '용도', '비고'],
    ['POST /v1/labels', '발급 — 해시·지문·부착 방식 접수 (파일 미전송)', 'Idempotency-Key 필수 · issuerOrg 로 5기관 선택'],
    ['POST /v1/verify', '검증 5항목(서명·원장·폐기·기간·협정) 개별 판정', 'verifierOrg 가 발급 기관과 다르면 협정 번역(L3)'],
    ['POST /v1/identify', '지문 유사도 재식별 (수정본·변환본·재작성)', 'text 를 주면 서버가 docsim 讀心 판정까지 채움'],
    ['POST /v1/compare', '두 본문의 MinHash 자카드 + 의미 유사도 (유사도 테스트 화면)', '슁글 집합·시그니처 일치 마스크까지 반환'],
    ['GET /v1/labels/by-hash/{hash}', '라벨 원본 회수 — 완전 복원·정책 재적용', '?kind=text 로 텍스트 해시 조회'],
    ['POST /v1/restore', '정체성 복원 사다리 — 해시→텍스트 해시→지문, apply 시 상속 라벨 발급', '0.70 미만은 review 로 반환'],
    ['GET /v1/documents/{id}/lineage', '파생 계보 그래프(DAG)', 'depth·direction'],
    ['POST/GET /v1/observations', '게이트 관측 로그 — 기관 간 SENT·VERIFIED', '원장과 분리된 추가 전용 로그'],
    ['GET /v1/ledger/events · /ledger/verify · /checkpoints', '감사 이력 · 해시체인 점검 · 봉인 목록', '관리콘솔 6화면의 데이터'],
    ['POST /v1/labels/{id}/revoke · regrade · destroy', '폐기 · 등급변경(승인 토큰) · 파기(심의 토큰)', '삭제가 아니라 이벤트 행 추가'],
    ['GET /v1/treaties · /trust/list · /formats', '협정 · 신뢰목록 · 포맷 카탈로그(단일 진실원천)', '공개, PWA 캐시 대상'],
    ['POST /v1/admin/load-samples', '샘플 일괄 발급(기능 테스트) — 24파일·이벤트·관측', '멱등']
  ], 0.6, 1.5, 12.1, [3.6, 5.2, 3.3], { size: 9.5, rowH: 0.4 })
}

// ───────────────────────── 부록 B. 자동 테스트 대응표
{
  const s = base()
  title(s, '부록 B. 자동 테스트 대응표 — go test ./... 7패키지', 'DEV SPEC 수용 기준 T1~T13 + 이번 PoC 추가 항목. 전부 통과(2026-09-25)')
  table(s, [
    ['ID', '검증 내용', '위치', '결과'],
    ['T1', '라벨 등급 1바이트 변조 → 서명 무효 탐지', 'internal/issue/issue_test.go', OK],
    ['T2', '원장 UPDATE/DELETE 를 DB 트리거·권한이 거부', 'internal/store/pg_integration_test.go (PG)', OK],
    ['T3', '슈퍼유저 강제 조작 후 체인 점검이 조작 seq 지목', 'internal/ledger/hash_test.go · server_test.go', OK],
    ['T4~T8', '폴백 검증 · 오프라인(접속 불가≠미등록) · 키 유출 규칙 · 폐기 키 위조', 'internal/verify/verify_test.go', OK],
    ['T9~T13', '등급 하향 승인 · 멱등 발급(행 1개) · 3세대 계보 · 미등재 포맷 폴백', 'internal/server/server_test.go', OK],
    ['A1~A7', '지문 정확도 곡선(서식·변환·국소 수정·무작위 치환·무관 30종)', 'internal/fingerprint/accuracy_test.go', OK],
    ['Golden', '행 해시 직렬화 · 정규화 골든값(기존 원장 체인 보호)', 'internal/ledger · internal/attach', OK],
    ['L3', '협정 번역 · 협정 없음 · 만료 · C등급 번역 불가', 'internal/server/federation_test.go', OK],
    ['Obs', '관측 로그 기록·조회 · 봉인 목록', 'federation_test.go', OK],
    ['Samples', '샘플 로더 멱등성(두 번 실행해도 행 중복 없음)', 'federation_test.go', OK],
    ['Compare', '/v1/compare 동일·수정·무관 텍스트', 'server_test.go', OK],
    ['Bench', 'MinHash 지문 0.65 ms/5KB · 버킷 6.6 µs · 비교 79 ns', 'internal/fingerprint/bench_test.go', OK]
  ], 0.6, 1.5, 12.1, [1.1, 5.6, 4.2, 1.2], { size: 9.5, rowH: 0.38 })
}

// ── 발표자 노트: 슬라이드 순서대로(이미 노트가 있는 장은 유지)
const NOTES = [
"표지. 한 문장: ECM 밖으로 나간 파일도 서명 라벨과 불변 원장, 4단 재식별로 신원을 되찾는다. 오늘 시연은 스크립트 하나로 8단계를 재현한다.",
"제출 세트 5개가 모두 이 자료 안에 있다. 오른쪽 카드의 쪽 번호로 심사 항목을 바로 찾을 수 있다. 3쪽 스토리와 4쪽 평가표를 먼저 보시라.",
"문서 하나가 겪는 여덟 가지 일. 각 칸의 초록 글씨가 실측 결과이고 13·14쪽에 캡처가 있다. 핵심은 어느 단이 깨져도 다음 단이 받는다는 것.",
"심사표와 같은 구조. 실제 동작 40점은 8+4+4 시연과 재현 스크립트, 정확도 25점은 17~20쪽 실측, 환경 대응 15점은 15쪽 기관 간 전달과 오프라인 검증.",
"요강이 열거한 기술 8종 중 ADS/xAttr는 일부러 쓰지 않았다. 복사·메일·웹 업로드에서 사라지기 때문이다. 구조 지문만 미구현이고 텍스트·의미 지문이 대신한다.",
"구조. 파일 본문은 서버로 가지 않는다. 해시·지문·라벨만 오간다. docsim 讀心은 코드 수정 없이 서브프로세스로 결합했다. 불변식 4개가 설계의 기준.",
"전부 허용적 오픈소스. 사내 모듈은 docsim 하나. 암호모듈은 교체 가능한 인터페이스로 분리되어 KCMVP 모듈로 바꿀 수 있다. AI 코딩 보조를 썼지만 전체 동작을 설명·재현할 수 있다.",
"4단 사다리와 판정 기준. 정확 일치 단은 100%, 추정 단은 0.30 후보·0.70 자동 복원·사이는 운영자 확정. 선언적(1.0)과 관찰적(<1) 신뢰도를 분리 표시한다.",
"포맷별 부착과 두 가지 복원. 완전 복원은 원본 라벨 회수, 상속 복원은 수정본에 등급·Tag를 상속한 새 라벨 발급. 재저장 시 라벨이 사라져도 텍스트 해시가 보장.",
"파생 5유형 각각의 식별 경로와 실측값. 핵심 숫자는 국소 수정 0.77~0.86, 변환 100%, 재작성 자카드 5%인데 의미 0.91.",
"정책 7항목 중 5 충족, 암호화·워터마크는 자리만. 재식별이 '무엇인가'를 답하면 정책은 그 위에 얹힌다. 판정은 참고값이고 통과 여부는 게이트가 정한다.",
"필수 8종 전부 실동작. 최소 3개 요구를 넘긴다. 다음 두 쪽이 실제 출력 캡처.",
"poc-demo.sh 한 번의 실제 로그. ③ 라벨 제거 후 복원, ④ 지문 73%에서 의미 0.97 재작성 판정, ⑥ 재저장본 텍스트 해시 재식별, ⑧ 이노티움 협정 번역 allow.",
"위조 4종: 내용 변조·등급 위조·서명 변조는 서명 무효로 차단 권고, 라벨 제거는 원장 폴백으로 검토 권고 후 복원. 재저장 전후: 라벨은 사라지지만 텍스트 해시로 같은 docGuid.",
"기관 간 전달. 우정↔이노티움은 협정이 있어 S→S 번역·allow, 국세청은 협정 없음이라 서명만 확인·review, C등급은 번역 불가·deny. 원장 행은 늘지 않고 관측 로그만 쌓인다.",
"관리콘솔 6화면. 레인 차트는 seq×문서, 기관 지도는 협정·번역 매트릭스, 흐름은 스탬프와 산키. 모두 실제 원장 데이터.",
"정확도 표. 오른쪽 열이 같은 조건에서 청크 해시 방식이 어디까지 되는지. 형식 변환·흩뿌림 치환은 미식별이고, 식별돼도 등급·출처·폐기 여부는 모른다.",
"의미 판정 실측과 재저장 실측, 성능. 케이스 2가 핵심: 자카드 5%인데 의미 0.91. Pages 재저장은 H-1 ✗ H-4 ✗ H-5 ○.",
"유사도 테스트 화면. 세 잣대를 한 화면에서 본다. 재작성 유출은 의미 유사도만 잡는다. 운영자가 판정 근거를 눈으로 확인할 수 있다.",
"성능. 글자 지문은 5MB도 1초 미만, 의미 지문은 청크에 비례해 수십 초라 후보 상위 N건에만 쓴다. 저장 공간은 정부 1억 건 가정에 원장+지문 0.6 TB, 원본의 1.2%.",
"평가 항목 세 개의 실동작 근거. 아래 캡처는 15·16쪽의 확대.",
"한계를 숨기지 않는다. OCR·구조 지문·워터마크 미구현, 한글 PDF 추출 부분, 등급 표기는 N2SF를 따랐고 아키텍처 그림과 반대이므로 주관 기준 확인 예정.",
"innoAI/innoECM 적용 시 추가 개발 7항. 훅 지점은 이미 API로 정의되어 있다.",
"선택 제출 6항목. 특허 요소 3건은 비공개 별지로 분리.",
"비즈니스 모델. 청크 해시가 못 하는 여섯 가지가 상품이고, 파일→조직→기관 간→국가→국가 간으로 같은 구조로 확장된다. PoC는 3단까지 실동작.",
"실행 방법. run-demo.sh, poc-demo.sh, go test, 웹. 심사 환경에서 그대로 재현 가능.",
"마무리 네 줄: 동작한다, 정확하다, 환경을 넘는다, 제품에 붙는다.",
"부록 A. 질의응답용 API 목록.",
"부록 B. 자동 테스트 대응표. 전부 통과."
]

pres.slides.forEach((sl, i) => { if (NOTES[i] && !(sl._slideObjects || []).some((o) => o._type === 'notes')) sl.addNotes(NOTES[i]) })
pres.writeFile({ fileName: process.argv[2] || 'out.pptx' }).then((f) => console.log('written', f, 'slides', page))
