# 단일 서버 데모 이미지 — Hugging Face Docker Space 용 (로컬 docker 로도 동일하게 뜬다).
# 한 컨테이너에 PostgreSQL + lmserver(웹 정적 파일 포함) + docsim(讀心) 을 넣고 7860 한 포트로 서비스한다.
# 빌드 컨텍스트는 저장소 루트: docker build -f deploy/hf/Dockerfile -t ledgermarker-demo .

# ── 1. Go: lmserver · lm ──────────────────────────────────────────────
FROM golang:1.26-bookworm AS gobuild
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/lmserver ./cmd/lmserver && CGO_ENABLED=0 go build -o /out/lm ./cmd/lm

# ── 2. Node: PWA 빌드 (서버와 같은 오리진이므로 base '/' · 서버 주소 없음) ──
FROM node:20-bookworm AS webbuild
WORKDIR /src/verify-pwa
COPY verify-pwa/package.json verify-pwa/package-lock.json ./
RUN npm ci
COPY verify-pwa/ ./
RUN npm run build

# ── 3. 런타임: Python(docsim) + PostgreSQL ──────────────────────────────
FROM python:3.11-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-contrib curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Debian bookworm 의 postgresql 은 15 — 마이그레이션(0001~0007)은 표준 SQL 이라 16 과 동일하게 동작한다.
ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"

# Spaces 는 uid 1000 비루트 사용자로 실행한다 — 모든 쓰기 경로를 이 사용자 소유로 둔다.
RUN useradd -m -u 1000 app
WORKDIR /app

# docsim: CPU 전용 torch 로 이미지를 줄인다(≈ 2GB 절감). 모델은 빌드 시 미리 받아 첫 요청 지연을 없앤다.
COPY third_party/docsim /app/docsim
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install "/app/docsim[formats]"
ENV HF_HOME=/app/hf-cache
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('jhgan/ko-sroberta-multitask')" \
    && chown -R app:app /app/hf-cache

COPY --from=gobuild /out/lmserver /out/lm /usr/local/bin/
COPY --from=webbuild /src/verify-pwa/dist /app/web
COPY keystore /app/keystore
COPY keystore-innotium /app/keystore-innotium
COPY keystore-partners /app/keystore-partners
COPY deploy/treaties.demo.json /app/treaties.json
COPY sample /app/sample
COPY deploy/hf/start.sh /app/start.sh
RUN chmod +x /app/start.sh && chown -R app:app /app && mkdir -p /data && chown app:app /data

USER app
EXPOSE 7860
# /data 는 Space 영구 디스크(유료) 마운트 지점. 없으면 컨테이너 안에 두고 재시작 시 샘플로 다시 채운다.
ENV PGDATA=/data/pg LM_ADDR=:7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fs http://127.0.0.1:7860/v1/healthz || exit 1
CMD ["/app/start.sh"]
