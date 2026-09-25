-- 게이트 관측 로그: 기관 간 문서 이동·검증 기록 (모델 A — 단일 서버 다중 기관).
-- 원장(ledger_event)은 발급 측 진실만 담는다. 이 표는 게이트가 "보고한" 사실 —
-- 보냈다(SENT)·받았다(RECEIVED)·이렇게 읽고 판정했다(VERIFIED) — 를 담는
-- 별도의 추가 전용 로그다. 본문은 없고(불변식 3) 판정은 호출자 보고값이라
-- LM의 판정이 아니다(불변식 4). 원장 행 해시와 무관하므로 체인에 영향 없다.
CREATE TABLE gate_observation (
  obs_id           BIGSERIAL PRIMARY KEY,
  kind             TEXT        NOT NULL,          -- SENT | RECEIVED | VERIFIED
  doc_guid         UUID        NOT NULL,
  content_hash     BYTEA,
  from_org         TEXT        NOT NULL,
  to_org           TEXT        NOT NULL,
  grade            TEXT,                          -- 발급 등급
  translated_grade TEXT,                          -- 검증 기관 기준 등급
  treaty           TEXT,                          -- translated | no_treaty | expired | not_translatable
  verdict_hint     TEXT,                          -- allow | review | deny (호출자 보고)
  actor            TEXT,
  note             TEXT,
  observed_at      TIMESTAMPTZ NOT NULL,          -- 게이트가 보고한 시각
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON gate_observation (doc_guid, obs_id);
CREATE INDEX ON gate_observation (to_org, kind, obs_id);

CREATE TRIGGER gate_observation_immutable
  BEFORE UPDATE OR DELETE ON gate_observation
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

GRANT SELECT, INSERT ON gate_observation TO lm_app;
REVOKE UPDATE, DELETE, TRUNCATE ON gate_observation FROM lm_app;
