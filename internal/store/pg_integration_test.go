package store_test

// PostgreSQL 통합 테스트 — T2(UPDATE/DELETE 거부), T3(슈퍼유저 조작 탐지).
//
// 실행: LM_TEST_DB=postgres://postgres:postgres@localhost:5433/lm_test go test ./internal/store/
// (deploy/docker-compose.test.yml 로 PG16 기동 가능. 미설정 시 skip.)

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/ledger"
	"github.com/innotium/ledgermarker/internal/store"
	"github.com/innotium/ledgermarker/migrations"
)

func pgSetup(t *testing.T) *store.Postgres {
	t.Helper()
	dsn := os.Getenv("LM_TEST_DB")
	if dsn == "" {
		t.Skip("LM_TEST_DB not set — PostgreSQL 통합 테스트 skip")
	}
	if err := migrations.Run(dsn); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	pg, err := store.OpenPostgres(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pg.Close)
	return pg
}

// appendN 은 n행을 추가하고 (writer, 추가 시작 seq)를 반환한다.
// 원장은 truncate할 수 없으므로(append-only) 각 테스트는 자기 구간만 점검한다.
func appendN(t *testing.T, pg *store.Postgres, n int) (*ledger.Writer, int64) {
	t.Helper()
	tipBefore, _, err := pg.Tip(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	w := ledger.NewWriter(pg)
	for i := 0; i < n; i++ {
		e := &ledger.Event{
			Type: ledger.EventIssue, DocGUID: uuid.New(),
			ContentHash: bytes.Repeat([]byte{byte(i + 1)}, 32),
			Grade:       "O", IssuerOrg: "TESTORG", Actor: "itest",
		}
		if err := w.Append(context.Background(), e); err != nil {
			t.Fatal(err)
		}
	}
	return w, tipBefore + 1
}

// T2: 원장 임의 행 UPDATE/DELETE 시도 → DB 예외로 거부 (트리거 이중 잠금).
func TestT2_UpdateDeleteRejected(t *testing.T) {
	pg := pgSetup(t)
	_, _ = appendN(t, pg, 3)

	ctx := context.Background()
	_, err := pg.Pool().Exec(ctx, `UPDATE ledger_event SET grade = 'S' WHERE seq = 1`)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("UPDATE must be rejected by trigger, got %v", err)
	}
	_, err = pg.Pool().Exec(ctx, `DELETE FROM ledger_event WHERE seq = 1`)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("DELETE must be rejected by trigger, got %v", err)
	}
	// checkpoint도 추가 전용 (행이 있어야 FOR EACH ROW 트리거가 발화한다)
	if err := pg.InsertCheckpoint(ctx, &ledger.Checkpoint{
		FromSeq: 1, ToSeq: 1, MerkleRoot: []byte{1}, Signature: []byte{1},
		SignerCertSN: "t", SignedAt: timeNowUTC(),
	}); err != nil {
		t.Fatal(err)
	}
	_, err = pg.Pool().Exec(ctx, `UPDATE checkpoint SET to_seq = 999`)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("checkpoint UPDATE must be rejected, got %v", err)
	}
}

// T3: 슈퍼유저가 트리거를 우회해 행을 강제 조작해도, 체인 검증이
// 조작 지점 seq를 정확히 지목한다.
func TestT3_SuperuserTamperDetected(t *testing.T) {
	pg := pgSetup(t)
	w, firstSeq := appendN(t, pg, 5)
	ctx := context.Background()

	tipSeq, _, err := pg.Tip(ctx)
	if err != nil {
		t.Fatal(err)
	}
	target := tipSeq - 2 // 이번에 추가한 5행 중 중간 행 조작

	// session_replication_role=replica 로 트리거를 우회 (슈퍼유저 조작 시뮬레이션)
	tx, err := pg.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE ledger_event SET grade = 'S' WHERE seq = $1`, target); err != nil {
		t.Fatalf("superuser bypass failed (권한 확인): %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	badSeq, _, err := w.Verify(ctx, firstSeq, 0)
	if err != nil {
		t.Fatal(err)
	}
	if badSeq != target {
		t.Fatalf("want tamper detected at seq %d, got %d", target, badSeq)
	}
}

// 저장·재조회 왕복: writer가 만든 해시가 DB 왕복 후에도 재계산과 일치.
func TestPGRoundTripChainIntact(t *testing.T) {
	pg := pgSetup(t)
	w, firstSeq := appendN(t, pg, 10)
	badSeq, checked, err := w.Verify(context.Background(), firstSeq, 0)
	if err != nil {
		t.Fatal(err)
	}
	if badSeq != 0 {
		t.Fatalf("clean ledger reported bad seq %d (checked %d)", badSeq, checked)
	}
}

func timeNowUTC() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }
