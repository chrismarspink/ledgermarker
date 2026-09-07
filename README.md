# LedgerMarker (LM) — Phase 1

문서에 서명된 등급 라벨(**여권**)을 발급하고, 그 사실을 추가 전용 원장(**대장**)에
기록하며, 게이트에서 검증하고, 문서의 파생 계보(**족보**)를 추적하는 시스템.

명세: `../LedgerMarker_DEV_SPEC.md` · 외부 공유 규격: [docs/label-profile.md](docs/label-profile.md)

## 핵심 불변식 4개 (깨는 설계 거부)

1. **원장은 절대 수정·삭제되지 않는다.** 모든 변경은 새 이벤트 행 추가.
2. **라벨 등급 필드는 평문이다.** 게이트가 복호화 없이 읽는다.
3. **서버는 문서 본문을 저장하지 않는다.** 해시·메타데이터·서명만.
4. **귀속과 판정을 분리한다.** `verdictHint`는 참고값 — 통과 여부는 게이트 정책.

## 산출물

| 산출물 | 위치 | 스택 |
|---|---|---|
| LM Server | `cmd/lmserver` | Go 1.22+ · PostgreSQL 16 |
| LedgerMarker Web (PWA, 구 LM Verify) | `verify-pwa/` | React 18 + Vite + Workbox |
| LM CLI | `cmd/lm` | Go + Cobra (서버 API 래퍼) |
| LM Gate SDK | `sdk/go/` (+ `api/openapi.yaml`) | Go 라이브러리 + REST 명세 |

## 빠른 시작 (개발)

```bash
# 1) 서버 — DB 없이 인메모리 데모 모드
go build -o bin/lmserver ./cmd/lmserver && ./bin/lmserver
# PostgreSQL 사용 시: LM_DB_URL=postgres://... ./bin/lmserver (마이그레이션 자동)

# 2) CLI
go build -o bin/lm ./cmd/lm
./bin/lm issue 문서.hwp --grade S             # 단일 파일 라벨 발급 (.lmsig 사이드카)
./bin/lm issue 문서.pdf --grade S --embed     # 파일에 라벨 내장 (트레일러 방식)
./bin/lm issue 요약.hwp --grade O --parent 문서.hwp --transform extract  # 파생본
./bin/lm scan ./문서고 --issue --grade S      # 소급 라벨링 (.lmsig 사이드카 생성)
./bin/lm verify 문서.pdf --level 2            # 5개 체크 항목 표시
./bin/lm lineage 문서.pdf --tree              # 족보
./bin/lm ledger verify                        # 체인 무결성
./bin/lm ledger checkpoint --sign             # 원장 봉인

# 3) PWA
cd verify-pwa && npm install && npm run dev   # /v1 → localhost:8080 프록시

# 4) 스택 일괄 (PG16 + 서버)
docker compose -f deploy/docker-compose.yml up --build
```

### 서버 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LM_ADDR` | `:8080` | 리슨 주소 |
| `LM_DB_URL` | (없음 = 인메모리 데모) | PostgreSQL DSN |
| `LM_KEYSTORE` | `./keystore` | 파일 키스토어 (비면 개발 PKI 자동 생성) |
| `LM_ISSUER_ORG` | `DEVORG` | 발급 기관 식별자 |
| `LM_API_KEYS` | (없음 = 개발 모드) | 쉼표 구분 API 키 — 비공개 엔드포인트 보호 |
| `LM_REGRADE_TOKEN` | (없음) | 등급 하향(공개 전환) 승인 토큰 |
| `LM_DESTROY_TOKEN` | (없음 = 파기 비활성) | 파기 심의 승인 토큰 — docs/lifecycle-policy.md |
| `LM_TREATIES` | (없음) | 등가성 협정 JSON 경로 — docs/treaty-policy.md |

## 테스트 (수용 기준 T1~T13)

```bash
go test ./...                                  # T1, T3~T13 (인메모리)

# T2·T3(PostgreSQL 트리거·슈퍼유저 조작) 통합 테스트
docker compose -f deploy/docker-compose.test.yml up -d
LM_TEST_DB="postgres://postgres:postgres@localhost:5433/lm_test?sslmode=disable" \
  go test ./internal/store/ -v
```

| 테스트 | 위치 |
|---|---|
| T1 grade 1바이트 변조 탐지 | `internal/issue/issue_test.go` |
| T2 원장 UPDATE/DELETE 거부 | `internal/store/pg_integration_test.go` |
| T3 조작 지점 seq 지목 | `internal/ledger/hash_test.go`, `internal/server/server_test.go`, PG 통합 |
| T4~T8 폴백·오프라인·키유출 | `internal/verify/verify_test.go` |
| T9~T13 등급변경·멱등·계보 | `internal/server/server_test.go` |

행 해시 직렬화는 `TestRowHashGolden`으로 잠겨 있다 — **기대값을 코드에 맞춰
고치지 말 것** (기존 원장 체인이 깨진다).

## 저장소 구조

```
cmd/lmserver, cmd/lm      # 서버·CLI 엔트리포인트
internal/issue            # 라벨 발급: CMS 조립·서명·파싱
internal/ledger           # 원장: 해시체인·단일 writer·머클 체크포인트
internal/lineage          # 선언적 계보 DAG (Phase 1)
internal/treaty           # 협정 인터페이스만 (Phase 2)
internal/crypto           # 암호모듈 추상화 (softhsm ↔ KCMVP 교체 가능)
internal/verify           # 검증 L1/L2·폴백·키 유출 규칙(§5.4)
internal/store            # PostgreSQL·인메모리 저장소
api/openapi.yaml          # REST 명세
verify-pwa/               # React PWA (오프라인 L1 검증)
sdk/go/                   # Gate SDK
migrations/               # golang-migrate (append-only 트리거 포함)
deploy/                   # Dockerfile·compose·오프라인 번들
docs/label-profile.md     # 외부 공유 규격 (변경 시 profileVersion 상향)
```

## Phase 1에서 하지 않는 것

지문 엔진(관찰적 계보), 협정, 블록체인, 다국어, HSM/KCMVP 연동 —
인터페이스만 뚫어두고 구현은 Phase 2로 미룬다 (DEV SPEC §9).

## 착수 전 확인 필요 ✎ (DEV SPEC §13)

1. OID arc 정식 배정 — 현재 `1.3.6.1.4.1.55555.53.1` 임시
2. KCMVP 검증필 암호모듈 선정 (`internal/crypto` 교체 지점)
3. 기관 CA 명의 주체
4. 서버 API 인증 방식 (mTLS vs API Key) — 현재 API Key 구현
5. ECM 연동 방식 (훅 vs 폴링)
6. 등급분류 API 규격 (`lm scan --grade-from=api` 지점)
7. 소급 라벨링 대상 규모
8. 업무망 표준 브라우저의 WebCrypto·BarcodeDetector 지원 버전
