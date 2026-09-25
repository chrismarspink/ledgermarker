#!/bin/sh
# 부착 보존성 실측 (SigNET roundtrip 이식) — 라벨 부착본과 편집기 재저장본을
# 비교해 무엇이 살아남는지 측정한다.
# 사용: ./scripts/resave-measure.sh <라벨 부착본> <재저장본>
# 전제: LM 서버 가동, bin/lm 빌드. 재저장본은 실제 편집기(한글·Word 등)에서
# "저장"만 수행한 파일을 쓴다 — 이 측정이 H-1(파트 보존)·H-4/H-5(해시 대상)의 답이다.
set -e
cd "$(dirname "$0")/.."
export LM_SERVER="${LM_SERVER:-http://localhost:8090}"
BEFORE="$1"; AFTER="$2"
[ -f "$BEFORE" ] && [ -f "$AFTER" ] || { echo "사용법: $0 <부착본> <재저장본>"; exit 1; }
LM=./bin/lm

J() { $LM verify "$1" --json 2>/dev/null | python3 -c "
import json,sys
r = json.loads(sys.stdin.readline())['result']
sig = r['checks']['signature']; led = r['checks']['ledger']
doc = r['attribution'].get('docGuid','-'); reasons = r.get('reasons',[])
print(f\"{sig}|{led}|{doc}|{'text' if 'reidentified_by_text_hash' in reasons else 'raw'}\")"; }

B=$(J "$BEFORE"); A=$(J "$AFTER")
bs=$(echo "$B"|cut -d'|' -f1); bd=$(echo "$B"|cut -d'|' -f3)
as=$(echo "$A"|cut -d'|' -f1); al=$(echo "$A"|cut -d'|' -f2); ad=$(echo "$A"|cut -d'|' -f3); am=$(echo "$A"|cut -d'|' -f4)

echo "━━ 부착 보존성 실측 결과 ━━"
echo "부착본  : 서명=$bs docGuid=$bd"
echo "재저장본: 서명=$as 원장=$al docGuid=$ad 식별경로=$am"
echo "─────────────────────────"
[ "$as" != "absent" ] && echo "H-1 라벨 생존        : O (내장 라벨 보존)" || echo "H-1 라벨 생존        : X (재저장이 라벨 제거 — 원장 폴백으로 진행)"
[ "$al" = "registered" ] && [ "$am" = "raw" ] && echo "H-4 원시 해시 유지   : O" || echo "H-4 원시 해시 유지   : X (재저장으로 바이트 변경)"
[ "$al" = "registered" ] && [ "$ad" = "$bd" ] && echo "H-5 재식별(동일문서) : O (경로: $am 해시)" || echo "H-5 재식별(동일문서) : X — 지문(lm identify)으로 폴백하세요"
[ "$al" = "registered" ] && [ "$as" = "absent" ] && echo "복원 가능            : O → lm restore '$AFTER'"
