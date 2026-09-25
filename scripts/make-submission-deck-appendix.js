
// ───────────────────────── 부록 A. 주요 API
{
  const s = base()
  title(s, '부록 A. 주요 API — 질의응답용', 'REST 명세 api/openapi.yaml · Go Gate SDK sdk/go · 비공개 엔드포인트는 X-LM-Key')
  table(s, [
    ['API', '용도', '비고'],
    ['POST /v1/labels', '발급 — 해시·지문·부착 방식 접수 (파일 미전송)', 'Idempotency-Key 필수 · issuerOrg 로 5기관 선택'],
    ['POST /v1/verify', '검증 5항목(서명·원장·폐기·기간·협정) 개별 판정', 'verifierOrg 가 발급 기관과 다르면 협정 번역(L3)'],
    ['POST /v1/identify', '지문 유사도 재식별 (수정본·변환본·재작성)', 'text 를 주면 서버가 docsim 讀心 판정까지 채움'],
    ['POST /v1/compare', '두 본문의 MinHash 자카드 + 의미 유사도 (유사도 테스트 화면)', '슁글 집합·시그니처 일치 마스크까지 반환'],
    ['GET /v1/labels/by-hash/{hash}', '라벨 원본 회수 — 완전 복원·정책 재적용', '?kind=text 로 텍스트 해시 조회'],
    ['POST /v1/restore', '정체성 복원 사다리 — 해시→텍스트 해시→지문, apply 시 상속 라벨 발급', '0.70 미만은 review 로 반환'],
    ['GET /v1/documents/{id}/lineage', '파생 계보 그래프(DAG)', 'depth·direction'],
    ['POST/GET /v1/observations', '게이트 관측 로그 — 기관 간 SENT·VERIFIED', '원장과 분리된 추가 전용 로그'],
    ['GET /v1/ledger/events · /ledger/verify · /checkpoints', '감사 이력 · 해시체인 점검 · 봉인 목록', '관리콘솔 6화면의 데이터'],
    ['POST /v1/labels/{id}/revoke · regrade · destroy', '폐기 · 등급변경(승인 토큰) · 파기(심의 토큰)', '삭제가 아니라 이벤트 행 추가'],
    ['GET /v1/treaties · /trust/list · /formats', '협정 · 신뢰목록 · 포맷 카탈로그(단일 진실원천)', '공개, PWA 캐시 대상'],
    ['POST /v1/admin/load-samples', '샘플 일괄 발급(기능 테스트) — 24파일·이벤트·관측', '멱등']
  ], 0.6, 1.5, 12.1, [3.6, 5.2, 3.3], { size: 9.5, rowH: 0.4 })
}

// ───────────────────────── 부록 B. 자동 테스트 대응표
{
  const s = base()
  title(s, '부록 B. 자동 테스트 대응표 — go test ./... 7패키지', 'DEV SPEC 수용 기준 T1~T13 + 이번 PoC 추가 항목. 전부 통과(2026-09-25)')
  table(s, [
    ['ID', '검증 내용', '위치', '결과'],
    ['T1', '라벨 등급 1바이트 변조 → 서명 무효 탐지', 'internal/issue/issue_test.go', OK],
    ['T2', '원장 UPDATE/DELETE 를 DB 트리거·권한이 거부', 'internal/store/pg_integration_test.go (PG)', OK],
    ['T3', '슈퍼유저 강제 조작 후 체인 점검이 조작 seq 지목', 'internal/ledger/hash_test.go · server_test.go', OK],
    ['T4~T8', '폴백 검증 · 오프라인(접속 불가≠미등록) · 키 유출 규칙 · 폐기 키 위조', 'internal/verify/verify_test.go', OK],
    ['T9~T13', '등급 하향 승인 · 멱등 발급(행 1개) · 3세대 계보 · 미등재 포맷 폴백', 'internal/server/server_test.go', OK],
    ['A1~A7', '지문 정확도 곡선(서식·변환·국소 수정·무작위 치환·무관 30종)', 'internal/fingerprint/accuracy_test.go', OK],
    ['Golden', '행 해시 직렬화 · 정규화 골든값(기존 원장 체인 보호)', 'internal/ledger · internal/attach', OK],
    ['L3', '협정 번역 · 협정 없음 · 만료 · C등급 번역 불가', 'internal/server/federation_test.go', OK],
    ['Obs', '관측 로그 기록·조회 · 봉인 목록', 'federation_test.go', OK],
    ['Samples', '샘플 로더 멱등성(두 번 실행해도 행 중복 없음)', 'federation_test.go', OK],
    ['Compare', '/v1/compare 동일·수정·무관 텍스트', 'server_test.go', OK],
    ['Bench', 'MinHash 지문 0.65 ms/5KB · 버킷 6.6 µs · 비교 79 ns', 'internal/fingerprint/bench_test.go', OK]
  ], 0.6, 1.5, 12.1, [1.1, 5.6, 4.2, 1.2], { size: 9.5, rowH: 0.38 })
}
