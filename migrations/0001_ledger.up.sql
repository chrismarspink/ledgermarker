-- LedgerMarker Phase 1 스키마 (DEV SPEC §3)
-- 원장은 추가 전용이다: REVOKE(0002) + 트리거 이중 잠금으로 강제한다.

CREATE TYPE event_type AS ENUM ('ISSUE','REVOKE','REGRADE','DERIVE');

-- ── 원장(추가 전용) ─────────────────────────────
CREATE TABLE ledger_event (
  seq            BIGSERIAL,
  event_type     event_type   NOT NULL,
  doc_guid       UUID         NOT NULL,
  content_hash   BYTEA        NOT NULL,           -- SHA-256, 32 bytes
  grade          CHAR(1),                         -- 'C' | 'S' | 'O'
  basis_clause   SMALLINT,                        -- 정보공개법 9조 호수 1~8
  basis_keywords TEXT[],
  brm_path       TEXT,
  approval_state TEXT,                            -- 'PROVISIONAL' | 'CONFIRMED'
  parent_hash    BYTEA,                           -- 선언적 계보
  root_doc_id    UUID,
  transform      TEXT,                            -- 'edit'|'convert'|'merge'|'extract'
  label_der      BYTEA,                           -- CMS 라벨 원본(DER)
  issuer_org     TEXT         NOT NULL,
  signer_cert_sn TEXT,                            -- 서명 인증서 일련번호
  revoked_ref    BIGINT,                          -- REVOKE/REGRADE가 가리키는 원 seq
  reason         TEXT,
  actor          TEXT         NOT NULL,           -- 호출 주체(시스템 계정)
  prev_hash      BYTEA        NOT NULL,           -- 직전 행의 row_hash
  row_hash       BYTEA        NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (seq, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE ledger_event_2026 PARTITION OF ledger_event
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE ledger_event_2027 PARTITION OF ledger_event
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE ledger_event_default PARTITION OF ledger_event DEFAULT;

CREATE INDEX ON ledger_event (content_hash);
CREATE INDEX ON ledger_event (doc_guid, seq DESC);
CREATE INDEX ON ledger_event (parent_hash) WHERE parent_hash IS NOT NULL;

-- 권한 설정 실수에 대한 이중 잠금: UPDATE/DELETE는 무조건 예외 (T2)
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % is forbidden', TG_OP, TG_TABLE_NAME;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_event_immutable
  BEFORE UPDATE OR DELETE ON ledger_event
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- ── 체크포인트(원장 봉인) ────────────────────────
CREATE TABLE checkpoint (
  ckpt_id        BIGSERIAL PRIMARY KEY,
  from_seq       BIGINT      NOT NULL,
  to_seq         BIGINT      NOT NULL,
  merkle_root    BYTEA       NOT NULL,
  signature      BYTEA       NOT NULL,
  signer_cert_sn TEXT        NOT NULL,
  signed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER checkpoint_immutable
  BEFORE UPDATE OR DELETE ON checkpoint
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- ── 현재 상태(구체화 뷰) ─────────────────────────
-- 원장은 불변, 조회는 고속. 이벤트를 접어 "이 문서의 유효 라벨"을 만든다.
CREATE MATERIALIZED VIEW current_label AS
SELECT DISTINCT ON (doc_guid)
  doc_guid, content_hash, grade, approval_state, parent_hash, root_doc_id,
  seq AS latest_seq,
  (event_type = 'REVOKE') AS revoked,
  created_at
FROM ledger_event
ORDER BY doc_guid, seq DESC;

CREATE UNIQUE INDEX ON current_label (doc_guid);
CREATE INDEX ON current_label (content_hash);

-- ── Phase 2 예약(생성만, 미사용) ─────────────────
CREATE TABLE fingerprint (
  doc_guid   UUID  NOT NULL,
  minhash    BYTEA NOT NULL,
  lsh_bucket TEXT  NOT NULL,
  tlsh       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON fingerprint (lsh_bucket);

-- ── 멱등키 (POST /v1/labels — T12) ───────────────
CREATE TABLE idempotency (
  key        TEXT PRIMARY KEY,
  response   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 신뢰목록 ─────────────────────────────────────
CREATE TABLE trust_anchor (
  id       BIGSERIAL PRIMARY KEY,
  org_id   TEXT NOT NULL,
  cert_pem TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
