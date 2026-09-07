-- 주의: 원장 컬럼 제거는 운영에서 수행하지 않는다 (개발 환경 전용).
ALTER TABLE ledger_event DROP COLUMN IF EXISTS fallback_reason;
ALTER TABLE ledger_event DROP COLUMN IF EXISTS format_id;
ALTER TABLE ledger_event DROP COLUMN IF EXISTS attach_method;
