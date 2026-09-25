#!/usr/bin/env python3
# PoC 시연용 실제 파일 생성: 규정.docx (한글 본문), 공지.hwp(가짜 CFB),
# report.docx(ASCII) + report.pdf (같은 내용 — 변환 파생 시연용)
import zipfile, sys, os

out = sys.argv[1] if len(sys.argv) > 1 else '.'

KO_BODY = [
    "제1조(목적) 이 규정은 우정사업본부의 문서 등급 표시와 검증 체계의 운영에 필요한 사항을 정함을 목적으로 한다.",
    "제2조(정의) 이 규정에서 사용하는 용어의 뜻은 다음과 같다.",
    "1. 라벨이란 문서에 부여된 서명된 등급 표시를 말한다.",
    "2. 원장이란 발급 사실이 기록되는 추가 전용 장부를 말한다.",
    "제3조(발급) 문서를 생산한 부서의 장은 지체 없이 라벨 발급을 요청하여야 한다.",
    "제4조(검증) 게이트 운영 부서는 문서 반출 전 라벨을 검증하여야 한다.",
    "제5조(폐기) 라벨의 폐기는 원장에 이벤트로 기록하며 삭제하지 아니한다.",
]

EN_BODY = [
    "Security Grade Handling Report 2026.",
    "Section 1. Every document issued by the postal service must carry a signed grade label.",
    "Section 2. The ledger records every issuance event and never deletes a row.",
    "Section 3. Gates verify the label signature and consult the ledger before release.",
    "Section 4. Revocation is recorded as an event, and destroyed documents keep evidence rows.",
]

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
    paras = ''.join(f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paragraphs)
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f'<w:body>{paras}</w:body></w:document>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', doc)

def make_pdf(path, lines):
    # 최소 PDF (비압축, ASCII) — 텍스트 레이어 추출 가능
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

def make_fake_hwp(path):
    # CFB 시그니처 + 더미 섹터 (뷰어 실측 전 구조 시연용)
    data = bytes.fromhex('D0CF11E0A1B11AE1') + b'\x00' * 3576
    open(path, 'wb').write(data)

make_docx(os.path.join(out, '문서관리규정.docx'), KO_BODY)
# 수정본: 제3조 변경 + 부칙 추가
mod = KO_BODY.copy()
mod[4] = "제3조(발급 절차) 문서 생산 부서의 장은 3일 이내에 라벨 발급을 신청한다."
mod.append("부칙: 이 규정은 공포한 날부터 시행한다.")
make_docx(os.path.join(out, '문서관리규정_개정안.docx'), mod)
make_docx(os.path.join(out, 'report.docx'), EN_BODY)
make_pdf(os.path.join(out, 'report.pdf'), EN_BODY)
make_fake_hwp(os.path.join(out, '공문.hwp'))
print("created:", os.listdir(out))
