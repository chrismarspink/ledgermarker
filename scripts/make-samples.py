#!/usr/bin/env python3
# 기능 테스트용 샘플 세트 생성: 다섯 기관 × 여러 형식(docx·pdf·md·txt·csv·xlsx·pptx)
# × 세 등급(C/S/O) 문서와, 원장 시각화 5종(레인·그래프·분류·여권 지도·스탬프/흐름)을
# 그리기에 충분한 이벤트(파생·등급변경·폐기·파기·봉인)·기관 간 관측 로그를 manifest.json
# 으로 만든다. 서버의 POST /v1/admin/load-samples (웹 원장 메뉴 "샘플 파일 로딩") 가
# 이 manifest 를 순서대로 실행한다.
#
# 사용: python3 scripts/make-samples.py /Users/chris/LedgerMarker/sample
import json, os, sys, zipfile

out = sys.argv[1] if len(sys.argv) > 1 else '../sample'
os.makedirs(out, exist_ok=True)

# ── 형식별 최소 생성기 (외부 라이브러리 없음) ────────────────────────────
def xml_escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def make_docx(path, paragraphs):
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    paras = ''.join(f'<w:p><w:r><w:t>{xml_escape(p)}</w:t></w:r></w:p>' for p in paragraphs)
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f'<w:body>{paras}</w:body></w:document>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', doc)

def make_xlsx(path, rows):
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
          '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
              '</Relationships>')
    def cell(r, c, v):
        col = chr(ord('A') + c)
        return f'<c r="{col}{r}" t="inlineStr"><is><t>{xml_escape(str(v))}</t></is></c>'
    body = ''.join(f'<row r="{i+1}">' + ''.join(cell(i + 1, j, v) for j, v in enumerate(row)) + '</row>' for i, row in enumerate(rows))
    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f'<sheetData>{body}</sheetData></worksheet>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wbrels)
        z.writestr('xl/worksheets/sheet1.xml', sheet)

def make_pptx(path, slides):
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
          + ''.join(f'<Override PartName="/ppt/slides/slide{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(len(slides)))
          + '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
            '</Relationships>')
    pres = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<p:sldIdLst>' + ''.join(f'<p:sldId id="{256+i}" r:id="rId{i+1}"/>' for i in range(len(slides))) + '</p:sldIdLst></p:presentation>')
    prels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             + ''.join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i+1}.xml"/>' for i in range(len(slides)))
             + '</Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('ppt/presentation.xml', pres)
        z.writestr('ppt/_rels/presentation.xml.rels', prels)
        for i, lines in enumerate(slides):
            paras = ''.join(f'<a:p><a:r><a:t>{xml_escape(l)}</a:t></a:r></a:p>' for l in lines)
            sld = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                   f'<p:cSld><p:spTree><p:sp><p:txBody>{paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
            z.writestr(f'ppt/slides/slide{i+1}.xml', sld)

def make_pdf(path, lines):
    # 최소 PDF (비압축, ASCII) — 텍스트 레이어 추출 가능. 한글은 표준 14폰트로 못 넣는다.
    content = "BT /F1 11 Tf 40 780 Td 14 TL\n"
    for ln in lines:
        safe = ln.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')
        content += f"({safe}) Tj T*\n"
    content += "ET"
    cb = content.encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(cb)).encode() + b" >>\nstream\n" + cb + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out_b = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out_b))
        out_b += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out_b)
    out_b += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out_b += f"{off:010d} 00000 n \n".encode()
    out_b += (f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\n"
              f"startxref\n{xref}\n%%EOF\n").encode()
    open(path, 'wb').write(out_b)

def make_text(path, text):
    open(path, 'w', encoding='utf-8').write(text)

