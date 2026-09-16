package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/innotium/ledgermarker/internal/ledger"
)

// Postgres 는 운영 저장소다. 원장 append-only 강제는 스키마
// (REVOKE + 트리거, migrations/ 참조)가 담당하고, 여기서는 INSERT와
// SELECT만 수행한다 — UPDATE/DELETE 문은 이 파일에 존재해서는 안 된다.
type Postgres struct {
	pool *pgxpool.Pool
}

var _ Store = (*Postgres)(nil)

func OpenPostgres(ctx context.Context, dsn string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping postgres: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Close() { p.pool.Close() }

// Pool 은 마이그레이션·헬스체크용으로 내부 풀을 노출한다.
func (p *Postgres) Pool() *pgxpool.Pool { return p.pool }

const eventCols = `seq, event_type, doc_guid, content_hash, grade, basis_clause,
	basis_keywords, brm_path, approval_state, parent_hash, root_doc_id, transform,
	label_der, issuer_org, signer_cert_sn, revoked_ref, reason, actor,
	attach_method, format_id, fallback_reason, text_hash, docsim_fp,
	prev_hash, row_hash, created_at`

func (p *Postgres) Tip(ctx context.Context) (int64, []byte, error) {
	var seq int64
	var hash []byte
	err := p.pool.QueryRow(ctx,
		`SELECT seq, row_hash FROM ledger_event ORDER BY seq DESC LIMIT 1`).Scan(&seq, &hash)
	if err == pgx.ErrNoRows {
		return 0, ledger.GenesisPrevHash, nil
	}
	if err != nil {
		return 0, nil, fmt.Errorf("store: tip: %w", err)
	}
	return seq, hash, nil
}

func (p *Postgres) InsertEvent(ctx context.Context, e *ledger.Event) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO ledger_event (seq, event_type, doc_guid, content_hash, grade,
			basis_clause, basis_keywords, brm_path, approval_state, parent_hash,
			root_doc_id, transform, label_der, issuer_org, signer_cert_sn,
			revoked_ref, reason, actor, attach_method, format_id, fallback_reason,
			text_hash, docsim_fp, prev_hash, row_hash, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
		e.Seq, string(e.Type), e.DocGUID, e.ContentHash,
		nullStr(e.Grade), nullI16(e.BasisClause), e.BasisKeywords,
		nullStr(e.BRMPath), nullStr(e.ApprovalState), nullBytes(e.ParentHash),
		nullUUID(e.RootDocID), nullStr(e.Transform), nullBytes(e.LabelDER),
		e.IssuerOrg, nullStr(e.SignerCertSN), nullI64(e.RevokedRef),
		nullStr(e.Reason), e.Actor,
		nullStr(e.AttachMethod), nullStr(e.FormatID), nullStr(e.FallbackReason),
		nullBytes(e.TextHash), nullStr(e.DocsimFP),
		e.PrevHash, e.RowHash, e.CreatedAt)
	if err != nil {
		return fmt.Errorf("store: insert event: %w", err)
	}
	return nil
}

func (p *Postgres) EventsRange(ctx context.Context, from, to int64) ([]ledger.Event, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+eventCols+`
		FROM ledger_event WHERE seq BETWEEN $1 AND $2 ORDER BY seq`, from, to)
	if err != nil {
		return nil, fmt.Errorf("store: events range: %w", err)
	}
	return scanEvents(rows)
}

func (p *Postgres) EventsByContentHash(ctx context.Context, hash []byte) ([]ledger.Event, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+eventCols+`
		FROM ledger_event WHERE content_hash = $1 ORDER BY seq`, hash)
	if err != nil {
		return nil, fmt.Errorf("store: events by hash: %w", err)
	}
	return scanEvents(rows)
}

func (p *Postgres) EventsByTextHash(ctx context.Context, textHash []byte) ([]ledger.Event, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+eventCols+`
		FROM ledger_event WHERE text_hash = $1 ORDER BY seq`, textHash)
	if err != nil {
		return nil, fmt.Errorf("store: events by text hash: %w", err)
	}
	return scanEvents(rows)
}

