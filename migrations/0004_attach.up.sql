-- 부착 방식 기록 (작업지시서 §2.5). 기존 행은 NULL 허용, 신규 발급은 기록.
-- "왜 이 파일은 사이드카인가"를 나중에 추적할 수 있어야 한다.
ALTER TABLE ledger_event ADD COLUMN attach_method   TEXT;
ALTER TABLE ledger_event ADD COLUMN format_id       TEXT;
ALTER TABLE ledger_event ADD COLUMN fallback_reason TEXT;
