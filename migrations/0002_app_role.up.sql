-- 애플리케이션 롤: UPDATE/DELETE 권한을 아예 갖지 않는다 (append-only 1차 잠금).
-- 운영 배포 시 비밀번호는 반드시 교체할 것 (ALTER ROLE lm_app PASSWORD ...).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lm_app') THEN
    CREATE ROLE lm_app LOGIN PASSWORD 'lm_app_dev_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO lm_app;
GRANT SELECT, INSERT ON ledger_event, checkpoint, fingerprint, trust_anchor, idempotency TO lm_app;
GRANT SELECT ON current_label TO lm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lm_app;

-- 명시적 회수 — 기본값이더라도 의도를 스키마에 남긴다 (DEV SPEC §3.1-1)
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_event, checkpoint, fingerprint, trust_anchor, idempotency FROM lm_app;