func (p *Postgres) LatestByDoc(ctx context.Context, docGUID uuid.UUID) (*ledger.Event, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+eventCols+`
		FROM ledger_event WHERE doc_guid = $1 ORDER BY seq DESC LIMIT 1`, docGUID)
	if err != nil {
		return nil, fmt.Errorf("store: latest by doc: %w", err)
	}
	evs, err := scanEvents(rows)
	if err != nil {
		return nil, err
	}
	if len(evs) == 0 {
		return nil, nil
	}
	return &evs[0], nil
}

func (p *Postgres) ChildrenOf(ctx context.Context, contentHash []byte) ([]ledger.Event, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+eventCols+`
		FROM ledger_event WHERE parent_hash = $1 ORDER BY seq`, contentHash)
	if err != nil {
		return nil, fmt.Errorf("store: children of: %w", err)
	}
	return scanEvents(rows)
}

func (p *Postgres) InsertCheckpoint(ctx context.Context, c *ledger.Checkpoint) error {
	err := p.pool.QueryRow(ctx, `
		INSERT INTO checkpoint (from_seq, to_seq, merkle_root, signature, signer_cert_sn, signed_at)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING ckpt_id`,
		c.FromSeq, c.ToSeq, c.MerkleRoot, c.Signature, c.SignerCertSN, c.SignedAt).Scan(&c.ID)
	if err != nil {
		return fmt.Errorf("store: insert checkpoint: %w", err)
	}
	return nil
}

func (p *Postgres) LatestCheckpoint(ctx context.Context) (*ledger.Checkpoint, error) {
	c := &ledger.Checkpoint{}
	err := p.pool.QueryRow(ctx, `SELECT ckpt_id, from_seq, to_seq, merkle_root,
		signature, signer_cert_sn, signed_at
		FROM checkpoint ORDER BY ckpt_id DESC LIMIT 1`).
		Scan(&c.ID, &c.FromSeq, &c.ToSeq, &c.MerkleRoot, &c.Signature, &c.SignerCertSN, &c.SignedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: latest checkpoint: %w", err)
	}
	return c, nil
}

func (p *Postgres) GetIdempotent(ctx context.Context, key string) ([]byte, error) {
	var resp []byte
	err := p.pool.QueryRow(ctx,
		`SELECT response FROM idempotency WHERE key = $1`, key).Scan(&resp)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: get idempotent: %w", err)
	}
	return resp, nil
}

func (p *Postgres) PutIdempotent(ctx context.Context, key string, response []byte) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO idempotency (key, response) VALUES ($1, $2)
		ON CONFLICT (key) DO NOTHING`, key, response)
	if err != nil {
		return fmt.Errorf("store: put idempotent: %w", err)
	}
	return nil
}

func (p *Postgres) TrustAnchors(ctx context.Context) ([]TrustAnchor, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id, org_id, cert_pem, added_at FROM trust_anchor ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("store: trust anchors: %w", err)
	}
	defer rows.Close()
	var out []TrustAnchor
	for rows.Next() {
		var ta TrustAnchor
		if err := rows.Scan(&ta.ID, &ta.OrgID, &ta.CertPEM, &ta.AddedAt); err != nil {
			return nil, fmt.Errorf("store: scan trust anchor: %w", err)
		}
		out = append(out, ta)
	}
	return out, rows.Err()
}

func (p *Postgres) AddTrustAnchor(ctx context.Context, ta *TrustAnchor) error {
	err := p.pool.QueryRow(ctx, `
		INSERT INTO trust_anchor (org_id, cert_pem) VALUES ($1, $2)
		RETURNING id, added_at`, ta.OrgID, ta.CertPEM).Scan(&ta.ID, &ta.AddedAt)
	if err != nil {
		return fmt.Errorf("store: add trust anchor: %w", err)
	}
	return nil
}

func (p *Postgres) InsertFingerprint(ctx context.Context, docGUID uuid.UUID, minhash []byte, buckets []string) error {
	for _, b := range buckets {
		if _, err := p.pool.Exec(ctx, `
			INSERT INTO fingerprint (doc_guid, minhash, lsh_bucket) VALUES ($1, $2, $3)`,
			docGUID, minhash, b); err != nil {
			return fmt.Errorf("store: insert fingerprint: %w", err)
		}
	}
	return nil
}

func (p *Postgres) DeleteFingerprints(ctx context.Context, docGUID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx, `DELETE FROM fingerprint WHERE doc_guid = $1`, docGUID); err != nil {
		return fmt.Errorf("store: delete fingerprints: %w", err)
	}
	return nil
}

func (p *Postgres) FingerprintCandidates(ctx context.Context, buckets []string) (map[uuid.UUID][]byte, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT DISTINCT ON (doc_guid) doc_guid, minhash
		FROM fingerprint WHERE lsh_bucket = ANY($1)`, buckets)
	if err != nil {
		return nil, fmt.Errorf("store: fingerprint candidates: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID][]byte{}
	for rows.Next() {
		var doc uuid.UUID
		var mh []byte
		if err := rows.Scan(&doc, &mh); err != nil {
			return nil, fmt.Errorf("store: scan fingerprint: %w", err)
		}
		out[doc] = mh
	}
	return out, rows.Err()
}

func (p *Postgres) EventCounts(ctx context.Context) (map[string]int64, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT event_type::text, count(*) FROM ledger_event GROUP BY 1`)
	if err != nil {
		return nil, fmt.Errorf("store: event counts: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var t string
		var n int64
		if err := rows.Scan(&t, &n); err != nil {
			return nil, fmt.Errorf("store: scan count: %w", err)
		}
		out[t] = n
	}
	return out, rows.Err()
}

// RefreshCurrentLabel 은 current_label 구체화 뷰를 갱신한다(조회 고속화 —
// 실패해도 원장 정합성에는 영향 없음).
func (p *Postgres) RefreshCurrentLabel(ctx context.Context) error {
	_, err := p.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW CONCURRENTLY current_label`)
	if err != nil {
		return fmt.Errorf("store: refresh current_label: %w", err)
	}
	return nil
}

