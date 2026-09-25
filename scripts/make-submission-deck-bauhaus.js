// LedgerMarker 공모 발표자료 — 바우하우스 판 (큰 글자 · 기하 도형 · 원색 · 기하학 서체)
// 숫자·라틴은 Century Gothic(Mac·Windows Office 공통), 한글은 East Asian 서체로 Apple SD Gothic Neo(후처리 pptx-fix-ea-font.py)
const pptxgen = require('pptxgenjs')

const K = { black: '111111', ink: '1A1A1A', gray: '5E5E5E', line: 'D9D5CC', paper: 'F1EEE6', white: 'FFFFFF',
  red: 'D7263D', yellow: 'F2C230', blue: '1E4FA3', redSoft: 'F9D9DE', yellowSoft: 'FBEFC6', blueSoft: 'D6E0F3' }
const F = process.env.DECK_FONT || 'Futura' // 바우하우스 시대의 기하학 서체. macOS 기본 탑재, Windows는 대체 서체
const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5
pres.title = 'innoAI Persistent Tagging PoC 공모 제안 — LedgerMarker'

let page = 0
function base(opts = {}) {
  const s = pres.addSlide()
  page++
  s.background = { color: opts.dark ? K.black : K.white }
  if (!opts.noFooter) {
    s.addText('LedgerMarker', { x: 0.6, y: 6.98, w: 4, h: 0.35, fontFace: F, fontSize: 11, bold: true, color: opts.dark ? K.white : K.black, isTextBox: true, margin: 0 })
    s.addShape(pres.ShapeType.ellipse, { x: 12.15, y: 6.85, w: 0.58, h: 0.58, fill: { color: opts.dark ? K.yellow : K.black }, line: { color: opts.dark ? K.yellow : K.black } })
    s.addText(String(page), { x: 12.15, y: 6.85, w: 0.58, h: 0.58, fontFace: F, fontSize: 14, bold: true, color: opts.dark ? K.black : K.white, align: 'center', valign: 'middle', isTextBox: true, margin: 0 })
  }
  return s
}
// 제목 + 기하 표식(원·정사각·삼각 중 하나, 장마다 색 순환)
const MOTIF = [[K.red, 'ellipse'], [K.blue, 'rect'], [K.yellow, 'triangle']]
function title(s, t, sub, size = 30) {
  const [col, shape] = MOTIF[page % 3]
  s.addShape(pres.ShapeType[shape], { x: 0.6, y: 0.42, w: 0.5, h: 0.5, fill: { color: col }, line: { color: col } })
  s.addText(t, { x: 1.3, y: 0.28, w: 11.4, h: 0.8, fontFace: F, fontSize: size, bold: true, color: K.black, valign: 'middle', isTextBox: true, margin: 0 })
  if (sub) s.addText(sub, { x: 1.3, y: 1.08, w: 11.4, h: 0.4, fontFace: F, fontSize: 14, color: K.gray, isTextBox: true, margin: 0 })
}
function bullets(items, size = 14, color = K.ink) {
  return items.map((t, i) => (typeof t === 'string'
    ? { text: t, options: { bullet: { code: '25A0' }, breakLine: i < items.length - 1, fontSize: size, color, paraSpaceAfter: 8 } }
    : { text: t.text, options: { bullet: t.bullet === false ? false : { code: '25A0' }, bold: !!t.bold, breakLine: i < items.length - 1, fontSize: t.size || size, color: t.color || color, paraSpaceAfter: 8 } }))
}
function textBox(s, x, y, w, h, items, size) {
  s.addText(bullets(items, size), { x, y, w, h, fontFace: F, valign: 'top', isTextBox: true, margin: 0.04 })
}
function card(s, x, y, w, h, head, body, opts = {}) {
  s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: opts.fill || K.paper }, line: { color: opts.fill || K.paper } })
  if (opts.tag) s.addShape(pres.ShapeType.rect, { x, y, w: 0.18, h, fill: { color: opts.tag }, line: { color: opts.tag } })
  s.addText(head, { x: x + 0.3, y: y + 0.14, w: w - 0.5, h: 0.45, fontFace: F, fontSize: opts.headSize || 16, bold: true, color: opts.headColor || K.black, isTextBox: true, margin: 0 })
  if (Array.isArray(body)) s.addText(bullets(body, opts.size || 12.5), { x: x + 0.3, y: y + 0.65, w: w - 0.5, h: h - 0.75, fontFace: F, valign: 'top', isTextBox: true, margin: 0 })
  else if (body) s.addText(body, { x: x + 0.3, y: y + 0.65, w: w - 0.5, h: h - 0.75, fontFace: F, fontSize: opts.size || 12.5, color: K.ink, valign: 'top', isTextBox: true, margin: 0 })
}
function stat(s, x, y, w, h, big, label, color = K.black) {
  s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: K.paper }, line: { color: K.paper } })
  s.addText(big, { x, y: y + 0.08, w, h: h * 0.6, fontFace: F, fontSize: 40, bold: true, color, align: 'center', valign: 'middle', isTextBox: true, margin: 0 })
  s.addText(label, { x: x + 0.1, y: y + h * 0.66, w: w - 0.2, h: h * 0.3, fontFace: F, fontSize: 12, color: K.gray, align: 'center', valign: 'top', isTextBox: true, margin: 0 })
}
function table(s, rows, x, y, w, colW, opts = {}) {
  const size = opts.size || 12
  const body = rows.map((r, ri) => r.map((c) => {
    const cell = typeof c === 'string' ? { text: c } : { ...c }
    cell.options = { fontFace: F, fontSize: size, color: K.ink, valign: 'middle', margin: 0.06, fill: { color: ri % 2 === 0 ? K.white : 'F7F5F0' }, ...(cell.options || {}) }
    if (ri === 0) cell.options = { ...cell.options, bold: true, color: K.white, fill: { color: K.black }, fontSize: size }
    return cell
  }))
  s.addTable(body, { x, y, w, colW, border: { type: 'solid', pt: 0.75, color: K.line }, rowH: opts.rowH || 0.42, autoPage: false })
}
// 표 위 핵심 한 줄 — 검은 띠에 흰 글씨
function keyMsg(s, text, y = 1.55) {
  s.addShape(pres.ShapeType.rect, { x: 0.6, y, w: 12.1, h: 0.52, fill: { color: K.black }, line: { color: K.black } })
  s.addText(text, { x: 0.8, y, w: 11.7, h: 0.52, fontFace: F, fontSize: 14, bold: true, color: K.white, valign: 'middle', isTextBox: true, margin: 0 })
}
const OK = { text: '충족', options: { bold: true, color: K.blue, align: 'center' } }
const PART = { text: '부분', options: { bold: true, color: 'B08900', align: 'center' } }
const NO = { text: '미구현', options: { bold: true, color: K.red, align: 'center' } }
const NA = { text: '미채택', options: { bold: true, color: K.gray, align: 'center' } }
const B = (t, c = K.blue) => ({ text: t, options: { bold: true, color: c } })
const G = (g) => ({ text: g, options: { bold: true, color: g === 'C' ? K.red : g === 'S' ? 'B08900' : K.blue, align: 'center' } })

// ───────────────────────── 1. 표지
{
  const s = base({ dark: true, noFooter: true })
  s.addShape(pres.ShapeType.ellipse, { x: 8.6, y: 0.9, w: 3.9, h: 3.9, fill: { color: K.red }, line: { color: K.red } })
  s.addShape(pres.ShapeType.rect, { x: 10.6, y: 4.3, w: 2.1, h: 2.1, fill: { color: K.blue }, line: { color: K.blue } })
  s.addShape(pres.ShapeType.triangle, { x: 7.9, y: 4.5, w: 2.4, h: 2.0, fill: { color: K.yellow }, line: { color: K.yellow } })
  s.addText('innoAI Persistent Tagging PoC 기술 공모', { x: 0.8, y: 0.9, w: 7.5, h: 0.5, fontFace: F, fontSize: 18, color: K.yellow, bold: true, isTextBox: true, margin: 0 })
  s.addText('Ledger\nMarker', { x: 0.8, y: 1.5, w: 7.5, h: 2.6, fontFace: F, fontSize: 84, bold: true, color: K.white, lineSpacingMultiple: 0.95, isTextBox: true, margin: 0 })
  s.addText('ECM 밖에서도 살아남는 문서 신원', { x: 0.8, y: 4.25, w: 7.5, h: 0.6, fontFace: F, fontSize: 26, bold: true, color: K.white, isTextBox: true, margin: 0 })
  s.addText('서명 라벨 · 불변 원장 · 4단 재식별 · 기관 간 협정 · docsim 讀心 결합', { x: 0.8, y: 4.9, w: 7.5, h: 0.5, fontFace: F, fontSize: 15, color: 'CFCFCF', isTextBox: true, margin: 0 })
  s.addText('[부서명]  ·  (이름)  ·  2026-09-30', { x: 0.8, y: 6.4, w: 7.5, h: 0.45, fontFace: F, fontSize: 15, color: K.white, isTextBox: true, margin: 0 })
  s.addNotes('표지. 한 문장: LedgerMarker는 관인(Marker)과 대장(Ledger)이다. 문서에 서명된 표식을 찍고 지울 수 없는 장부에 적어 두면, 표식이 떨어져 나가도 장부가 그 문서를 기억한다. 다음 장에서 이름 이야기를 1분간 풀고 시연 스토리로 넘어간다.')
}