# ── 본문 ────────────────────────────────────────────────────────────────
REG = [
    "문서관리규정",
    "제1조(목적) 이 규정은 우정사업본부의 문서 등급 표시와 검증 체계의 운영에 필요한 사항을 정함을 목적으로 한다.",
    "제2조(정의) 이 규정에서 사용하는 용어의 뜻은 다음과 같다. 1. 라벨이란 문서에 부여된 서명된 등급 표시를 말한다. 2. 원장이란 발급 사실이 기록되는 추가 전용 장부를 말한다.",
    "제3조(발급) 문서를 생산한 부서의 장은 지체 없이 라벨 발급을 요청하여야 한다.",
    "제4조(검증) 게이트 운영 부서는 문서 반출 전 라벨을 검증하여야 한다.",
    "제5조(폐기) 라벨의 폐기는 원장에 이벤트로 기록하며 삭제하지 아니한다.",
]
REG_REV = [REG[0] + " (개정안)", REG[1], REG[2],
           "제3조(발급) 문서를 생산한 부서의 장은 3일 이내에 라벨 발급을 요청하여야 한다.",
           REG[4], REG[5],
           "제6조(기관 간 유통) 타 기관으로 반출되는 문서는 등가성 협정에 따라 등급을 번역하여 검증한다."]
REPORT_EN = [
    "Security Grade Handling Report 2026.",
    "Section 1. Every document issued by the postal service must carry a signed grade label.",
    "Section 2. The ledger records every issuance event and never deletes a row.",
    "Section 3. Gates verify the label signature and consult the ledger before release.",
    "Section 4. Revocation is recorded as an event, and destroyed documents keep evidence rows.",
    "Section 5. Cross-agency release relies on equivalence treaties that translate grades.",
]
WEEKLY3 = "# 주간보고 9월 3주\n\n- 문서관리규정 개정안 부서 회람 완료\n- 라벨 발급 건수 42건 (전주 대비 +8)\n- 게이트 검증 오탐 1건 원인 분석 중\n- 다음 주: 행안부 협정 갱신 협의\n"
WEEKLY4 = "# 주간보고 9월 4주\n\n- 개정안 공개 심의 상정\n- 라벨 발급 건수 51건\n- 행안부 협정 갱신 협의 착수\n- 스마트우체국 보도자료 배포\n"
CONTRACT = [
    "물류 위탁 계약서",
    "제1조(목적) 본 계약은 우정사업본부(이하 갑)와 한빛물류 주식회사(이하 을) 간 소포 물류 위탁에 관한 사항을 정한다.",
    "제2조(계약기간) 2026년 10월 1일부터 2027년 9월 30일까지로 한다.",
    "제3조(위탁료) 월 위탁료는 별첨 단가표에 따르며, 물량 변동 시 분기별로 정산한다.",
    "제4조(비밀유지) 을은 계약 이행 중 알게 된 갑의 영업정보를 제3자에게 누설하여서는 아니 된다.",
    "제5조(손해배상) 을의 귀책으로 갑에게 손해가 발생한 경우 을은 이를 배상한다.",
]
PRICE_ROWS = [["구간", "중량(kg)", "단가(원)", "비고"], ["동일권역", "~2", "1,850", ""], ["동일권역", "2~5", "2,400", ""],
              ["타권역", "~2", "2,300", ""], ["타권역", "2~5", "3,100", "도서지역 +700"], ["익일특급", "~5", "4,900", "영업기밀"]]
HIRE_SLIDES = [["2026년 하반기 채용계획", "우정사업본부 인사과"],
               ["채용 규모", "일반직 9급 120명, 우정직 85명, 전산직 12명", "지역별 배분은 별첨"],
               ["일정", "공고 10월 6일, 필기 11월 15일, 면접 12월 첫째 주", "합격자 개인정보는 채용 종료 후 파기"]]
