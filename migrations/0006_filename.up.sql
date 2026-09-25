-- 파일명 (개발·운영 확인용 주석성 메타데이터):
-- 발급 시 클라이언트가 보고한 원본 파일명을 그대로 기록해, 원장 열람에서
-- "어떤 파일이 올바르게 추가되었는지"를 눈으로 확인할 수 있게 한다.
-- 정체성·검증에는 쓰지 않는다 — 정체성은 content_hash·지문이 정한다.
-- 행 해시(row_hash)에는 포함되지 않는 주석성 컬럼이다(attach_method 계열과 동일).
ALTER TABLE ledger_event ADD COLUMN filename TEXT;