// ───────────────────────── 2. 이름에 담긴 뜻 — 관인과 대장
{
  const s = base()
  title(s, '이름에 담긴 뜻 — 관인(Marker)과 대장(Ledger)', '옛 관청의 서기는 두 가지를 같이 했다. 문서에 관인을 찍고, 그 문서를 대장에 적는 일')
  s.addText('Ledger', { x: 0.6, y: 1.7, w: 3.6, h: 0.9, fontFace: F, fontSize: 44, bold: true, color: K.blue, isTextBox: true, margin: 0 })
  s.addText('지울 수 없는 장부', { x: 0.6, y: 2.55, w: 3.6, h: 0.4, fontFace: F, fontSize: 15, color: K.gray, isTextBox: true, margin: 0 })
  s.addText('Marker', { x: 0.6, y: 3.3, w: 3.6, h: 0.9, fontFace: F, fontSize: 44, bold: true, color: K.red, isTextBox: true, margin: 0 })
  s.addText('문서에 찍는 표식', { x: 0.6, y: 4.15, w: 3.6, h: 0.4, fontFace: F, fontSize: 15, color: K.gray, isTextBox: true, margin: 0 })
  s.addText('둘 중 하나만 하면 안 된다. 관인만 찍으면 누구나 베끼고, 대장에만 적으면 문서가 관청 문을 나서는 순간 인연이 끊긴다.', { x: 0.6, y: 4.75, w: 3.6, h: 1.5, fontFace: F, fontSize: 13, color: K.ink, isTextBox: true, margin: 0 })
  const blocks = [
    ['ellipse', K.red, 'Marker = 관인', 'File ID·등급·태그를 기관 서명으로 묶어 파일 안에 찍는다. 한 글자만 고쳐도 서명이 깨진다.'],
    ['rect', K.blue, 'Ledger = 대장', '발급 사실을 덧붙이기만 하고 절대 고치지 않는다. 관인이 떨어져도 대장이 문서를 기억한다.'],
    ['triangle', K.yellow, '여권 = 협정', '관인은 기관 안에선 신분증, 밖에선 여권. 등가성 협정이 있어야 다른 기관에서 통한다.'],
    ['ellipse', K.black, '讀心 = 뜻을 읽는 눈', '아예 다른 문장으로 다시 쓴 문서는 글자로 5%만 닮아도 뜻으로 같은 문서라고 말해 준다.']
  ]
  blocks.forEach(([shape, col, h, b], i) => {
    const x = 4.6 + (i % 2) * 4.15, y = 1.7 + Math.floor(i / 2) * 2.3
    s.addShape(pres.ShapeType.rect, { x, y, w: 3.95, h: 2.1, fill: { color: K.paper }, line: { color: K.paper } })
    s.addShape(pres.ShapeType[shape], { x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5, fill: { color: col }, line: { color: col } })
    s.addText(h, { x: x + 0.85, y: y + 0.15, w: 3.0, h: 0.6, fontFace: F, fontSize: 17, bold: true, color: K.black, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(b, { x: x + 0.2, y: y + 0.85, w: 3.55, h: 1.2, fontFace: F, fontSize: 12.5, color: K.ink, valign: 'top', isTextBox: true, margin: 0 })
  })
  keyMsg(s, '그래서 약속은 한 줄이다. 라벨이 사라져도 문서의 신원은 사라지지 않는다.', 6.3)
  s.addNotes('이름 이야기(1분). 옛 관청의 서기는 두 가지 일을 했다. 문서에 관인을 찍는 일과, 그 문서를 대장에 적는 일. 관인만 찍고 대장에 적지 않으면 도장 찍힌 종이는 누구나 베낄 수 있어 진위를 가릴 길이 없다. 대장에만 적고 관인을 찍지 않으면 문서가 관청 문을 나서는 순간 대장과 인연이 끊긴다. 둘을 같이 해야 문서가 어디로 가든 "이 문서가 무엇인지"를 되찾는다. LedgerMarker는 그 서기의 일을 파일에 옮긴 것이다. Marker는 관인 — File ID·등급·태그를 기관 서명으로 묶어 파일 안에 찍는다, 한 글자만 고쳐도 서명이 깨진다. Ledger는 대장 — 발급 사실을 덧붙이기만 하고 절대 고치지 않는 장부다, 관인이 떨어져 나가도 대장의 해시와 지문이 신원을 되찾아 준다. 셋째, 관인은 기관 안에서는 신분증이지만 밖에서는 여권이다. 여권이 다른 나라에서 통하려면 협정이 있어야 하듯, 우정사업본부의 등급이 이노티움에서 통하려면 등가성 협정이 있어야 한다. 이 협정을 데이터로 들고 있어 기관 하나의 장부가 기관 사이, 국가 사이로 같은 모양으로 늘어난다. 마지막으로 대장이 놓치는 한 가지 — 아예 다른 문장으로 다시 쓴 문서 — 는 docsim 讀心이 뜻을 읽어 되찾는다. 글자로는 5%만 닮아도 뜻으로는 같은 문서라고 말해 주는 눈이다. 그래서 약속은 한 줄: 라벨이 사라져도 문서의 신원은 사라지지 않는다.')
}

// ───────────────────────── 3. 요약 + 제출 세트
{
  const s = base()
  title(s, '무엇을 만들었고, 무엇을 제출하는가', '4쪽 시연 스토리 → 5쪽 평가표 순으로 읽으면 3분 안에 결론이 잡힌다')
  textBox(s, 0.6, 1.7, 6.2, 5.0, [
    'ECM이 준 File ID·등급·Tag를 서명 라벨로 파일 안에 묶고, 그 사실을 고칠 수 없는 원장에 적는다.',
    '복사·개명·재저장·수정·변환·라벨 유실을 겪어도 라벨 → 해시 → 텍스트 해시 → 지문·의미 네 단이 차례로 신원을 되찾는다.',
    '필수 시연 8종 전부 실동작. 스크립트 하나로 재현, 자동 테스트 7패키지.',
    '우정사업본부 ↔ 이노티움 협정으로 기관 간 전달까지, 관리콘솔 6화면까지.'
  ], 15)
  const pk = [['01', '실행 가능한 PoC', '서버·CLI·웹·SDK 소스 전체', '27쪽'], ['02', '실제 시연', '필수 8 + 위조 4 + 기관 간 4', '13~16쪽'], ['03', '구현 설명서', '구조·기술·식별·복원·실행', '7~12쪽'], ['04', '테스트 결과', '성공/실패·정확도·성능', '18~21쪽'], ['05', '한계·적용방안', '미지원 조건·제품 적용·사업', '23~26쪽']]
  pk.forEach(([n, h, b, p], i) => {
    const y = 1.7 + i * 1.0
    s.addShape(pres.ShapeType.rect, { x: 7.1, y, w: 5.6, h: 0.88, fill: { color: K.paper }, line: { color: K.paper } })
    s.addText(n, { x: 7.25, y, w: 0.9, h: 0.88, fontFace: F, fontSize: 30, bold: true, color: [K.red, K.blue, K.yellow, K.black, K.red][i], valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(h, { x: 8.2, y: y + 0.1, w: 3.2, h: 0.36, fontFace: F, fontSize: 15, bold: true, color: K.black, isTextBox: true, margin: 0 })
    s.addText(b, { x: 8.2, y: y + 0.46, w: 3.4, h: 0.36, fontFace: F, fontSize: 11.5, color: K.gray, isTextBox: true, margin: 0 })
    s.addText(p, { x: 11.5, y, w: 1.1, h: 0.88, fontFace: F, fontSize: 13, bold: true, color: K.blue, align: 'right', valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addNotes('제출 세트 5개가 이 자료 안에 있다. 오른쪽 숫자 카드의 쪽 번호로 심사 항목을 바로 찾는다.')
}

// ───────────────────────── 3. 시연 스토리
{
  const s = base()
  title(s, '3분 시연 스토리 — 문서 하나, 여덟 번 되살아나는 신원', '문서관리규정.docx 한 건이 겪는 일. 근거 캡처는 14·15쪽')
  const st = [
    ['1', '발급', '라벨 내장 · 원장 기록', '서명 유효', K.red], ['2', '복사·개명', '이름 바꿔 다른 곳으로', '같은 신원(해시 동일)', K.red],
    ['3', '라벨 제거', '메타정보 지운 사본', '원장 조회 → 라벨 복원', K.blue], ['4', '재저장', 'ZIP 재조립, 바이트 전면 변경', '텍스트 해시로 재식별', K.blue],
    ['5', '일부 수정', '조항 고치고 추가', '글자 73% · 뜻 "재작성" 판정', K.yellow], ['6', 'DOCX→PDF', '같은 내용 변환', '지문 100% "동일"', K.yellow],
    ['7', '이노티움 전달', '협정 있는 기관', 'S→S 번역 · 통과', K.black], ['8', '국세청 · C등급', '협정 없음 / 내부 전용', '서명만 · 검토 / 차단', K.black]
  ]
  st.forEach(([n, h, what, ev, col], i) => {
    const c = i % 4, r = Math.floor(i / 4)
    const x = 0.6 + c * 3.05, y = 1.7 + r * 2.5
    s.addShape(pres.ShapeType.rect, { x, y, w: 2.9, h: 2.2, fill: { color: K.paper }, line: { color: K.paper } })
    s.addText(n, { x: x + 0.15, y: y + 0.05, w: 1.0, h: 0.9, fontFace: F, fontSize: 40, bold: true, color: col === K.yellow ? 'B08900' : col, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(h, { x: x + 1.05, y: y + 0.18, w: 1.8, h: 0.6, fontFace: F, fontSize: 17, bold: true, color: K.black, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(what, { x: x + 0.2, y: y + 1.0, w: 2.55, h: 0.55, fontFace: F, fontSize: 12.5, color: K.gray, isTextBox: true, margin: 0 })
    s.addText(ev, { x: x + 0.2, y: y + 1.55, w: 2.55, h: 0.65, fontFace: F, fontSize: 13.5, bold: true, color: K.blue, isTextBox: true, margin: 0 })
  })
  keyMsg(s, '어느 단이 깨져도 다음 단이 받는다. 여덟 칸 전부 poc-demo.sh 한 번으로 재현.', 6.4)
  s.addNotes('문서 하나가 겪는 여덟 가지 일. 파란 글씨가 실측 결과, 13·14쪽에 캡처.')
}

// ───────────────────────── 4. 평가 기준 대응표
{
  const s = base()
  title(s, '평가 기준 대응표 (요강 06)', '평가항목 · 배점 · 우리가 구현한 것 · 어디서 확인하나')
  table(s, [
    ['평가항목', '배점', '구현한 것', '확인'],
    ['실제 동작 · PoC 완성도', B('40', K.black), '필수 8 + 위조 4 + 기관 간 4 실동작. 원커맨드 데모, 시연 스크립트 8단계, 샘플 로딩(멱등)', '14·15쪽, poc-demo.sh, go test'],
    ['식별·Tag 유지/복원 정확도', B('25', K.black), '복사·개명·라벨제거·변환 100% · 국소 수정 0.77~0.86 · 재작성본 뜻 일치 0.91 · 오탐 0 · 완전/상속 복원', '18~21쪽'],
    ['다양한 환경 대응', B('15', K.black), 'OS 메타 대신 포맷 내장 · 미등재 포맷 사이드카 · 오프라인 검증 · 재저장 생존 · 5기관 협정', '16쪽'],
    ['제품 적용 가능성', B('10', K.black), 'REST + Gate SDK · 포맷 카탈로그 · 교체 가능한 암호모듈 · 관리콘솔 · 적용 로드맵', '24·26쪽'],
    ['독창성 · 확장성', B('10', K.black), '서명+원장+텍스트 해시+지문+의미의 결합 · 이중 계보 · 협정(여권) · 특허 소재 3건', '25쪽']
  ], 0.6, 1.7, 12.1, [2.6, 0.8, 6.3, 2.4], { size: 12, rowH: 0.78 })
  s.addNotes('심사표와 같은 구조. 40점은 시연과 재현, 25점은 실측 정확도, 15점은 기관 간 전달과 오프라인.')
}

// ───────────────────────── 5. 요강 기술 채택
{
  const s = base()
  title(s, '요강이 열거한 기술 8종 — 채택 5 · 미채택 2 · 미구현 1', '"구현 방식은 다음 기술에 한정하지 않는다" — 왜 골랐고 왜 버렸나')
  keyMsg(s, '파일시스템 메타(ADS·xAttr)는 복사·메일·웹 업로드에서 사라진다. 파일 내용에 묶이는 방식만 골랐다.')
  table(s, [
    ['기술', '채택', 'LedgerMarker'],
    ['NTFS ADS · xAttr', NA, '외부 채널에서 소멸. 포맷 내장으로 대체'],
    ['Embedded Metadata', OK, '서명 라벨을 ZIP 코멘트·트레일러·front matter로 내장, 사이드카 폴백'],
    ['SHA-256 Hash', OK, '본문 해시 + 정규화 텍스트 해시(2차 색인)'],
    ['구조 Fingerprint', NO, '로드맵. 텍스트·의미 지문이 대신'],
    ['콘텐츠 Fingerprint', OK, '5-gram MinHash(128) + LSH — 후보를 ms에 조회'],
    ['AI 의미 Fingerprint', OK, 'docsim 讀心 임베딩 지문 — 재작성본도 같은 문서로 판정'],
    ['자체 Registry', OK, 'append-only 원장(해시체인·봉인) + 게이트 관측 로그']
  ], 0.6, 2.25, 12.1, [2.6, 1.2, 8.3], { size: 12.5, rowH: 0.52 })
  s.addNotes('ADS/xAttr는 일부러 쓰지 않았다. 구조 지문만 미구현.')
}

// ───────────────────────── 6. 구조
{
  const s = base()
  title(s, '전체 구조 — 파일 본문은 서버로 가지 않는다', '해시·지문·라벨만 오간다. docsim 讀心은 코드 수정 없이 서브프로세스로 결합')
  const box = (x, y, w, h, head, body, fill, ink) => {
    s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: fill } })
    s.addText(head, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.45, fontFace: F, fontSize: 16, bold: true, color: ink, isTextBox: true, margin: 0 })
    s.addText(body, { x: x + 0.2, y: y + 0.6, w: w - 0.4, h: h - 0.7, fontFace: F, fontSize: 12.5, color: ink, valign: 'top', isTextBox: true, margin: 0 })
  }
  box(0.6, 1.7, 3.2, 1.45, 'CLI  lm', '발급·검증·재식별·복원·계보\n전달(send)·수신(receive)', K.paper, K.ink)
  box(0.6, 3.3, 3.2, 1.45, '웹 PWA', '검증·발급·원장 6화면\n유사도 테스트·수신함', K.paper, K.ink)
  box(0.6, 4.9, 3.2, 1.45, 'Gate SDK', 'CDS/DLP/AI필터가 호출\n판정은 게이트 정책', K.paper, K.ink)
  s.addShape(pres.ShapeType.rightArrow, { x: 3.95, y: 3.65, w: 0.6, h: 0.7, fill: { color: K.red }, line: { color: K.red } })
  box(4.7, 1.7, 4.6, 4.65, 'LM Server (Go)', '발급 — 기관 키 서명, 5기관\n검증 — 서명·원장·폐기·기간·협정\n재식별 — 해시 → 텍스트 해시 → MinHash → 의미\n복원 — 완전 복원 · 상속 복원\n계보 — parentHash DAG\n협정 — 등급 번역표 · 만료\n관측 — 기관 간 SENT/VERIFIED\n원장 — 해시체인 · 머클 봉인', K.black, K.white)
  box(9.5, 1.7, 3.2, 2.2, 'PostgreSQL 16', 'append-only 원장\nUPDATE/DELETE 차단', K.blueSoft, K.ink)
  box(9.5, 4.15, 3.2, 2.2, 'docsim 讀心', '의미 임베딩 지문\n서브프로세스 어댑터', K.yellowSoft, K.ink)
  s.addText('불변식  ① 원장은 고치지 않는다  ② 등급은 평문  ③ 본문은 저장하지 않는다  ④ 귀속과 판정은 분리', { x: 0.6, y: 6.5, w: 12.1, h: 0.4, fontFace: F, fontSize: 13, bold: true, color: K.black, isTextBox: true, margin: 0 })
  s.addNotes('구조. 본문은 서버로 가지 않는다. 불변식 4개가 설계 기준.')
}

// ───────────────────────── 7. 기술·오픈소스
{
  const s = base()
  title(s, '사용 기술과 오픈소스 (요강 6.1)', '전부 허용적 라이선스. 사내 모듈은 docsim 讀心 하나. AI 코딩 보조를 썼고 전체 동작을 설명·재현할 수 있다')
  table(s, [
    ['구성', '기술', '라이선스'],
    ['서버·CLI·SDK', 'Go 1.26 · cobra · pgx · golang-migrate · x/text · ledongthuc/pdf', 'BSD · Apache · MIT'],
    ['데이터베이스', 'PostgreSQL 16 (append-only 트리거·권한 회수)', 'PostgreSQL'],
    ['웹', 'React 18 · Vite · Workbox PWA · pkijs · pdf.js · cytoscape', 'MIT · BSD · Apache'],
    ['의미 엔진', 'docsim 讀心 — ko-sroberta-multitask 임베딩', '사내 · Apache(모델)'],
    ['암호모듈', '개발용 키스토어 → KCMVP 모듈로 교체 가능한 인터페이스', '—']
  ], 0.6, 1.7, 12.1, [2.4, 6.7, 3.0], { size: 13, rowH: 0.62 })
  s.addNotes('전 구성요소가 허용적 오픈소스. 암호모듈은 교체 인터페이스로 분리.')
}

// ───────────────────────── 8. 식별 4단
{
  const s = base()
  title(s, '파일 식별 — 4단 사다리와 판정 기준', '요강 3.4: 100% 동일이 어려우면 기준을 명확히 정의한다')
  keyMsg(s, '정확 일치(1·2·3단)는 100%. 추정(4단)은 0.30 후보 · 0.70 자동 복원 · 그 사이는 운영자 확정.')
  table(s, [
    ['단', '메커니즘', '살아남는 상황', '기준'],
    [B('1 라벨', K.red), '서명 라벨 내장 또는 사이드카', '복사·개명·이동·외장매체', '서명 valid/invalid'],
    [B('2 원시 해시', K.red), 'SHA-256 → 원장 → 라벨 회수', '라벨·메타 완전 유실', '정확 일치'],
    [B('3 텍스트 해시', K.blue), '정규화 본문 해시 2차 색인', '재저장·재압축', '정확 일치'],
    [B('4 지문', 'B08900'), 'MinHash + LSH 자카드 추정', '일부 수정 · 변환 · 개명 저장', '0.30 후보 · 0.70 자동'],
    [B("4' 의미", 'B08900'), 'docsim 讀心 코사인 + 관계 판정', '재작성 · 발췌', '재작성 ≥ 0.86 실측']
  ], 0.6, 2.25, 12.1, [2.0, 3.6, 3.4, 3.1], { size: 12.5, rowH: 0.6 })
  s.addText('선언적 계보(1.0)와 관찰적 재식별(<1)을 분리해 보여 주고, 추정의 채택은 운영자·게이트가 정한다.', { x: 0.6, y: 6.0, w: 12.1, h: 0.5, fontFace: F, fontSize: 13, color: K.gray, isTextBox: true, margin: 0 })
  s.addNotes('4단 사다리와 판정 기준. 정확 단은 100%, 추정 단은 0.30/0.70.')
}

// ───────────────────────── 9. Tag 유지·복원
{
  const s = base()
  title(s, 'Tag 유지와 복원', '포맷별 부착 · 완전 복원 · 상속 복원')
  table(s, [
    ['포맷', '부착'],
    ['DOCX·XLSX·PPTX·HWPX·ODF', 'ZIP 코멘트 — 파일 무손상'],
    ['HWP · PDF · 이미지', '파일 끝 트레일러'],
    ['Markdown · TXT', 'front matter + 정규화'],
    ['EXE · DLL', '사이드카 고정(코드서명 보호)'],
    ['미등재 형식', '자동 사이드카 폴백']
  ], 0.6, 1.7, 6.0, [2.8, 3.2], { size: 12.5, rowH: 0.55 })
  card(s, 6.9, 1.7, 5.8, 2.2, '완전 복원 — 해시가 같을 때', ['원장이 보관한 원본 라벨을 회수해 다시 붙인다', '서명이 원본 그대로 살아나 정책이 즉시 재적용'], { tag: K.blue })
  card(s, 6.9, 4.1, 5.8, 2.2, '상속 복원 — 수정본일 때', ['지문·의미로 원본을 찾아 등급·Tag를 상속한 새 라벨 발급', '0.70 미만은 자동 발급 없이 운영자 검토'], { tag: K.yellow })
  s.addText('재저장으로 내장 라벨이 사라져도(실측 H-1 ✗) 텍스트 해시가 재식별·복원을 보장한다(H-5 ○).', { x: 0.6, y: 5.3, w: 6.0, h: 0.9, fontFace: F, fontSize: 13, color: K.gray, isTextBox: true, margin: 0 })
  s.addNotes('포맷별 부착과 두 가지 복원.')
}

// ───────────────────────── 10. 파생 5유형
{
  const s = base()
  title(s, '수정·변환 파일 추적 (요강 3.4) — 파생 5유형', '단순 복사를 넘어 파생 파일의 원본 연관성을 잡는 방법과 실측')
  table(s, [
    ['파생 유형', '식별 경로', '실측'],
    ['내용 일부 수정', '지문 후보 → 의미 판정', B('0.77~0.86 · 의미 0.94')],
    ['DOCX → PDF 변환', '텍스트 해시 · 지문', B('100% · "동일 문서"')],
    ['일부 추출', '포함률 + 의미, 계보 extract', B('"발췌" 판정 (포함률 0.89)')],
    ['다른 이름으로 저장', '라벨 · 원시 해시', B('100%')],
    ['콘텐츠 재구성(재작성)', '의미 임베딩', B('글자 겹침 5% · 뜻 일치 0.91')]
  ], 0.6, 1.7, 12.1, [3.2, 4.4, 4.5], { size: 13, rowH: 0.55 })
  stat(s, 0.6, 5.2, 2.85, 1.5, '0.30', '지문 후보 하한', K.blue)
  stat(s, 3.68, 5.2, 2.85, 1.5, '0.70', '자동 복원 임계', K.blue)
  stat(s, 6.76, 5.2, 2.85, 1.5, '0', '무관 30종 오탐', K.red)
  stat(s, 9.84, 5.2, 2.86, 1.5, '5%→0.91', '재작성본: 글자 겹침 5%, 뜻 일치 0.91', 'B08900')
  s.addNotes('파생 5유형별 식별 경로와 실측값.')
}

// ───────────────────────── 11. 정책 재적용
{
  const s = base()
  title(s, '정책 재적용 (요강 3.5)', '재식별이 "무엇인가"를 답하면 정책은 그 위에 얹힌다')
  keyMsg(s, '정책 7항목 중 5 충족 · 1 부분(암호화) · 1 미구현(워터마크).')
  table(s, [
    ['정책', '구현', '어떻게'],
    ['접근 허용 / 차단', OK, '검증 5항목 + 판정 힌트(allow·review·deny), Gate SDK'],
    ['외부 반출 통제', OK, '협정 번역 · C등급·잠정 라벨 차단 · 협정 없음 검토'],
    ['암호화', PART, '라벨에 자리만(클라이언트 측). 실행부 미구현'],
    ['워터마크', NO, '로드맵 — 등급 기반 삽입 훅'],
    ['보존 / 폐기', OK, '유효기간 · REVOKE · DESTROY(심의 토큰)'],
    ['경고 · 로그', OK, '원장 + 게이트 관측 로그'],
    ['라벨 재적용', OK, '완전 복원(재내장) · 상속 복원(새 라벨)']
  ], 0.6, 2.25, 12.1, [2.6, 1.2, 8.3], { size: 12.5, rowH: 0.5 })
  s.addNotes('정책 7항목 중 5 충족. 판정은 참고값이고 통과 여부는 게이트가 정한다.')
}

// ───────────────────────── 12. 필수 8종
{
  const s = base()
  title(s, '필수 시연 8종 전부 실동작 (요강 04)', '최소 3개 요구 → 8개 모두. 실제 출력은 14·15쪽')
  table(s, [
    ['#', '요강 시나리오', '방법', '결과'],
    ['1', '등록 → File ID/Tag → 복사 후 식별', 'lm issue --embed → 복사본 verify', OK],
    ['2', '파일명 변경 · 폴더 이동', '내용 해시로 같은 신원', OK],
    ['3', '외장 저장장치 이동', '라벨이 파일 안에 동행, 오프라인 검증', OK],
    ['4', '메타정보 제거 후 재식별', '원장 해시 폴백 → 라벨 복원', OK],
    ['5', '일부 수정 후 연관성', 'MinHash 후보 + docsim 讀心', OK],
    ['6', 'DOCX → PDF 파생관계', '지문 100% · 의미 1.00', OK],
    ['7', '보안정책 자동 재적용', 'lm restore --embed → 서명 valid', OK],
    ['8', 'Lineage / Audit Log', '원장 6화면 + 체인 점검', OK]
  ], 0.6, 1.7, 12.1, [0.6, 4.6, 5.4, 1.5], { size: 12.5, rowH: 0.5 })
  s.addNotes('필수 8종 전부 실동작.')
}

// ───────────────────────── 13. 시연 로그
{
  const s = base()
  title(s, '시연 캡처 ① 8단계 CLI 출력', 'poc-demo.sh 한 번의 실제 결과. 초록 = 통과·재식별·복원, 노랑 = 설계된 검토 판정')
  s.addImage({ path: 'demolog.png', x: 0.6, y: 1.6, w: 9.4, h: 9.4 * 1580 / 2824 })
  const notes = [['③', '라벨 없어도 원장에 있으면 복원'], ['④', '지문 73% → 의미 0.97 재작성'], ['⑥', '재저장본을 텍스트 해시로 재식별'], ['⑧', '이노티움 협정 번역 allow']]
  notes.forEach(([n, b], i) => {
    const y = 1.6 + i * 1.3
    s.addShape(pres.ShapeType.rect, { x: 10.2, y, w: 2.5, h: 1.15, fill: { color: K.paper }, line: { color: K.paper } })
    s.addText(n, { x: 10.3, y: y + 0.05, w: 0.7, h: 1.05, fontFace: F, fontSize: 30, bold: true, color: K.red, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(b, { x: 11.0, y: y + 0.1, w: 1.65, h: 0.95, fontFace: F, fontSize: 12, bold: true, color: K.ink, valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addNotes('실제 로그. ③ 복원, ④ 재작성 판정, ⑥ 재저장 재식별, ⑧ 협정 번역.')
}

// ───────────────────────── 14. 위조 · 재저장
{
  const s = base()
  title(s, '시연 캡처 ② 위조 4종 탐지 · 재저장 전후', '왼쪽: 같은 문서를 넷으로 위조해 검증한 결과 · 오른쪽: 라벨이 사라진 재저장본이 되살아나는 장면')
  s.addImage({ path: 'attack.png', x: 0.6, y: 1.6, w: 7.4, h: 7.4 * 1690 / 2720 })
  s.addText('변조·등급 위조·서명 변조는 차단 권고, 라벨 제거는 원장 폴백으로 검토 권고 후 복원.', { x: 0.6, y: 6.25, w: 7.4, h: 0.6, fontFace: F, fontSize: 12.5, bold: true, color: K.ink, isTextBox: true, margin: 0 })
  s.addText('재저장 전 — 서명 유효', { x: 8.2, y: 1.55, w: 4.5, h: 0.3, fontFace: F, fontSize: 12.5, bold: true, color: K.black, isTextBox: true, margin: 0 })
  s.addImage({ path: 'resave_a.png', x: 8.2, y: 1.85, w: 4.0, h: 4.0 * 830 / 1360 })
  s.addText('재저장 후 — 라벨 소실, 텍스트 해시로 같은 신원', { x: 8.2, y: 4.35, w: 4.5, h: 0.3, fontFace: F, fontSize: 12.5, bold: true, color: K.blue, isTextBox: true, margin: 0 })
  s.addImage({ path: 'resave_b.png', x: 8.2, y: 4.65, w: 4.0, h: 4.0 * 830 / 1360 })
  s.addNotes('위조 4종: 셋은 서명 무효 차단, 라벨 제거는 폴백 복원. 재저장: H-1 ✗ H-4 ✗ H-5 ○.')
}

// ───────────────────────── 15. 기관 간
{
  const s = base()
  title(s, '기관 간 전달과 등가성 협정', '우정사업본부 ↔ 이노티움 협정 체결. 5개 기관이 한 서버에서 발급·검증(페르소나 전환)')
  textBox(s, 0.6, 1.7, 5.6, 2.2, [
    '보내기 = 관측 로그에 SENT. 받기 = 받는 기관 게이트가 원장 조회 + 협정 번역 후 VERIFIED.',
    '원장 행은 늘지 않는다. 발급 사실이 아니라 게이트가 보고한 사실이다.'
  ], 13.5)
  table(s, [
    ['전달', '등급', '협정', '힌트'],
    ['KPOST → INNOTIUM', G('S'), 'translated S→S', B('allow')],
    ['KPOST → NTS', G('S'), 'no_treaty', B('review', 'B08900')],
    ['KPOST → INNOTIUM', G('C'), 'not_translatable', B('deny', K.red)],
    ['KPOST → MSIT (만료 후)', G('O'), 'expired', B('review', 'B08900')]
  ], 0.6, 4.0, 5.6, [2.4, 0.7, 1.5, 1.0], { size: 12.5, rowH: 0.45 })
  s.addImage({ path: 'card.png', x: 6.5, y: 1.7, w: 6.2, h: 6.2 * 330 / 850 })
  s.addImage({ path: 'inbox.png', x: 6.5, y: 4.25, w: 6.2, h: 6.2 * 250 / 900 })
  s.addText('위: 협정 없는 국세청 게이트의 결과 — 서명만 확인, 검토 필요 · 아래: 수신함', { x: 6.5, y: 6.05, w: 6.2, h: 0.4, fontFace: F, fontSize: 12, color: K.gray, isTextBox: true, margin: 0 })
  s.addNotes('협정 있으면 번역·allow, 없으면 서명만·review, C등급은 deny.')
}

// ───────────────────────── 16. 관리콘솔
{
  const s = base()
  title(s, '관리콘솔 — 원장 6화면', '표 · 레인 차트 · 전체 그래프 · 분류·온톨로지 · 기관 지도 · 기관 간 흐름. 모두 실제 원장 데이터')
  s.addImage({ path: 'lane.png', x: 0.6, y: 1.6, w: 4.1, h: 4.1 * 1100 / 900 })
  s.addImage({ path: 'passport.png', x: 4.9, y: 1.6, w: 4.0, h: 4.0 * 740 / 900 })
  s.addImage({ path: 'stamps.png', x: 4.9, y: 5.0, w: 4.0, h: 4.0 * 460 / 900 })
  s.addImage({ path: 'graph.png', x: 9.1, y: 1.6, w: 3.6, h: 3.6 * 560 / 900 })
  s.addImage({ path: 'taxonomy.png', x: 9.1, y: 4.0, w: 3.6, h: 3.6 * 700 / 900 })
  s.addNotes('레인 차트, 기관 지도, 흐름, 그래프, 분류 화면.')
}

// ───────────────────────── 17. 테스트 ①
{
  const s = base()
  title(s, '테스트 결과 ① 시나리오와 정확도', '오른쪽 열은 같은 조건을 청크 해시 방식이 처리할 때의 예상')
  stat(s, 0.6, 1.65, 2.3, 1.35, '8/8', '필수 시나리오', K.blue)
  stat(s, 3.05, 1.65, 2.3, 1.35, '4/4', '위조 탐지', K.blue)
  stat(s, 5.5, 1.65, 2.3, 1.35, '4/4', '기관 간 판정', K.blue)
  stat(s, 7.95, 1.65, 2.3, 1.35, '7/7', '테스트 패키지', K.blue)
  stat(s, 10.4, 1.65, 2.3, 1.35, '0', '무관 오탐', K.red)
  table(s, [
    ['조건', 'LM', '판별', '청크 해시라면'],
    ['동일 / 서식만 변경', '1.00', B('식별'), '서식 변경은 미식별'],
    ['DOCX ↔ TXT·PDF 변환', '1.00', B('식별'), B('미식별', K.red)],
    ['조문 1개 교체', '0.86', B('식별'), '부분 식별, 등급·출처 모름'],
    ['단어 5% / 10% 흩뿌림', '0.63 / 0.48', B('식별'), B('미식별', K.red)],
    ['단어 20%+ 치환(재작성)', '< 0.30', '의미 판정이 받음', B('미식별', K.red)],
    ['무관 30종', '< 0.30', B('오탐 0'), '오탐 0']
  ], 0.6, 3.25, 12.1, [4.0, 2.0, 2.6, 3.5], { size: 12.5, rowH: 0.45 })
  s.addNotes('정확도 표. 청크 해시 열은 예상이며 식별돼도 등급·출처는 모른다.')
}

// ───────────────────────── 18. 테스트 ②
{
  const s = base()
  title(s, '테스트 결과 ② 의미 판정 · 재저장 · 성능', 'docsim 讀心 결합 케이스와 Apple Pages 재저장 실측')
  table(s, [
    ['케이스', 'MinHash', '의미', '판정'],
    ['1 수정본 (한글)', '77%', '0.94', '재작성'],
    ['2 재작성본 (한글)', B('5%', K.red), B('0.91'), B('재작성')],
    ['2 재작성본 (영문)', '4%', '0.75', '일부 유사'],
    ['3 무관 (한글)', '0%', '0.40', '무관']
  ], 0.6, 1.7, 6.6, [2.7, 1.2, 1.2, 1.5], { size: 13, rowH: 0.5 })
  table(s, [
    ['재저장 (Pages)', '결과'],
    ['H-1 라벨 생존', B('✗', K.red)],
    ['H-4 원시 해시', B('✗', K.red)],
    ['H-5 텍스트 해시 재식별', B('○ 같은 신원')]
  ], 7.6, 1.7, 5.1, [3.3, 1.8], { size: 13, rowH: 0.5 })
  table(s, [
    ['성능 (순차 100회)', '평균', 'p95'],
    ['발급', '7.8 ms', '7.8 ms'],
    ['검증', '3.2 ms', '4.5 ms'],
    ['지문 후보 조회', '1.1 ms', '1.4 ms']
  ], 7.6, 4.1, 5.1, [2.5, 1.3, 1.3], { size: 13, rowH: 0.5 })
  s.addText('글자로는 남남(5%)인데 뜻으로는 같은 문서(0.91). 재작성 유출은 의미 판정만 잡는다.', { x: 0.6, y: 4.5, w: 6.6, h: 0.9, fontFace: F, fontSize: 14, bold: true, color: K.black, isTextBox: true, margin: 0 })
  s.addText('자동 테스트 7패키지 전부 통과 — 부록 B', { x: 0.6, y: 5.5, w: 6.6, h: 0.4, fontFace: F, fontSize: 12.5, color: K.gray, isTextBox: true, margin: 0 })
  s.addNotes('케이스 2가 핵심: 자카드 5%인데 의미 0.91.')
}

// ───────────────────────── 19. 유사도 화면
{
  const s = base()
  title(s, '유사도 테스트 화면 — 글자로는 남남, 뜻으로는 같은 문서', '해시 · 자카드 · 의미를 한 화면에서. 재작성 유출은 의미만 잡는다')
  s.addImage({ path: 'simpair.png', x: 0.6, y: 1.6, w: 6.3, h: 6.3 * 700 / 850 })
  s.addImage({ path: 'simledger.png', x: 7.1, y: 1.6, w: 2.4, h: 2.4 * 720 / 850 })
  const pts = [['글자 5% · 뜻 91%', '문장 구조만 바꾼 문서. 글자로는 남남, 뜻으로는 재작성', K.red], ['유출은 재작성으로 온다', '요약·재구성·번역 앞에서 청크 해시는 침묵한다', K.blue], ['설명할 수 있다', '해시 배열·벤 다이어그램·청크 연결을 그대로 보여 준다', 'B08900']]
  pts.forEach(([h, b, col], i) => {
    const y = 1.6 + i * 1.7
    s.addShape(pres.ShapeType.rect, { x: 9.7, y, w: 3.0, h: 1.5, fill: { color: K.paper }, line: { color: K.paper } })
    s.addShape(pres.ShapeType.rect, { x: 9.7, y, w: 0.18, h: 1.5, fill: { color: col }, line: { color: col } })
    s.addText(h, { x: 10.0, y: y + 0.1, w: 2.6, h: 0.45, fontFace: F, fontSize: 15, bold: true, color: K.black, isTextBox: true, margin: 0 })
    s.addText(b, { x: 10.0, y: y + 0.55, w: 2.6, h: 0.9, fontFace: F, fontSize: 11.5, color: K.ink, valign: 'top', isTextBox: true, margin: 0 })
  })
  s.addText('원장 검색 모드 — 후보 사분면', { x: 7.1, y: 3.7, w: 2.4, h: 0.3, fontFace: F, fontSize: 11, color: K.gray, isTextBox: true, margin: 0 })
  s.addNotes('세 잣대를 한 화면에서. 운영자가 근거를 눈으로 확인.')
}

// ───────────────────────── 20. 성능
{
  const s = base()
  title(s, '성능 — 시간은 두 곡선, 공간은 "정부 1억 문서"로 환산', '왼쪽: 본문 크기별 계산 시간(로그) · 오른쪽: 원본 대비 저장 공간')
  s.addImage({ path: 'timechart.png', x: 0.6, y: 1.6, w: 6.2, h: 6.2 * 1720 / 2520 })
  const bx = 7.2, bw = 5.5
  s.addText('1억 건을 모두 등록하면', { x: bx, y: 1.6, w: bw, h: 0.4, fontFace: F, fontSize: 15, bold: true, color: K.black, isTextBox: true, margin: 0 })
  const bars = [['원본 문서 (500 KB/건)', 50, '50 TB', K.line, K.ink], ['의미 지문 전 문서 (30 KB)', 3, '3 TB', K.yellow, K.ink], ['의미 지문 양자화·S/C만', 0.23, '0.23 TB', K.yellow, K.ink], ['원장 + 라벨 (2.5 KB)', 0.25, '0.25 TB', K.blue, K.white], ['MinHash + LSH (3.5 KB)', 0.35, '0.35 TB', K.blue, K.white]]
  bars.forEach(([label, tb, txt, fill, ink], i) => {
    const y = 2.1 + i * 0.78
    s.addText(label, { x: bx, y, w: bw, h: 0.26, fontFace: F, fontSize: 11.5, color: K.gray, isTextBox: true, margin: 0 })
    const w = Math.max(0.14, (tb / 50) * bw)
    s.addShape(pres.ShapeType.rect, { x: bx, y: y + 0.28, w, h: 0.36, fill: { color: fill }, line: { color: fill } })
    s.addText(txt, { x: w > 2.5 ? bx + 0.12 : bx + w + 0.12, y: y + 0.28, w: 3, h: 0.36, fontFace: F, fontSize: 13, bold: true, color: w > 2.5 ? ink : K.ink, valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addShape(pres.ShapeType.rect, { x: bx, y: 6.05, w: bw, h: 0.8, fill: { color: K.black }, line: { color: K.black } })
  s.addText('원장 + 글자 지문 = 0.6 TB, 원본의 1.2%.  의미 지문까지 3.6 TB(7%).', { x: bx + 0.15, y: 6.05, w: bw - 0.3, h: 0.8, fontFace: F, fontSize: 13, bold: true, color: K.white, valign: 'middle', isTextBox: true, margin: 0 })
  s.addNotes('글자 지문은 5MB도 1초 미만, 의미 지문은 후보에만. 1천만 건 60 GB·0.3 TB, 10억 건 6 TB·30 TB.')
}

// ───────────────────────── 21. 평가 상세
{
  const s = base()
  title(s, '환경 대응 · 제품 적용 · 독창성의 근거', '"설명할 수 있는가"보다 "동작하는가"')
  card(s, 0.6, 1.7, 3.9, 3.3, '환경 대응 (15)', ['태그가 OS 메타가 아닌 파일 내용에 결속', '미등재 형식은 자동 사이드카', '오프라인 L1 검증', '재저장·변환 생존, 5기관 협정'], { tag: K.red, size: 12.5 })
  card(s, 4.7, 1.7, 3.9, 3.3, '제품 적용 (10)', ['innoECM 훅: 저장 이벤트 → 발급 API', 'innoAI: 등급분류 결과를 grade로 공급', 'Gate SDK · REST 명세 · 관리콘솔', '본문 미전송, 원장 PII 미기록'], { tag: K.blue, size: 12.5 })
  card(s, 8.8, 1.7, 3.9, 3.3, '독창성 (10)', ['위조는 서명이, 유실은 원장이, 변형은 지문·의미가 받는다', '선언적 + 관찰적 이중 계보', '여권 모델 — 협정으로 등급 번역', '게이트 관측 로그 분리'], { tag: K.yellow, size: 12.5 })
  s.addImage({ path: 'card.png', x: 0.6, y: 5.25, w: 3.6, h: 3.6 * 330 / 850 })
  s.addImage({ path: 'passport.png', x: 4.35, y: 5.25, w: 1.7, h: 1.7 * 740 / 900 })
  s.addImage({ path: 'stamps.png', x: 6.2, y: 5.25, w: 2.74, h: 2.74 * 460 / 900 })
  s.addImage({ path: 'graph.png', x: 9.1, y: 5.25, w: 2.25, h: 2.25 * 560 / 900 })
  s.addNotes('세 항목의 실동작 근거. 아래는 15·16쪽 캡처.')
}

// ───────────────────────── 22. 한계
{
  const s = base()
  title(s, '한계 — 지금 PoC가 못 하는 것', '숨기지 않는다')
  table(s, [
    ['조건', '상태', '대응'],
    ['스캔 문서·이미지 식별', NO, 'OCR·pHash — docsim 讀心 OCR 결합 예정'],
    ['DOCX 구조 지문', NO, '텍스트·의미 지문이 대신'],
    ['한글 PDF 텍스트 추출', PART, '폰트 인코딩에 따라 제한'],
    ['Office 재저장 시 내장 라벨', PART, '소실될 수 있음 — 텍스트 해시가 복원 보장'],
    ['암호화 · 워터마크 실행', PART, '라벨에 자리만'],
    ['저장 시점 자동 태깅', NO, 'ECM 이벤트 연동으로 해결'],
    ['기관별 서버·키 분리', PART, '모델 A 시뮬레이션 → 모델 B 로드맵'],
    ['등급 표기', PART, 'N2SF(C=비밀·O=공개). 공모 그림과 반대 — 주관 확인 후 맞춤']
  ], 0.6, 1.7, 12.1, [3.6, 1.3, 7.2], { size: 12.5, rowH: 0.52 })
  s.addNotes('OCR·구조 지문·워터마크 미구현. 등급 표기는 주관 확인 예정.')
}

// ───────────────────────── 23. 적용 방안
{
  const s = base()
  title(s, 'innoAI / innoECM 적용 시 추가 개발 7항', '훅 지점은 이미 API로 정의되어 있다')
  const items = [['1', 'innoECM 이벤트 훅', '저장·체크인 → 자동 발급, 새 버전 → 계보 자동 선언'], ['2', '엔드포인트 에이전트', 'USB·메일·메신저 훅에서 Gate SDK 호출'], ['3', 'innoAI 결합', '등급분류 판정을 발급 요청에 공급'], ['4', '암호모듈 제품화', 'KCMVP 모듈·HSM 교체, GPKI'], ['5', '포맷 내장 고도화', 'HWP 스트림 · customXml · PDF 증분'], ['6', '모델 B 실연합', '기관별 서버·키, 원장 원격 조회'], ['7', '식별 확장', 'OCR · 구조 지문 · 워터마크 훅']]
  items.forEach(([n, h, b], i) => {
    const c = i % 2, r = Math.floor(i / 2)
    const x = 0.6 + c * 6.15, y = 1.7 + r * 1.25
    s.addShape(pres.ShapeType.rect, { x, y, w: 5.95, h: 1.1, fill: { color: K.paper }, line: { color: K.paper } })
    s.addText(n, { x: x + 0.15, y, w: 0.8, h: 1.1, fontFace: F, fontSize: 30, bold: true, color: [K.red, K.blue, 'B08900', K.black][i % 4], valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(h, { x: x + 1.0, y: y + 0.12, w: 4.8, h: 0.4, fontFace: F, fontSize: 15, bold: true, color: K.black, isTextBox: true, margin: 0 })
    s.addText(b, { x: x + 1.0, y: y + 0.55, w: 4.8, h: 0.5, fontFace: F, fontSize: 12.5, color: K.ink, isTextBox: true, margin: 0 })
  })
  s.addNotes('추가 개발 7항.')
}

// ───────────────────────── 24. 선택 제출
{
  const s = base()
  title(s, '선택 제출 항목 (요강 5.2)', '특허 · 성능 · 정확도 비교 · 차별점 · 외부 채널 · 관리콘솔')
  const items = [['특허 가능 기술요소', '3건 — 원장 폴백 검증 · 협정 상호 인정 · 이중 계보. 비공개 별지'], ['성능 측정', '발급 7.8 ms · 검증 3.2 ms · 후보 1.1 ms · 의미 판정 수 초'], ['정확도 비교표', '글자 지문 vs 의미 지문 — 재작성은 의미만 (18·19쪽)'], ['차별점', 'ADS/xattr는 소멸 → 포맷 내장. 해시 DB는 수정본 못 잡음 → 지문·의미. 임베딩만으론 위조 못 막음 → 서명·원장'], ['외부 채널', '메일·클라우드·메신저 경유 후에도 라벨 동행, 기관 간 관측 로그'], ['UI / 관리콘솔', '웹 7메뉴 — 원장 6화면 · 검증 · 유사도 테스트']]
  items.forEach(([h, b], i) => {
    const c = i % 3, r = Math.floor(i / 3)
    const x = 0.6 + c * 4.1, y = 1.7 + r * 2.55
    card(s, x, y, 3.9, 2.35, h, b, { tag: [K.red, K.blue, K.yellow][c], size: 12.5 })
    const thumb = { 1: ['timechart.png', 2520, 1720], 2: ['simpair.png', 850, 700], 5: ['passport.png', 900, 740] }[i]
    if (thumb) { const th = 0.95, tw = th * thumb[1] / thumb[2]; s.addImage({ path: thumb[0], x: x + 3.9 - tw - 0.15, y: y + 2.35 - th - 0.1, w: tw, h: th }) }
  })
  s.addNotes('선택 제출 6항목. 특허는 비공개 별지.')
}

// ───────────────────────── 25. 비즈니스 모델
{
  const s = base()
  title(s, '비즈니스 모델 — 청크 해시가 못 하는 여섯 가지가 상품이다', '파일 → 조직 → 기관 간 → 국가 → 국가 간으로 같은 구조로 늘어난다')
  s.addShape(pres.ShapeType.rect, { x: 0.6, y: 1.7, w: 3.0, h: 4.1, fill: { color: K.paper }, line: { color: K.paper } })
  s.addText('청크 해시 방식', { x: 0.8, y: 1.8, w: 2.7, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: K.black, isTextBox: true, margin: 0 })
  s.addText(bullets(['같은 파일인지만 안다', '등급·출처를 증명 못 함', '폐기·등급변경을 모름', '재작성본은 남남', '상대 기관 DB에 접근 불가'], 12.5, K.red), { x: 0.8, y: 2.3, w: 2.7, h: 3.4, fontFace: F, valign: 'top', isTextBox: true, margin: 0 })
  s.addShape(pres.ShapeType.rightArrow, { x: 3.7, y: 3.4, w: 0.5, h: 0.7, fill: { color: K.black }, line: { color: K.black } })
  const tiles = [['1', '위조 불가 귀속', '서명 라벨, 1바이트도 탐지', '1단'], ['2', '유실 후 복원', '원장의 라벨 원본 회수', '1·2단'], ['3', '폐기의 진실원천', '지금 유효한지를 답한다', '2단'], ['4', '계보 + 감사', '이력이 증거가 된다', '2단'], ['5', '의미 재식별', '재작성본도 되찾는다', '2단'], ['6', '기관·국가 간 인정', 'CA 교환 + 협정 번역표', '3~5단']]
  tiles.forEach(([n, h, b, t], i) => {
    const c = i % 3, r = Math.floor(i / 3)
    const x = 4.35 + c * 2.85, y = 1.7 + r * 2.1
    s.addShape(pres.ShapeType.rect, { x, y, w: 2.7, h: 1.95, fill: { color: [K.redSoft, K.blueSoft, K.yellowSoft][c] }, line: { color: [K.redSoft, K.blueSoft, K.yellowSoft][c] } })
    s.addText(n, { x: x + 0.12, y: y + 0.05, w: 0.7, h: 0.7, fontFace: F, fontSize: 30, bold: true, color: K.black, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(h, { x: x + 0.8, y: y + 0.12, w: 1.85, h: 0.6, fontFace: F, fontSize: 14, bold: true, color: K.black, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(b, { x: x + 0.15, y: y + 0.85, w: 2.45, h: 0.6, fontFace: F, fontSize: 12, color: K.ink, isTextBox: true, margin: 0 })
    s.addText(t, { x: x + 0.15, y: y + 1.5, w: 2.45, h: 0.35, fontFace: F, fontSize: 12, bold: true, color: K.blue, isTextBox: true, margin: 0 })
  })
  const steps = [['1 파일', K.red], ['2 조직', K.blue], ['3 기관 간', 'B08900'], ['4 국가', K.black], ['5 국가 간', K.gray]]
  steps.forEach(([h, col], i) => {
    s.addShape(pres.ShapeType.chevron, { x: 0.6 + i * 2.44, y: 6.0, w: 2.5, h: 0.75, fill: { color: col }, line: { color: K.white, width: 1 } })
    s.addText(h, { x: 1.2 + i * 2.44, y: 6.0, w: 1.7, h: 0.75, fontFace: F, fontSize: 15, bold: true, color: K.white, valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addNotes('여섯 가지가 상품이고 다섯 단으로 같은 구조로 확장. PoC는 3단까지 실동작.')
}

// ───────────────────────── 26. 실행 방법
{
  const s = base()
  title(s, '실행 방법 — 심사 환경에서 그대로 재현', 'macOS/Linux · Go 1.22+ · Docker(PostgreSQL 16) · Node 18+')
  s.addShape(pres.ShapeType.rect, { x: 0.6, y: 1.7, w: 7.6, h: 4.9, fill: { color: K.black }, line: { color: K.black } })
  s.addText([
    { text: '# 데모 스택 (원장 + 서버 :8090)', options: { color: K.yellow, breakLine: true } }, { text: './deploy/run-demo.sh', options: { breakLine: true } }, { text: '', options: { breakLine: true } },
    { text: '# 필수 시연 8단계', options: { color: K.yellow, breakLine: true } }, { text: './scripts/poc-demo.sh', options: { breakLine: true } }, { text: '', options: { breakLine: true } },
    { text: '# 자동 테스트 7패키지', options: { color: K.yellow, breakLine: true } }, { text: 'go test ./...', options: { breakLine: true } }, { text: '', options: { breakLine: true } },
    { text: '# 웹 관리콘솔', options: { color: K.yellow, breakLine: true } }, { text: 'cd verify-pwa && npm run dev', options: { breakLine: true } }, { text: '', options: { breakLine: true } },
    { text: '# 기관 간 전달', options: { color: K.yellow, breakLine: true } }, { text: 'lm send 파일 --as KPOST --to INNOTIUM', options: { breakLine: true } }, { text: 'lm receive 파일 --as INNOTIUM', options: {} }
  ], { x: 0.9, y: 1.9, w: 7.0, h: 4.5, fontFace: 'Courier New', fontSize: 14, color: K.white, valign: 'top', isTextBox: true, margin: 0 })
  card(s, 8.5, 1.7, 4.2, 2.3, '샘플과 시연 세트', ['원장 메뉴 "샘플 파일 로딩" — 24파일 · 5기관 · 이벤트 · 기관 간 기록', 'demo/ 폴더 — 유사도 케이스 3종'], { tag: K.red, size: 12.5 })
  card(s, 8.5, 4.3, 4.2, 2.3, '제출물', ['소스 전체 + 이 발표자료', '비공개 별지(특허)는 미포함', '웹 http://localhost:5173'], { tag: K.blue, size: 12.5 })
  s.addNotes('실행 방법. 심사 환경에서 그대로 재현.')
}

// ───────────────────────── 27. 마무리
{
  const s = base({ dark: true })
  s.addShape(pres.ShapeType.ellipse, { x: 10.3, y: 0.6, w: 2.4, h: 2.4, fill: { color: K.red }, line: { color: K.red } })
  s.addShape(pres.ShapeType.rect, { x: 11.2, y: 3.4, w: 1.5, h: 1.5, fill: { color: K.blue }, line: { color: K.blue } })
  s.addShape(pres.ShapeType.triangle, { x: 9.6, y: 5.1, w: 1.9, h: 1.5, fill: { color: K.yellow }, line: { color: K.yellow } })
  s.addText('라벨이 사라져도\n문서의 신원은\n사라지지 않는다', { x: 0.8, y: 0.8, w: 8.5, h: 2.9, fontFace: F, fontSize: 40, bold: true, color: K.white, lineSpacingMultiple: 1.05, isTextBox: true, margin: 0 })
  const pts = [['동작한다', '8 + 4 + 4 실동작, 스크립트 하나로 재현'], ['정확하다', '복사·변환 100%, 국소 수정 0.86, 재작성본 뜻 일치 0.91, 오탐 0'], ['환경을 넘는다', '파일 내용에 결속, 오프라인, 재저장 생존, 5기관 협정'], ['제품에 붙는다', 'REST·SDK·관리콘솔, innoECM/innoAI 훅 지점 정의']]
  pts.forEach(([h, b], i) => {
    const y = 3.9 + i * 0.7
    s.addText(h, { x: 0.8, y, w: 2.6, h: 0.6, fontFace: F, fontSize: 18, bold: true, color: K.yellow, valign: 'middle', isTextBox: true, margin: 0 })
    s.addText(b, { x: 3.5, y, w: 5.8, h: 0.6, fontFace: F, fontSize: 14, color: K.white, valign: 'middle', isTextBox: true, margin: 0 })
  })
  s.addNotes('마무리 네 줄.')
}

// ───────────────────────── 28. 부록 A
{
  const s = base()
  title(s, '부록 A. 주요 API', '질의응답용 · api/openapi.yaml · Gate SDK')
  table(s, [
    ['API', '용도'],
    ['POST /v1/labels', '발급 — 해시·지문·부착 접수(파일 미전송), 멱등키, 5기관'],
    ['POST /v1/verify', '검증 5항목. verifierOrg가 다르면 협정 번역'],
    ['POST /v1/identify · /compare', '지문 재식별 · 두 본문 비교(자카드+의미)'],
    ['GET /v1/labels/by-hash · POST /v1/restore', '라벨 원본 회수 · 복원 사다리(상속 발급)'],
    ['GET /v1/documents/{id}/lineage', '파생 계보 그래프'],
    ['POST/GET /v1/observations', '기관 간 관측 로그 SENT·VERIFIED'],
    ['GET /v1/ledger/* · /checkpoints', '감사 이력 · 체인 점검 · 봉인'],
    ['POST /v1/labels/{id}/revoke·regrade·destroy', '폐기 · 등급변경 · 파기 — 이벤트 행 추가'],
    ['GET /v1/treaties · /trust/list · /formats', '협정 · 신뢰목록 · 포맷 카탈로그'],
    ['POST /v1/admin/load-samples', '샘플 일괄 발급(멱등)']
  ], 0.6, 1.7, 12.1, [5.2, 6.9], { size: 12.5, rowH: 0.45 })
  s.addNotes('API 목록.')
}

// ───────────────────────── 29. 부록 B
{
  const s = base()
  title(s, '부록 B. 자동 테스트 대응표', 'go test ./... 7패키지 전부 통과 (2026-09-25)')
  table(s, [
    ['ID', '검증 내용', '위치'],
    ['T1', '라벨 1바이트 변조 → 서명 무효', 'issue_test'],
    ['T2 · T3', '원장 UPDATE/DELETE 거부 · 조작 seq 지목', 'pg_integration · hash_test'],
    ['T4~T8', '폴백 · 오프라인≠미등록 · 키 유출 규칙', 'verify_test'],
    ['T9~T13', '등급 하향 승인 · 멱등 발급 · 3세대 계보 · 포맷 폴백', 'server_test'],
    ['A1~A7', '지문 정확도 곡선(서식·변환·수정·치환·무관)', 'accuracy_test'],
    ['Golden', '행 해시 직렬화 · 정규화 골든값', 'ledger · attach'],
    ['L3 · Obs · Samples', '협정 번역·없음·만료·C차단 · 관측 로그 · 샘플 로더 멱등', 'federation_test'],
    ['Compare · Bench', '/v1/compare · MinHash 0.65 ms/5KB', 'server_test · bench_test']
  ], 0.6, 1.7, 12.1, [2.2, 6.4, 3.5], { size: 12.5, rowH: 0.5 })
  s.addNotes('자동 테스트 대응표. 전부 통과.')
}

pres.writeFile({ fileName: process.argv[2] || 'out.pptx' }).then((f) => console.log('written', f, 'slides', page))