APPLICANTS = "접수번호,성명,생년,지원분야,연락처\n2026-0001,홍길동,1998,일반직,010-0000-0001\n2026-0002,김영희,2001,전산직,010-0000-0002\n2026-0003,이철수,1995,우정직,010-0000-0003\n"
PRESS = "보도자료 — 우편요금 체계 개편 안내\n\n우정사업본부는 2026년 11월 1일부터 소포 요금 구간을 단순화하고 도서지역 추가요금을 인하한다고 밝혔다.\n이번 개편으로 이용자의 요금 예측 가능성이 높아지고 소상공인 부담이 줄어들 것으로 기대된다.\n문의: 우정사업본부 우편정책과\n"
PRESS2 = "# 보도자료 — 스마트우체국 시범 운영\n\n우정사업본부는 무인 접수·픽업 기능을 갖춘 스마트우체국을 세종·대전 3곳에서 시범 운영한다.\n24시간 소포 접수와 등기 수령이 가능하며, 내년 상반기 전국 확대를 검토한다.\n"
PRIVACY = [
    "개인정보 처리방침 v3",
    "제1조(처리 목적) 우정사업본부는 우편·예금·보험 서비스 제공을 위하여 최소한의 개인정보를 처리한다.",
    "제2조(처리 항목) 성명, 주소, 연락처, 계좌번호를 처리하며 민감정보는 처리하지 아니한다.",
    "제3조(보유 기간) 개인정보는 수집 목적 달성 후 5년간 보관하고 지체 없이 파기한다.",
    "제4조(제3자 제공) 법령에 근거가 있는 경우를 제외하고 제3자에게 제공하지 아니한다.",
]
PRIVACY_REV = [PRIVACY[0].replace("v3", "v4"), PRIVACY[1], PRIVACY[2],
               "제3조(보유 기간) 개인정보는 수집 목적 달성 후 3년간 보관하고 지체 없이 파기한다. 다만 법령이 정한 경우 그 기간에 따른다.",
               PRIVACY[4], "제5조(권리 보장) 정보주체는 열람·정정·삭제·처리정지를 요구할 수 있다."]
MINUTES = ["정보화추진위원회 회의록 (2026-09-18)", "참석: 정보화담당관, 총무과장, 보안담당",
           "안건 1. LedgerMarker 도입 범위 — 1단계 총무·기획 문서부터 적용하기로 함.",
           "안건 2. 기관 간 협정 — 행안부·국세청과 기체결, 과기부 협정은 연말 만료 예정으로 갱신 필요.",
           "안건 3. 개인정보 문서 등급 — 지원자 명부는 C, 채용계획은 S로 분류."]
INNO_MANUAL = "# LedgerMarker 운영 매뉴얼\n\n## 발급\n`lm issue <파일> --grade S` 로 라벨을 발급한다. 사이드카(.lmsig)가 기본이며 `--embed` 로 내장한다.\n\n## 검증\n`lm verify <파일> --level 2` 로 서명·원장·폐기·유효기간·협정 다섯 항목을 확인한다.\n\n## 원장\n`lm ledger verify` 로 해시체인 무결성을 점검하고 `lm ledger checkpoint --sign` 으로 봉인한다.\n"
INNO_SPEC = ["제품 기능 명세서 — LedgerMarker 2.7",
             "1. 라벨 발급: 문서 해시에 등급·근거·계보를 담아 기관 키로 서명한다. 발급 사실은 추가 전용 원장에 기록된다.",
             "2. 검증: 서명, 원장 등록, 폐기 여부, 유효기간, 기관 간 협정의 다섯 항목을 분리해 보고한다.",
             "3. 재식별: 원시 해시, 정규화 텍스트 해시, MinHash 지문, docsim 의미 비교의 네 단으로 라벨을 잃은 파일의 정체를 되찾는다.",
             "4. 복원: 동일 파일은 원본 라벨을 회수하고 수정본은 원본 귀속을 상속한 새 라벨을 발급한다."]
INNO_SUMMARY = ("LedgerMarker 2.7 요약. 문서 지문에 등급과 출처를 실어 기관이 서명하고, 지울 수 없는 장부에 남긴다. "
                "확인 단계는 서명·장부·취소·기한·협정으로 나뉜다. 라벨이 사라진 파일은 해시, 본문 해시, 유사도 지문, 의미 비교 순으로 되찾는다. "
                "같은 파일이면 라벨을 되살리고 고친 파일이면 원본을 이어받은 라벨을 새로 낸다.")
MOIS_GUIDE = ["공공기관 보안업무 지침 (행정안전부)",
              "제1조 이 지침은 공공기관이 생산·유통하는 전자문서의 보안등급 표시와 기관 간 유통 절차를 정한다.",
              "제2조 보안등급은 C(비밀)·S(민감)·O(공개)의 3단계로 하며 C 등급은 기관 외부로 유통하지 아니한다.",
              "제3조 기관 간 유통 시 발급 기관의 등급은 등가성 협정에 따라 수신 기관 등급으로 번역한다.",
              "제4조 협정이 없는 기관 간에는 서명의 진위만 확인하고 등급 번역은 하지 아니한다."]
