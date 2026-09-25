#!/usr/bin/env bash
# 데모 서버의 조회 API 응답을 정적 JSON 으로 떠서 PWA 빌드에 담는다(GitHub Pages 정적 데모).
# 경로 규칙은 verify-pwa/src/lib/api.js 의 staticPath 와 같다: /v1/<경로>.json (쿼리 무시).
# 사용: ./scripts/snapshot-static-api.sh [서버주소]   (기본 http://localhost:8090)
set -euo pipefail
SRV="${1:-http://localhost:8090}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/verify-pwa/public/v1"
rm -rf "$OUT" && mkdir -p "$OUT"

get() { # get <경로(쿼리 포함)> <저장 경로(v1 이하)>
  mkdir -p "$OUT/$(dirname "$2")"
  curl -sf "$SRV/v1/$1" -o "$OUT/$2.json" || { echo "실패: $1" >&2; return 1; }
}

get healthz healthz
get keys keys
get trust/list trust/list
get treaties treaties
get formats formats
get checkpoints/latest checkpoints/latest
get 'checkpoints?limit=10000' checkpoints
get 'ledger/events?limit=100000' ledger/events
get ledger/verify ledger/verify
get 'observations?limit=100000' observations
get admin/stats admin/stats

# 문서별 계보, 해시별 라벨(콘텐츠 해시·텍스트 해시 모두 — by-hash?kind=text 도 같은 파일 규칙)
python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
ev = json.load(open(f"{out}/ledger/events.json"))["events"]
docs = sorted({e["docGuid"] for e in ev})
hashes = sorted({h for e in ev for h in (e.get("contentHash"), e.get("textHash")) if h})
open(f"{out}/../_snapshot-list.txt", "w").write("\n".join([f"documents/{d}/lineage?depth=10&direction=both documents/{d}/lineage" for d in docs] + [f"labels/by-hash/{h} labels/by-hash/{h}" for h in hashes]))
PY
while read -r src dst; do get "$src" "$dst" || true; done < "$OUT/../_snapshot-list.txt"
rm -f "$OUT/../_snapshot-list.txt"
echo "스냅샷: $(find "$OUT" -name '*.json' | wc -l | tr -d ' ')개 파일 → $OUT (서버 $SRV)"
