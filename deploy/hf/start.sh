#!/bin/sh
# 컨테이너 진입점: PostgreSQL 기동 → lmserver(:7860, 웹 포함) → 샘플 원장 적재.
# 디스크가 휘발성(무료 Space)이면 매 기동마다 빈 원장에 샘플을 다시 채운다 — 로더가 멱등이라 같은 원장이 된다.
set -e
cd /app
PGDATA="${PGDATA:-/data/pg}"
if ! mkdir -p "$PGDATA" 2>/dev/null || ! [ -w "$PGDATA" ]; then
  PGDATA=/tmp/pg; mkdir -p "$PGDATA"
fi
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/tmp/initdb.log 2>&1
fi
pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -k /tmp" -l /tmp/pg.log start
until pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
psql -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='ledgermarker'" | grep -q 1 \
  || createdb -h 127.0.0.1 -U postgres ledgermarker

# 키스토어는 이미지에 포함된 데모용 가상 키다(저장소 keystore*/). 협정·샘플·토큰은 run-demo.sh 와 같다.
LM_ISSUER_ORG=KPOST \
LM_KEYSTORE=/app/keystore \
LM_ISSUERS="INNOTIUM:이노티움:/app/keystore-innotium,MOIS:행정안전부:/app/keystore-partners/MOIS,NTS:국세청:/app/keystore-partners/NTS,MSIT:과학기술정보통신부:/app/keystore-partners/MSIT" \
LM_TREATIES=/app/treaties.json \
LM_SAMPLE_DIR=/app/sample \
LM_WEB_DIR=/app/web \
LM_REGRADE_TOKEN="${LM_REGRADE_TOKEN:-demo-regrade}" \
LM_DESTROY_TOKEN="${LM_DESTROY_TOKEN:-demo-destroy}" \
LM_DOCSIM=/usr/local/bin/docsim \
LM_DOCSIM_DIR=/app/docsim \
DOCSIM_HMAC_KEY="${DOCSIM_HMAC_KEY:-lm-poc-demo-key}" \
LM_DB_URL="postgres://postgres@127.0.0.1:5432/ledgermarker?sslmode=disable" \
lmserver &
LM_PID=$!

until curl -fs "http://127.0.0.1${LM_ADDR:-:7860}/v1/healthz" >/dev/null 2>&1; do sleep 1; done
# 샘플 적재(멱등). docsim 지문 계산이 포함돼 첫 기동에 1~2분 걸릴 수 있다 — 실패해도 서버는 유지한다.
curl -fs -X POST "http://127.0.0.1${LM_ADDR:-:7860}/v1/admin/load-samples" -H 'Content-Type: application/json' -d '{}' \
  | head -c 400 || echo "샘플 적재 실패(서버 로그 확인)"
echo
wait $LM_PID