func scanEvents(rows pgx.Rows) ([]ledger.Event, error) {
	defer rows.Close()
	var out []ledger.Event
	for rows.Next() {
		var e ledger.Event
		var typ string
		var grade, brm, appr, transform, signerSN, reason *string
		var attachMethod, formatID, fallbackReason, docsimFP *string
		var basis *int16
		var revokedRef *int64
		var parentHash, labelDER, textHash []byte
		var rootDoc *uuid.UUID
		var keywords []string
		var createdAt time.Time
		if err := rows.Scan(&e.Seq, &typ, &e.DocGUID, &e.ContentHash, &grade,
			&basis, &keywords, &brm, &appr, &parentHash, &rootDoc, &transform,
			&labelDER, &e.IssuerOrg, &signerSN, &revokedRef, &reason, &e.Actor,
			&attachMethod, &formatID, &fallbackReason, &textHash, &docsimFP,
			&e.PrevHash, &e.RowHash, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan event: %w", err)
		}
		e.AttachMethod = deref(attachMethod)
		e.FormatID = deref(formatID)
		e.FallbackReason = deref(fallbackReason)
		e.TextHash = textHash
		e.DocsimFP = deref(docsimFP)
		e.Type = ledger.EventType(typ)
		e.Grade = deref(grade)
		e.BRMPath = deref(brm)
		e.ApprovalState = deref(appr)
		e.Transform = deref(transform)
		e.SignerCertSN = deref(signerSN)
		e.Reason = deref(reason)
		e.BasisKeywords = keywords
		e.ParentHash = parentHash
		e.LabelDER = labelDER
		e.CreatedAt = createdAt.UTC()
		if basis != nil {
			e.BasisClause = *basis
		}
		if revokedRef != nil {
			e.RevokedRef = *revokedRef
		}
		if rootDoc != nil {
			e.RootDocID = *rootDoc
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func nullBytes(b []byte) []byte {
	if len(b) == 0 {
		return nil
	}
	return b
}

func nullI16(v int16) *int16 {
	if v == 0 {
		return nil
	}
	return &v
}

func nullI64(v int64) *int64 {
	if v == 0 {
		return nil
	}
	return &v
}

func nullUUID(u uuid.UUID) *uuid.UUID {
	if u == uuid.Nil {
		return nil
	}
	return &u
}

// CHAR(1) 컬럼에 grade를 넣을 때 공백 패딩이 붙지 않도록 TEXT 캐스팅은
// 스키마 쪽에서 처리한다(grade CHAR(1) — 단일 문자만 저장).
