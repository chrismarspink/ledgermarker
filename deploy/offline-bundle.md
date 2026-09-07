# 오프라인(폐쇄망) 배포 번들

업무망(인터넷 차단) 배포 절차. 인터넷 가능 장비에서 번들을 만들어 반입한다.

## 1. 번들 생성 (인터넷 가능 장비)

```bash
# 서버 이미지
docker compose -f deploy/docker-compose.yml build lmserver
docker save -o lm-bundle/lmserver.tar ledgermarker-lmserver
docker pull postgres:16 && docker save -o lm-bundle/postgres16.tar postgres:16

# PWA 정적 파일 (사내 웹서버·Nginx로 서빙)
cd verify-pwa && npm ci && npm run build
cp -r dist ../lm-bundle/verify-pwa-dist

# CLI 바이너리 (배포 대상 OS에 맞게 크로스 컴파일)
GOOS=linux  GOARCH=amd64 go build -o lm-bundle/lm-linux-amd64  ./cmd/lm
GOOS=windows GOARCH=amd64 go build -o lm-bundle/lm-windows-amd64.exe ./cmd/lm
```

## 2. 반입 후 기동 (폐쇄망)

```bash
docker load -i lmserver.tar && docker load -i postgres16.tar
docker compose -f deploy/docker-compose.yml up -d
```

## 3. 키스토어

- 최초 기동 시 개발용 CA·서명자가 자동 생성된다 — **실증 전용**.
- 운영 반입 시에는 기관 CA에서 발급한 키·인증서 파일을
  keystore 볼륨(`ca.crt`, `label.key/.crt`, `checkpoint.key/.crt`)에 배치한다.
  ✎ 기관 CA 명의 주체 확정 필요 (DEV SPEC §13-3).

## 4. PWA 오프라인 동작

- PWA는 최초 1회 접속 시 Service Worker가 신뢰목록(`/v1/trust/list`)과
  최신 체크포인트를 캐시한다.
- 이후 원장 접속이 끊겨도 L1(서명) 검증은 동작하며, 원장 체크는
  `unavailable`(판단 보류)로 표시된다 — "검증 실패"가 아니다.
