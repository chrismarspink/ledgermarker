#!/bin/sh
# 로컬 데모 스택 (PG 영속 모드): PG16 컨테이너 + lmserver(:8090)
# 사용: ./deploy/run-demo.sh    (재실행 시 원장 유지 — named volume lm-demo-pgdata)
set -e
cd "$(dirname "$0")/.."

docker start lm-demo-pg 2>/dev/null || docker run -d --name lm-demo-pg \
  --restart unless-stopped \
  -e POSTGRES_PASSWORD=lm-demo-pw -e POSTGRES_DB=ledgermarker \
  -v lm-demo-pgdata:/var/lib/postgresql/data -p 5434:5432 postgres:16
until docker exec lm-demo-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

[ -x bin/lmserver ] || go build -o bin/lmserver ./cmd/lmserver
[ -x bin/lm ] || go build -o bin/lm ./cmd/lm

exec env \
  LM_ADDR=:8090 \
  LM_ISSUER_ORG=KPOST \
  LM_KEYSTORE=./keystore \
  LM_TREATIES=./deploy/treaties.demo.json \
  LM_REGRADE_TOKEN=demo-regrade \
  LM_DESTROY_TOKEN=demo-destroy \
  LM_DB_URL="postgres://postgres:lm-demo-pw@localhost:5434/ledgermarker?sslmode=disable" \
  ./bin/lmserver
