#!/usr/bin/env python3
# 유사도 테스트 시연용 케이스별 파일 세트 생성 → /Users/chris/LedgerMarker/demo/
#
# 케이스 1  수정본: 자카드(MinHash) 높음 · 의미(docsim 讀心) 높음 — 문장 몇 개만 고친 개정안
# 케이스 2  재작성본: 자카드 낮음 · 의미 높음 — 같은 내용을 전혀 다른 어휘·문장으로 다시 씀
# 케이스 3  무관(대조군): 둘 다 낮음
#
# 형식: txt · md · docx (한글), 그리고 pdf 비교용 영문 세트(txt · docx · pdf).
# PDF 는 표준 14폰트만 쓰는 최소 PDF 라 한글을 넣을 수 없어 영문으로만 만든다
# (한글 PDF 텍스트 추출은 폰트 인코딩에 따라 제한 — 제출문서 §4.6).
#
# 사용: python3 scripts/make-demo-cases.py /Users/chris/LedgerMarker/demo
import os, sys, zipfile

out = sys.argv[1] if len(sys.argv) > 1 else '../demo'

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

def make_pdf(path, lines):
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

def write_set(folder, stem, paragraphs, formats):
    """같은 본문을 여러 형식으로. formats ⊆ {txt, md, docx, pdf}"""
    os.makedirs(folder, exist_ok=True)
    text = '\n'.join(paragraphs) + '\n'
    if 'txt' in formats:
        open(os.path.join(folder, stem + '.txt'), 'w', encoding='utf-8').write(text)
    if 'md' in formats:
        md = '# ' + paragraphs[0] + '\n\n' + '\n\n'.join(paragraphs[1:]) + '\n'
        open(os.path.join(folder, stem + '.md'), 'w', encoding='utf-8').write(md)
    if 'docx' in formats:
        make_docx(os.path.join(folder, stem + '.docx'), paragraphs)
    if 'pdf' in formats:
        make_pdf(os.path.join(folder, stem + '.pdf'), paragraphs)

# ── 케이스 1: 수정본 (자카드 높음 · 의미 높음) ───────────────────────────
K1_A = [
    "문서관리규정",
    "제1조(목적) 이 규정은 우정사업본부의 문서 등급 표시와 검증 체계의 운영에 필요한 사항을 정함을 목적으로 한다.",
    "제2조(정의) 이 규정에서 사용하는 용어의 뜻은 다음과 같다. 1. 라벨이란 문서에 부여된 서명된 등급 표시를 말한다. 2. 원장이란 발급 사실이 기록되는 추가 전용 장부를 말한다.",
    "제3조(발급) 문서를 생산한 부서의 장은 지체 없이 라벨 발급을 요청하여야 한다.",
    "제4조(검증) 게이트 운영 부서는 문서 반출 전 라벨을 검증하여야 한다.",
    "제5조(폐기) 라벨의 폐기는 원장에 이벤트로 기록하며 삭제하지 아니한다.",
    "제6조(보존) 원장 기록은 영구 보존하며 체크포인트로 주기적으로 봉인한다.",
]
K1_B = [
    "문서관리규정 (개정안)",
    K1_A[1], K1_A[2],
    "제3조(발급) 문서를 생산한 부서의 장은 3일 이내에 라벨 발급을 요청하여야 한다.",
    K1_A[4], K1_A[5], K1_A[6],
    "제7조(기관 간 유통) 타 기관으로 반출되는 문서는 등가성 협정에 따라 등급을 번역하여 검증한다.",
]
E1_A = [
    "Document Grade Handling Regulation",
    "Article 1 (Purpose) This regulation defines the operation of the document grade labeling and verification system of the postal service.",
    "Article 2 (Definitions) A label is a signed grade mark attached to a document. The ledger is an append-only register of issuance events.",
    "Article 3 (Issuance) The head of the producing department shall request a label without delay.",
    "Article 4 (Verification) The gate operation team shall verify the label before any document leaves the organization.",
    "Article 5 (Revocation) Revocation is recorded as a ledger event and never deleted.",
]
E1_B = [
    "Document Grade Handling Regulation (Revised)",
    E1_A[1], E1_A[2],
    "Article 3 (Issuance) The head of the producing department shall request a label within three business days.",
    E1_A[4], E1_A[5],
    "Article 6 (Cross-agency release) Documents released to another agency are verified with the grade translated by an equivalence treaty.",
]

