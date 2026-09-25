-- 주의: 원장 폐기는 운영에서 되돌릴 수 없는 작업이다.
-- down 스크립트는 개발 환경 초기화 용도로만 쓴다 (DEV SPEC §12).
DROP TABLE IF EXISTS trust_anchor;
DROP TABLE IF EXISTS idempotency;
DROP TABLE IF EXISTS fingerprint;
DROP MATERIALIZED VIEW IF EXISTS current_label;
DROP TABLE IF EXISTS checkpoint;
DROP TABLE IF EXISTS ledger_event;
DROP FUNCTION IF EXISTS forbid_ledger_mutation();
DROP TYPE IF EXISTS event_type;
