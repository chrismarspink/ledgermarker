#!/bin/sh
# innoAI Persistent Tagging PoC — 공모 시나리오 자동 시연
# 사용: ./scripts/poc-demo.sh [작업디렉터리]
# 전제: LM 서버 가동 (./deploy/run-demo.sh), bin/lm 빌드됨
set -e
cd "$(dirname "$0")/.."
export LM_SERVER="${LM_SERVER:-http://localhost:8090}"
W="${1:-$(mktemp -d /tmp/lm-poc.XXXXXX)}"
LM=./bin/lm

echo "작업 디렉터리: $W"
python3 scripts/make-poc-files.py "$W" >/dev/null
step() { printf '\n━━ %s ━━\n' "$1"; }

step "① 파일 안에 라벨 내장 — DOCX(ZIP 코멘트)·HWP(트레일러)"
$LM issue "$W/문서관리규정.docx" --grade S --embed --basis-clause 5
python3 - "$W/문서관리규정.docx" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print("  → 내장 후에도 ZIP 정상 개방 (파일 미손상)")
PY
$LM issue "$W/공문.hwp" --grade S --embed | head -1

step "② 복사 + 파일명 변경 후 동일 파일 식별 (내용 해시 기반)"
cp "$W/문서관리규정.docx" "$W/이름바꾼_v2최종_진짜최종.docx"
$LM verify "$W/이름바꾼_v2최종_진짜최종.docx" | grep -E "귀속|서명"

step "③ 라벨 제거(메타 유실) → 해시로 재식별 → 라벨 복원"
python3 - "$W/문서관리규정.docx" "$W/유실본.docx" <<'PY'
import sys
data = bytearray(open(sys.argv[1],'rb').read())
for i in range(len(data)-22, -1, -1):
    if data[i:i+4] == b'PK\x05\x06' and i+22+(data[i+20]|(data[i+21]<<8)) == len(data):
        data[i+20]=0; data[i+21]=0
        open(sys.argv[2],'wb').write(data[:i+22]); break
print("  라벨(코멘트) 제거본 생성 — 원본 바이트 보존")
PY
$LM verify "$W/유실본.docx" | grep -E "귀속|서명"
$LM restore "$W/유실본.docx" --embed
$LM verify "$W/유실본.docx" | grep "서명"

step "④ 일부 수정본 → 지문(MinHash)으로 원본 연관 식별"
$LM identify "$W/문서관리규정_개정안.docx"

step "⑤ DOCX→PDF 변환 파생관계 식별"
$LM issue "$W/report.docx" --grade O >/dev/null
$LM identify "$W/report.pdf"

step "⑥ 편집기 재저장 시뮬레이션 → 텍스트 해시로 재식별 (SigNET H-5 흡수)"
python3 - "$W/문서관리규정.docx" "$W/재저장본.docx" <<'PY'
import sys, zipfile
# 편집기 재저장 흉내: ZIP 전체 재조립 — 압축 바이트·엔트리 순서가 바뀌고
# 아카이브 코멘트(라벨)도 소실된다. 원시 해시는 완전히 달라진다.
src = zipfile.ZipFile(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_STORED) as out:
    for n in sorted(src.namelist(), reverse=True):
        out.writestr(n, src.read(n))
print("  재저장본 생성 — 바이트 전면 변경 + 라벨 소실 (본문 텍스트만 동일)")
PY
$LM verify "$W/재저장본.docx" | grep -E "귀속|서명"
$LM restore "$W/재저장본.docx"

step "⑦ 이동·수정·변환 이력 — Lineage/Audit (append-only 원장)"
$LM ledger list --limit 6
$LM ledger verify

printf '\n완료. 산출물: %s\n' "$W"
