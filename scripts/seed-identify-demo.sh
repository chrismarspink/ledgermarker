#!/bin/sh
# 재식별 시연용 데모 문서 세트를 최신 지문(공백 제거 정규화·32밴드 LSH)으로
# 발급하고, docx→PDF 변환본 식별 100%까지 자동 확인한다.
#
# 사용: ./scripts/seed-identify-demo.sh [출력디렉터리]
# 전제: 서버 가동(./deploy/run-demo.sh), bin/lm 빌드, Pages(macOS) — PDF 변환용.
#       docsim 정밀 판정까지 저장하려면 아래 환경변수 필요:
#         export LM_DOCSIM=$HOME/docsim/.venv/bin/docsim
#         export DOCSIM_HMAC_KEY=lm-poc-demo-key
set -e
cd "$(dirname "$0")/.."
export LM_SERVER="${LM_SERVER:-http://localhost:8090}"
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}" # 한글 glob 매칭
W="${1:-$HOME/LedgerMarker/demo-identify}"
mkdir -p "$W"
LM=./bin/lm

echo "출력 디렉터리: $W"
[ -n "$LM_DOCSIM" ] && echo "docsim 지문: 켜짐 ($LM_DOCSIM)" || echo "docsim 지문: 꺼짐 (유사도만, 정밀 판정 없음)"

# ── 1) 시연 문서 생성 (docx + txt + md) ──────────────────────
python3 - "$W" <<'PY'
import sys, zipfile, os
W = sys.argv[1]
DOCS = {
  "문서관리규정": [
    "제1조(목적) 이 규정은 우정사업본부의 문서 등급 표시와 검증 체계의 운영에 필요한 사항을 정함을 목적으로 한다.",
    "제2조(정의) 라벨이란 문서에 부여된 서명된 등급 표시를 말하며, 원장이란 발급 사실이 기록되는 추가 전용 장부를 말한다.",
    "제3조(발급) 문서를 생산한 부서의 장은 지체 없이 라벨 발급을 요청하여야 한다.",
    "제4조(검증) 게이트 운영 부서는 문서 반출 전 라벨을 검증하여야 한다.",
    "제5조(폐기) 라벨의 폐기는 원장에 이벤트로 기록하며 삭제하지 아니한다.",
  ],
  "보안업무지침": [
    "제1조(목적) 이 지침은 기관 간 문서 반출입 시 보안 등급의 상호 인정에 관한 사항을 규정한다.",
    "제2조(협정) 등가성 협정을 체결한 기관의 등급은 우리 기관 기준으로 번역하여 적용한다.",
    "제3조(감사) 모든 반출입 이력은 원장에 기록되며 사후 감사의 대상이 된다.",
  ],
}
def make_docx(path, lines):
    ct='<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    rels='<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    p=''.join(f'<w:p><w:r><w:t>{l}</w:t></w:r></w:p>' for l in lines)
    doc=f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{p}</w:body></w:document>'
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',ct); z.writestr('_rels/.rels',rels); z.writestr('word/document.xml',doc)
for name, lines in DOCS.items():
    make_docx(os.path.join(W, name+".docx"), lines)
    open(os.path.join(W, name+".txt"), "w").write("\n".join(lines)+"\n")
print("생성:", ", ".join(os.listdir(W)))
PY

# ── 2) docx 원본 발급 (최신 지문 색인) ───────────────────────
echo
echo "── 원본 발급 (최신 지문) ──"
for f in "$W"/*.docx; do
  rm -f "$f.lmsig"
  $LM issue "$f" --grade S | head -1
done

# ── 3) docx → PDF 변환 (Pages) ───────────────────────────────
echo
echo "── docx → PDF 변환 (Pages) ──"
for f in "$W"/*.docx; do
  base=$(basename "$f" .docx)
  osascript -e "tell application \"Pages\" to activate" \
    -e "tell application \"Pages\" to set d to open POSIX file \"$f\"" \
    -e "delay 2" \
    -e "tell application \"Pages\" to export d to POSIX file \"$W/${base}_변환.pdf\" as PDF" \
    -e "tell application \"Pages\" to close d saving no" >/dev/null 2>&1 || {
      echo "  (Pages 변환 실패 — PDF 변환 시연은 수동으로: $f)"; continue; }
  echo "  $base.docx → ${base}_변환.pdf"
done
osascript -e "tell application \"Pages\" to quit" >/dev/null 2>&1 || true
# 파일 시스템 플러시 대기 (Pages export 비동기 완료 보장)
sleep 1

# ── 4) 변환 PDF로 원본 재식별 확인 ───────────────────────────
echo
echo "── 변환 PDF → 원본 docx 재식별 ──"
ok=0; total=0
# docx를 순회해 대응 PDF를 확인한다(한글 리터럴 glob 회피).
for f in "$W"/*.docx; do
  base=$(basename "$f" .docx)
  pdf="$W/${base}_변환.pdf"
  [ -f "$pdf" ] || continue
  total=$((total+1))
  line=$($LM identify "$pdf" 2>/dev/null | grep -E "^  1\. 유사도" | head -1)
  if echo "$line" | grep -q "100%"; then ok=$((ok+1)); fi
  printf "  %s → %s\n" "$(basename "$pdf")" "$(echo "${line:-미검출}" | sed 's/^ *//')"
done

echo
echo "완료: 변환본 $ok/$total 건 100% 재식별. 산출물: $W"
echo "웹 시연: 검증 탭에 ${W}/*_변환.pdf 드롭 → '유사 문서 찾기'"