MOIS_NOTICE = "공지 — 국민신문고 운영 안내\n\n행정안전부는 국민신문고 민원 처리 기한을 7일에서 5일로 단축한다.\n처리 결과는 문자와 전자우편으로 통지한다.\n"
NTS_FORM = "# 종합소득세 신고 안내\n\n신고 기간은 5월 1일부터 5월 31일까지입니다.\n홈택스 또는 손택스에서 전자신고할 수 있으며, 성실신고확인 대상자는 6월 30일까지입니다.\n"
NTS_AUDIT = ["세무조사 계획 (4분기)", "대상: 매출 급증 법인 12개사, 고액 현금거래 개인 30명",
             "기간: 2026년 10월 13일 ~ 12월 19일", "조사반 편성과 대상자 명단은 별도 관리하며 외부 반출을 금지한다."]
MSIT_PLAN = ["디지털플랫폼정부 추진계획 (과학기술정보통신부)",
             "1. 비전: 모든 데이터가 연결되는 디지털 플랫폼 위에서 국민·기업·정부가 함께 문제를 해결한다.",
             "2. 과제: 공공 데이터 개방 확대, 기관 간 문서 유통 표준화, 보안등급 상호 인정 체계 구축.",
             "3. 일정: 2026년 하반기 시범, 2027년 확산."]
MSIT_STATS = "연도,초고속인터넷 가입(만),이동전화 가입(만),5G 비중(%)\n2024,2410,8320,61\n2025,2450,8410,68\n2026,2480,8490,74\n"

# ── 문서 목록 ───────────────────────────────────────────────────────────
# (id, 경로, 생성기, 본문, 발급기관, 등급, brmPath, 9조 호수, 태그, 옵션)
DOCS = [
    ("reg",         "우정사업본부/총무/문서관리규정.docx",            make_docx, REG,         "KPOST", "S", "총무/문서관리", 5, ["내부규정", "보존5년"], {"semantic": True}),
    ("weekly",      "우정사업본부/기획/주간보고_9월3주.md",            make_text, WEEKLY3,     "KPOST", "O", "기획/주간보고", 0, ["주간보고"], {}),
    ("contract",    "우정사업본부/재무/물류위탁계약서.docx",           make_docx, CONTRACT,    "KPOST", "C", "재무/계약", 7, ["계약서", "영업기밀"], {}),
    ("press",       "우정사업본부/홍보/보도자료_우편요금개편.txt",      make_text, PRESS,       "KPOST", "O", "홍보/보도", 0, ["보도자료"], {}),
    ("reg_rev",     "우정사업본부/총무/문서관리규정_개정안.docx",       make_docx, REG_REV,     "KPOST", "S", "총무/문서관리", 5, ["내부규정", "보존5년"], {"semantic": True, "parent": "reg", "transform": "edit"}),
    ("report",      "우정사업본부/기획/보안등급운영보고서_2026.docx",   make_docx, REPORT_EN,   "KPOST", "O", "기획/성과관리", 0, ["연차보고"], {}),
    ("report_pdf",  "우정사업본부/기획/보안등급운영보고서_2026.pdf",    make_pdf,  REPORT_EN,   "KPOST", "O", "기획/성과관리", 0, ["연차보고"], {"parent": "report", "transform": "convert"}),
    ("hire",        "우정사업본부/인사/채용계획_2026하반기.pptx",       make_pptx, HIRE_SLIDES, "KPOST", "S", "인사/채용", 6, ["개인정보"], {}),
    ("applicants",  "우정사업본부/인사/지원자명부.csv",                make_text, APPLICANTS,  "KPOST", "C", "인사/채용", 6, ["개인정보"], {}),
    ("price",       "우정사업본부/재무/계약단가표.xlsx",               make_xlsx, PRICE_ROWS,  "KPOST", "C", "재무/계약", 7, ["영업기밀"], {}),
    ("privacy",     "우정사업본부/총무/개인정보처리방침_v3.docx",       make_docx, PRIVACY,     "KPOST", "S", "총무/개인정보", 6, ["개인정보", "보존5년"], {"semantic": True}),
    ("minutes",     "우정사업본부/기획/정보화추진회의록.docx",          make_docx, MINUTES,     "KPOST", "S", "기획/정보화", 5, ["회의록"], {"approvalState": "PROVISIONAL"}),
    ("weekly2",     "우정사업본부/기획/주간보고_9월4주.md",            make_text, WEEKLY4,     "KPOST", "O", "기획/주간보고", 0, ["주간보고"], {}),
    ("press2",      "우정사업본부/홍보/보도자료_스마트우체국.md",       make_text, PRESS2,      "KPOST", "O", "홍보/보도", 0, ["보도자료"], {}),
    ("inno_manual", "이노티움/LedgerMarker_운영매뉴얼.md",            make_text, INNO_MANUAL, "INNOTIUM", "O", "개발/문서", 0, ["매뉴얼"], {}),
    ("inno_spec",   "이노티움/제품기능명세서.docx",                   make_docx, INNO_SPEC,   "INNOTIUM", "S", "개발/설계", 7, ["영업기밀"], {"semantic": True}),
    ("inno_summary","이노티움/제품기능명세_요약.txt",                 make_text, INNO_SUMMARY,"INNOTIUM", "S", "개발/설계", 7, ["영업기밀"], {"semantic": True, "parent": "inno_spec", "transform": "extract"}),
    ("mois_guide",  "행정안전부/공공기관_보안업무지침.docx",           make_docx, MOIS_GUIDE,  "MOIS", "S", "정책/보안", 5, ["지침"], {}),
    ("mois_notice", "행정안전부/공지_국민신문고_운영.txt",             make_text, MOIS_NOTICE, "MOIS", "O", "민원/공지", 0, [], {}),
    ("nts_form",    "국세청/종합소득세_신고안내.md",                   make_text, NTS_FORM,    "NTS", "O", "세정/안내", 0, [], {}),
    ("nts_audit",   "국세청/세무조사_계획_4분기.docx",                 make_docx, NTS_AUDIT,   "NTS", "C", "세정/조사", 4, ["조사계획"], {}),
    ("msit_plan",   "과학기술정보통신부/디지털플랫폼정부_추진계획.docx", make_docx, MSIT_PLAN,   "MSIT", "S", "정책/디지털", 5, ["추진계획"], {}),
    ("msit_stats",  "과학기술정보통신부/ICT_통계자료_2026.csv",         make_text, MSIT_STATS,  "MSIT", "O", "통계/공개", 0, [], {}),
    ("privacy_rev", "우정사업본부/총무/개인정보처리방침_v4.docx",       make_docx, PRIVACY_REV, "KPOST", "S", "총무/개인정보", 6, ["개인정보", "보존5년"], {"semantic": True, "parent": "privacy", "transform": "edit"}),
]

