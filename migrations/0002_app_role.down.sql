REVOKE ALL ON ledger_event, checkpoint, fingerprint, trust_anchor, idempotency FROM lm_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM lm_app;
REVOKE USAGE ON SCHEMA public FROM lm_app;
-- 롤 자체는 다른 DB에서 쓰일 수 있어 삭제하지 않는다.