# ── 케이스 2: 재작성본 (자카드 낮음 · 의미 높음) ─────────────────────────
# 같은 내용을 전혀 다른 어휘·문장 구조로 다시 쓴다. 문자 5-gram 이 거의 겹치지 않도록
# 용어(라벨→꼬리표, 원장→장부, 검증→확인, 반출→외부 전달 …)를 바꾼다.
K2_A = [
    "개인정보 처리방침",
    "제1조(처리 목적) 우정사업본부는 우편·예금·보험 서비스 제공을 위하여 최소한의 개인정보를 처리한다.",
    "제2조(처리 항목) 성명, 주소, 연락처, 계좌번호를 처리하며 민감정보는 처리하지 아니한다.",
    "제3조(보유 기간) 개인정보는 수집 목적 달성 후 5년간 보관하고 지체 없이 파기한다.",
    "제4조(제3자 제공) 법령에 근거가 있는 경우를 제외하고 제3자에게 제공하지 아니한다.",
    "제5조(권리 보장) 정보주체는 언제든지 열람·정정·삭제·처리정지를 요구할 수 있다.",
]
# 실측: 핵심 명사(개인정보·민감정보·제3자·정보주체·5년)는 남기고 문장 구조만 바꾸면
# 자카드 0.05 / 의미 0.91 (docsim 판정 "재작성"). 어휘까지 전부 바꾸면 의미도 0.75 로 떨어진다.
K2_B = [
    "개인정보 취급 원칙 안내",
    "우정사업본부가 개인정보를 다루는 이유는 우편, 예금, 보험이라는 세 가지 서비스를 제공하기 위해서이며, 그 범위는 꼭 필요한 최소한으로 한정됩니다.",
    "다루는 개인정보 항목은 성명과 주소, 연락처, 계좌번호 네 가지뿐이고, 건강·사상 같은 민감정보는 아예 수집하지 않습니다.",
    "수집 목적이 달성되면 개인정보를 5년 동안 보관한 다음 곧바로 파기합니다.",
    "개인정보를 제3자에게 제공하는 일은 법령에 근거가 있을 때에만 이루어집니다.",
    "정보주체는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 언제든 요구할 권리가 있습니다.",
]
E2_A = [
    "Privacy Policy",
    "Article 1 (Purpose) The postal service processes the minimum personal data required to provide mail, deposit and insurance services.",
    "Article 2 (Items) Name, address, contact number and account number are processed; sensitive data is not processed.",
    "Article 3 (Retention) Personal data is kept for five years after the purpose is achieved and then destroyed without delay.",
    "Article 4 (Third parties) Data is not provided to third parties unless required by law.",
    "Article 5 (Rights) Data subjects may request access, correction, deletion or suspension at any time.",
]
# 실측: 자카드 0.05 / 의미 0.75 ("일부 유사"). 의미 엔진(ko-sroberta)이 한국어 특화라
# 영문 쌍은 한글 쌍보다 의미 점수가 낮게 나온다 — 시연 시 한글 쌍을 주로 쓴다.
E2_B = [
    "Customer Information Protection Notice",
    "Korea Post gathers and uses only the smallest amount of customer information needed to run its mail, savings and insurance operations.",
    "The items gathered are limited to name, home address, phone number and bank account; health, religion and similar delicate details are never asked for.",
    "When the reason for holding the information has ended, it is kept for 5 years and then permanently erased.",
    "Customer information is handed to outside organizations only where a statute explicitly requires it.",
    "Every customer may at any moment ask to view, amend, erase or halt the use of their own information.",
]

# ── 케이스 3: 무관 (대조군) ─────────────────────────────────────────────
K3_A = K1_A
K3_B = [
    "스마트우체국 시범 운영 안내",
    "우정사업본부는 무인 접수와 픽업 기능을 갖춘 스마트우체국을 세종과 대전 세 곳에서 시범 운영한다.",
    "이용자는 24시간 소포를 접수하고 등기를 수령할 수 있으며, 앱으로 보관함 위치와 비밀번호를 안내받는다.",
    "내년 상반기 전국 확대 여부는 시범 운영 결과와 이용자 만족도를 보고 결정한다.",
]
E3_B = [
    "Smart Post Office Pilot",
    "The postal service is piloting unmanned smart post offices in three locations with round-the-clock parcel drop-off and pick-up lockers.",
    "Users receive locker location and access codes through the mobile app.",
    "Nationwide expansion will be decided after reviewing pilot results and customer satisfaction.",
]

cases = [
    ("1_수정본_자카드높음_의미높음", [
        ("A_원본_문서관리규정", K1_A, ['txt', 'md', 'docx']),
        ("B_수정본_문서관리규정_개정안", K1_B, ['txt', 'md', 'docx']),
        ("A_original_regulation", E1_A, ['txt', 'docx', 'pdf']),
        ("B_revised_regulation", E1_B, ['txt', 'docx', 'pdf']),
    ]),
    ("2_재작성본_자카드낮음_의미높음", [
        ("A_원본_개인정보처리방침", K2_A, ['txt', 'md', 'docx']),
        ("B_재작성_고객신상자료원칙", K2_B, ['txt', 'md', 'docx']),
        ("A_original_privacy_policy", E2_A, ['txt', 'docx', 'pdf']),
        ("B_rewritten_privacy_policy", E2_B, ['txt', 'docx', 'pdf']),
    ]),
    ("3_무관_대조군_둘다낮음", [
        ("A_원본_문서관리규정", K3_A, ['txt', 'docx']),
        ("B_무관_스마트우체국안내", K3_B, ['txt', 'docx']),
        ("A_original_regulation", E1_A, ['txt', 'pdf']),
        ("B_unrelated_smart_post_office", E3_B, ['txt', 'pdf']),
    ]),
]

for folder, sets in cases:
    for stem, paras, fmts in sets:
        write_set(os.path.join(out, folder), stem, paras, fmts)

print(f"케이스 {len(cases)}개 → {out}")
for folder, _ in cases:
    print(' ', folder, '·', ', '.join(sorted(os.listdir(os.path.join(out, folder)))))