by_id = {}
for d in DOCS:
    did, rel, gen, body, org, grade, brm, clause, kws, opt = d
    path = os.path.join(out, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    gen(path, body)
    step = {"type": "issue", "id": did, "file": rel, "grade": grade, "issuerOrg": org, "brmPath": brm}
    if clause:
        step["basisClause"] = clause
    if kws:
        step["keywords"] = kws
    step.update(opt)
    by_id[did] = step

def issue(*ids):
    return [by_id[i] for i in ids]

def obs(kind, doc, frm, to, at, **kw):
    o = {"type": "observe", "kind": kind, "doc": doc, "from": frm, "to": to, "at": at}
    o.update(kw)
    return o

def crossing(doc, frm, to, day, translated=None, treaty="translated", hint="allow", note=None, minutes=5):
    """SENT + VERIFIED 한 쌍. day = 'YYYY-MM-DD'."""
    sent = obs("SENT", doc, frm, to, f"{day}T09:00:00Z")
    ver = obs("VERIFIED", doc, frm, to, f"{day}T09:{minutes:02d}:00Z", treaty=treaty, verdictHint=hint)
    if translated:
        ver["translatedGrade"] = translated
    if note:
        ver["note"] = note
    return [sent, ver]

steps = []
steps += issue("reg", "weekly", "contract", "press", "reg_rev", "report", "report_pdf")
steps.append({"type": "checkpoint"})
steps += issue("hire", "applicants", "price", "privacy", "minutes", "weekly2", "press2")
steps.append({"type": "regrade", "doc": "reg_rev", "grade": "O", "reason": "공개 심의 통과 (2026-11-14 정보공개심의회)"})
steps.append({"type": "revoke", "doc": "weekly", "reason": "오기재 — 9월 4주 보고로 대체"})
steps += issue("inno_manual", "inno_spec", "inno_summary", "mois_guide", "mois_notice", "nts_form", "nts_audit", "msit_plan", "msit_stats")
steps.append({"type": "destroy", "doc": "contract", "reason": "계약 종료 후 보존기간 만료 — 파기 심의 2026-09-30"})
steps += issue("privacy_rev")
steps.append({"type": "checkpoint"})

# 기관 간 이동·검증 기록 (여권 스탬프·산키). 협정: KPOST↔MOIS·NTS 유효, KPOST↔MSIT 2026-12-31 만료,
# 협정: KPOST↔INNOTIUM(과제 협력, 2026-07-01 ~ 2027-12-31)·KPOST↔MOIS 유효, KPOST↔MSIT 2026-12-31 만료.
# NTS 는 어느 기관과도 협정 없음(서명만) — MOIS↔NTS·KPOST↔NTS 가 협정 없음 사례.
# C·PROVISIONAL 은 번역 불가 → 차단.
steps += crossing("press", "KPOST", "MOIS", "2026-10-02", "O")
steps += crossing("press", "KPOST", "MSIT", "2026-10-05", "O")
steps += crossing("press", "KPOST", "NTS", "2026-10-06", None, "no_treaty", "review", "우정-국세청 협정 없음 — 서명 진위만 확인")
steps += crossing("reg_rev", "KPOST", "MOIS", "2026-10-08", "S")
steps += crossing("mois_guide", "MOIS", "KPOST", "2026-10-12", "S")
steps += crossing("mois_guide", "MOIS", "NTS", "2026-10-13", None, "no_treaty", "review", "행안부-국세청 협정 없음 — 서명 진위만 확인")
steps += crossing("hire", "KPOST", "MOIS", "2026-10-15", "S")
steps += crossing("contract", "KPOST", "MOIS", "2026-10-20", None, "not_translatable", "deny", "C(비밀)은 기관 내부 전용 — 반출 차단")
steps += crossing("msit_plan", "MSIT", "KPOST", "2026-10-20", "S")
steps += crossing("reg_rev", "KPOST", "NTS", "2026-10-29", None, "no_treaty", "review", "협정 없음 — 서명 진위만 확인, 등급 미번역")
steps += crossing("hire", "KPOST", "INNOTIUM", "2026-10-30", "S", "translated", "review", "반출 승인자 확인 대기")
steps += crossing("minutes", "KPOST", "MOIS", "2026-11-02", None, "not_translatable", "deny", "PROVISIONAL 라벨은 기관 내부 통행 전용")
steps += crossing("reg_rev", "KPOST", "INNOTIUM", "2026-11-05", "S", "translated", "allow", "과제 협력 협정(kpost-innotium-2026-01)으로 번역")
steps += crossing("nts_form", "NTS", "KPOST", "2026-11-10", None, "no_treaty", "review")
steps += crossing("inno_manual", "INNOTIUM", "KPOST", "2026-11-20", "O")
steps += crossing("inno_spec", "INNOTIUM", "KPOST", "2026-12-05", "S")
steps += crossing("weekly", "KPOST", "MOIS", "2026-11-25", "O", "translated", "deny", "폐기된 라벨 — 원장 REVOKE 확인")
steps += crossing("privacy_rev", "KPOST", "MOIS", "2026-12-01", "S")
steps += crossing("press2", "KPOST", "MSIT", "2026-12-10", "O")
steps += crossing("reg_rev", "KPOST", "MSIT", "2026-12-22", "O")
steps += crossing("msit_plan", "MSIT", "KPOST", "2027-01-15", None, "expired", "review", "KPOST-MSIT 협정 2026-12-31 만료")
steps += crossing("reg_rev", "KPOST", "MSIT", "2027-02-16", None, "expired", "review", "협정 만료 후 — 서명만 확인")
steps += crossing("report_pdf", "KPOST", "INNOTIUM", "2027-02-20", "O")
steps += crossing("press2", "KPOST", "MOIS", "2027-03-03", "O")

json.dump({"steps": steps}, open(os.path.join(out, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"샘플 {len(DOCS)}개 파일, 단계 {len(steps)}개 → {out}")
