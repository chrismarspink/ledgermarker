#!/bin/sh
# 로컬 데모 스택 (PG 영속 모드): PG16 컨테이너 + lmserver(:8090)
# 사용: ./deploy/run-demo.sh            (재실행 시 원장 유지 — named volume lm-demo-pgdata)
#       ./deploy/run-demo.sh --reset    (원장 볼륨을 지우고 빈 원장으로 시작 — 개발·시연 전용)
#
# 다섯 기관이 한 서버에서 발급한다(모델 A — 단일 서버 다중 기관, 페르소나 전환):
#   KPOST(기본)·INNOTIUM·MOIS·NTS·MSIT. 파트너 키는 demo-partners/ 에 lm pki init-org 로
#   만들어 둔 것이다. 실운영은 기관별 서버·키 분리(모델 B)가 전제다.
set -e
cd "$(dirname "$0")/.."

if [ "$1" = "--reset" ]; then
  echo "원장 초기화: 컨테이너·볼륨 lm-demo-pgdata 삭제"
  docker rm -f lm-demo-pg >/dev/null 2>&1 || true
  docker volume rm lm-demo-pgdata >/dev/null 2>&1 || true
fi

docker start lm-demo-pg 2>/dev/null || docker run -d --name lm-demo-pg \
  --restart unless-stopped \
  -e POSTGRES_PASSWORD=lm-demo-pw -e POSTGRES_DB=ledgermarker \
  -v lm-demo-pgdata:/var/lib/postgresql/data -p 5434:5432 postgres:16
until docker exec lm-demo-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

[ -x bin/lmserver ] || go build -o bin/lmserver ./cmd/lmserver
[ -x bin/lm ] || go build -o bin/lm ./cmd/lm

# 기관 키스토어는 저장소에 넣지 않는다(개인키). 없으면 로컬에서 생성한다 — 데모용 자체 PKI.
# 기본 기관(KPOST)은 서버가 LM_KEYSTORE 에 자동 생성하고, 추가 기관은 여기서 만든다.
for spec in "INNOTIUM:./keystore-innotium" "MOIS:./keystore-partners/MOIS" "NTS:./keystore-partners/NTS" "MSIT:./keystore-partners/MSIT"; do
  org="${spec%%:*}"; dir="${spec#*:}"
  [ -f "$dir/ca.key" ] || ./bin/lm pki init-org --org "$org" --dir "$dir"
done

exec env \
  LM_ADDR=:8090 \
  LM_ISSUER_ORG=KPOST \
  LM_KEYSTORE=./keystore \
  LM_ISSUERS="INNOTIUM:이노티움:./keystore-innotium,MOIS:행정안전부:./keystore-partners/MOIS,NTS:국세청:./keystore-partners/NTS,MSIT:과학기술정보통신부:./keystore-partners/MSIT" \
  LM_TREATIES=./deploy/treaties.demo.json \
  LM_SAMPLE_DIR="$(pwd)/sample" \
  LM_REGRADE_TOKEN=demo-regrade \
  LM_DESTROY_TOKEN=demo-destroy \
  LM_DOCSIM="$HOME/docsim/.venv/bin/docsim" \
  DOCSIM_HMAC_KEY="${DOCSIM_HMAC_KEY:-lm-poc-demo-key}" \
  LM_DB_URL="postgres://postgres:lm-demo-pw@localhost:5434/ledgermarker?sslmode=disable" \
  ./bin/lmserver
