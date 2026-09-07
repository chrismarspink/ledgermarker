package server_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/innotium/ledgermarker/internal/crypto/softhsm"
	"github.com/innotium/ledgermarker/internal/ledger"
	"github.com/innotium/ledgermarker/internal/server"
	"github.com/innotium/ledgermarker/internal/store"
	gatesdk "github.com/innotium/ledgermarker/sdk/go"
)

type env struct {
	ts *httptest.Server
	st *store.Memory
	c  *gatesdk.Client
}

func setup(t *testing.T) *env {
	t.Helper()
	ks, err := softhsm.Open(t.TempDir(), "TESTORG")
	if err != nil {
		t.Fatal(err)
	}
	st := store.NewMemory()
	srv := server.New(server.Config{
		Store:                st,
		LabelSigner:          ks.LabelSigner(),
		CheckpointSigner:     ks.CheckpointSigner(),
		CACert:               ks.CACert(),
		CACertPEM:            ks.CACertPEM(),
		RevokedSerials:       ks.RevokedSerials,
		IssuerOrg:            "TESTORG",
		RegradeApprovalToken: "secret-approval-token",
		DestroyApprovalToken: "destroy-committee-token",
	})
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return &env{ts: ts, st: st, c: gatesdk.New(ts.URL, "")}
}

func hashOf(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func (e *env) issue(t *testing.T, content, grade, idem string) *gatesdk.IssueResponse {
	t.Helper()
	resp, err := e.c.IssueLabel(context.Background(),
		gatesdk.IssueRequest{ContentHash: hashOf(content), Grade: grade}, idem)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestIssueAndVerifyEndToEnd(t *testing.T) {
	e := setup(t)
	resp := e.issue(t, "e2e-doc", "S", "k1")
	res, err := e.c.Verify(context.Background(), gatesdk.VerifyRequest{
		LabelDER: resp.LabelDER, ContentHash: hashOf("e2e-doc"), Level: 2})
	if err != nil {
		t.Fatal(err)
	}
	if res.Checks.Signature != "valid" || res.Checks.Ledger != "registered" {
		t.Fatalf("checks: %+v (%v)", res.Checks, res.Reasons)
	}
	if res.VerdictHint != "allow" {
		t.Errorf("want allow, got %s", res.VerdictHint)
	}
}

// T9: 등급 하향 요청, 승인 토큰 없음 → 거부.
func TestT9_DowngradeWithoutTokenRejected(t *testing.T) {
	e := setup(t)
	resp := e.issue(t, "t9-doc", "S", "t9")
	_, err := e.c.Regrade(context.Background(), resp.DocGUID, "O", "", "재분류")
	apiErr, ok := err.(*gatesdk.APIError)
	if !ok || apiErr.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403, got %v", err)
	}
	// 올바른 토큰이면 하향 성공
	if _, err := e.c.Regrade(context.Background(), resp.DocGUID, "O",
		"secret-approval-token", "재분류"); err != nil {
		t.Fatalf("downgrade with valid token must succeed: %v", err)
	}
}

// T10: 등급 상향 요청 → 즉시 처리 + 구 라벨 superseded 기록.
func TestT10_UpgradeImmediateOldSuperseded(t *testing.T) {
	e := setup(t)
	old := e.issue(t, "t10-doc", "O", "t10")
	newResp, err := e.c.Regrade(context.Background(), old.DocGUID, "S", "", "상향")
	if err != nil {
		t.Fatalf("upgrade must not require token: %v", err)
	}
	if newResp.LedgerSeq <= old.LedgerSeq {
		t.Error("regrade must append a new ledger row")
	}
	// 구 라벨 제시 → superseded
	res, err := e.c.Verify(context.Background(), gatesdk.VerifyRequest{
		LabelDER: old.LabelDER, ContentHash: hashOf("t10-doc"), Level: 2})
	if err != nil {
		t.Fatal(err)
	}
	if res.Checks.Revocation != "superseded" {
		t.Fatalf("old label must be superseded, got %s (%v)", res.Checks.Revocation, res.Reasons)
	}
	if res.Attribution.Grade != "S" {
		t.Errorf("attribution must show current grade S, got %s", res.Attribution.Grade)
	}
	// 새 라벨 제시 → 정상
	res2, err := e.c.Verify(context.Background(), gatesdk.VerifyRequest{
		LabelDER: newResp.LabelDER, ContentHash: hashOf("t10-doc"), Level: 2})
	if err != nil {
		t.Fatal(err)
	}
	if res2.Checks.Revocation != "none" || res2.Attribution.Grade != "S" {
		t.Errorf("new label: %+v", res2.Checks)
	}
}

// T11: C등급 발급 요청 → 400 에러 (범위 밖).
func TestT11_GradeCReturns400(t *testing.T) {
	e := setup(t)
	_, err := e.c.IssueLabel(context.Background(),
		gatesdk.IssueRequest{ContentHash: hashOf("t11"), Grade: "C"}, "t11")
	apiErr, ok := err.(*gatesdk.APIError)
	if !ok || apiErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("want 400, got %v", err)
	}
}

// T12: 동일 Idempotency-Key로 2회 발급 → 동일 결과, 원장 행 1개만.
func TestT12_IdempotentIssue(t *testing.T) {
	e := setup(t)
	r1 := e.issue(t, "t12-doc", "S", "same-key")
	r2 := e.issue(t, "t12-doc", "S", "same-key")
	if r1.DocGUID != r2.DocGUID || r1.LedgerSeq != r2.LedgerSeq || r1.LabelDER != r2.LabelDER {
		t.Fatal("same idempotency key must return identical response")
	}
	events, err := e.st.EventsRange(context.Background(), 1, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("want exactly 1 ledger row, got %d", len(events))
	}
}

// T13: v1→v2→v3 발급 후 lineage 조회 → 3세대 체인 정확히 반환.
func TestT13_ThreeGenerationLineage(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	v1 := e.issue(t, "doc-v1", "S", "v1")
	v2, err := e.c.IssueLabel(ctx, gatesdk.IssueRequest{
		ContentHash: hashOf("doc-v2"), Grade: "S",
		Lineage: &gatesdk.LineageDecl{ParentHash: hashOf("doc-v1"), Transform: "edit"},
	}, "v2")
	if err != nil {
		t.Fatal(err)
	}
	v3, err := e.c.IssueLabel(ctx, gatesdk.IssueRequest{
		ContentHash: hashOf("doc-v3"), Grade: "S",
		Lineage: &gatesdk.LineageDecl{ParentHash: hashOf("doc-v2"), Transform: "convert"},
	}, "v3")
	if err != nil {
		t.Fatal(err)
	}
	if v2.RootDocID != v1.DocGUID || v3.RootDocID != v1.DocGUID {
		t.Errorf("rootDocId must be v1: v2.root=%s v3.root=%s v1=%s",
			v2.RootDocID, v3.RootDocID, v1.DocGUID)
	}
	g, err := e.c.Lineage(ctx, v2.DocGUID, 10, "both")
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 3 || len(g.Edges) != 2 {
		t.Fatalf("want 3 nodes 2 edges, got %d/%d: %+v", len(g.Nodes), len(g.Edges), g)
	}
	edgeSet := map[string]string{}
	for _, ed := range g.Edges {
		edgeSet[ed.From] = ed.To
	}
	if edgeSet[v1.DocGUID] != v2.DocGUID || edgeSet[v2.DocGUID] != v3.DocGUID {
		t.Errorf("edge chain wrong: %+v", g.Edges)
	}
}

// 폐기 → REVOKE 이벤트 추가 → 검증 시 revoked.
func TestRevokeFlow(t *testing.T) {
	e := setup(t)
	resp := e.issue(t, "rv-doc", "O", "rv")
	if err := e.c.Revoke(context.Background(), resp.DocGUID, "오분류"); err != nil {
		t.Fatal(err)
	}
	res, err := e.c.Verify(context.Background(), gatesdk.VerifyRequest{
		LabelDER: resp.LabelDER, ContentHash: hashOf("rv-doc"), Level: 2})
	if err != nil {
		t.Fatal(err)
	}
	if res.Checks.Revocation != "revoked" || res.VerdictHint != "deny" {
		t.Fatalf("revoked check failed: %+v %s", res.Checks, res.VerdictHint)
	}
}

// 체크포인트 발행 → 최신 조회, 원장 무결성 점검.
func TestCheckpointAndLedgerVerify(t *testing.T) {
	e := setup(t)
	e.issue(t, "c1", "O", "c1")
	e.issue(t, "c2", "O", "c2")
	ck, err := e.c.SealCheckpoint(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ck.FromSeq != 1 || ck.ToSeq != 2 || ck.MerkleRoot == "" {
		t.Fatalf("checkpoint: %+v", ck)
	}
	latest, err := e.c.LatestCheckpoint(context.Background())
	if err != nil || latest.CkptID != ck.CkptID {
		t.Fatalf("latest checkpoint: %+v err=%v", latest, err)
	}
	lv, err := e.c.LedgerVerify(context.Background(), 1, 0)
	if err != nil || !lv.OK {
		t.Fatalf("ledger verify: %+v err=%v", lv, err)
	}
}

// T3(메모리 변형): 강제 조작 후 체인 점검이 조작 지점 seq를 정확히 지목.
// (PostgreSQL 슈퍼유저 조작 시나리오는 store/pg_integration_test.go 참조)
func TestT3_TamperDetectionViaAPI(t *testing.T) {
	e := setup(t)
	e.issue(t, "x1", "O", "x1")
	e.issue(t, "x2", "O", "x2")
	e.issue(t, "x3", "O", "x3")
	e.st.CorruptRow(2, func(ev *ledger.Event) { ev.Grade = "S" }) // O → S 위조
	lv, err := e.c.LedgerVerify(context.Background(), 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if lv.OK || lv.BadSeq != 2 {
		t.Fatalf("want badSeq=2, got %+v", lv)
	}
}

// 배치 스캔 → jobId → 완료 상태 확인.
func TestBatchScan(t *testing.T) {
	e := setup(t)
	items := []gatesdk.IssueRequest{
		{ContentHash: hashOf("b1"), Grade: "O"},
		{ContentHash: hashOf("b2"), Grade: "S"},
		{ContentHash: hashOf("b3"), Grade: "C"}, // 실패해야 함
	}
	jobID, err := e.c.BatchScan(context.Background(), items)
	if err != nil {
		t.Fatal(err)
	}
	var job *gatesdk.BatchJob
	for i := 0; i < 100; i++ {
		job, err = e.c.BatchStatus(context.Background(), jobID)
		if err != nil {
			t.Fatal(err)
		}
		if job.State == "done" {
			break
		}
	}
	if job.State != "done" || job.Done != 3 || job.Failed != 1 {
		t.Fatalf("job: %+v", job)
	}
}

// API 키가 구성되면 비공개 엔드포인트는 키를 요구한다.
func TestAPIKeyAuth(t *testing.T) {
	ks, _ := softhsm.Open(t.TempDir(), "TESTORG")
	st := store.NewMemory()
	srv := server.New(server.Config{
		Store: st, LabelSigner: ks.LabelSigner(), CheckpointSigner: ks.CheckpointSigner(),
		CACert: ks.CACert(), CACertPEM: ks.CACertPEM(), RevokedSerials: ks.RevokedSerials,
		IssuerOrg: "TESTORG", APIKeys: []string{"good-key"},
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// 키 없이 발급 → 401
	noKey := gatesdk.New(ts.URL, "")
	_, err := noKey.IssueLabel(context.Background(),
		gatesdk.IssueRequest{ContentHash: hashOf("a"), Grade: "O"}, "k")
	if apiErr, ok := err.(*gatesdk.APIError); !ok || apiErr.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %v", err)
	}
	// 검증은 공개 (PWA·게이트 공용)
	body, _ := json.Marshal(map[string]interface{}{"contentHash": hashOf("a"), "level": 2})
	resp, err := http.Post(ts.URL+"/v1/verify", "application/json", bytes.NewReader(body))
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("verify must be public: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()
}

// 파기(DESTROY): 심의 토큰 없이는 불가, 파기 후 사본 검증은 destroyed/deny,
// 원장 증적은 남는다 (docs/lifecycle-policy.md §3).
func TestDestroyLifecycle(t *testing.T) {
	e := setup(t)
	resp := e.issue(t, "destroy-doc", "S", "dz")

	// 토큰 없음 → 403
	err := e.c.Destroy(context.Background(), resp.DocGUID, "보존기간 만료", "")
	if apiErr, ok := err.(*gatesdk.APIError); !ok || apiErr.StatusCode != http.StatusForbidden {
		t.Fatalf("destroy without token must be 403, got %v", err)
	}
	// 근거 없음 → 400
	err = e.c.Destroy(context.Background(), resp.DocGUID, "", "destroy-committee-token")
	if apiErr, ok := err.(*gatesdk.APIError); !ok || apiErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("destroy without reason must be 400, got %v", err)
	}
	// 정상 파기
	if err := e.c.Destroy(context.Background(), resp.DocGUID,
		"보존기간 만료·기록물평가심의회 의결", "destroy-committee-token"); err != nil {
		t.Fatal(err)
	}
	// 재파기 → 409
	err = e.c.Destroy(context.Background(), resp.DocGUID, "again", "destroy-committee-token")
	if apiErr, ok := err.(*gatesdk.APIError); !ok || apiErr.StatusCode != http.StatusConflict {
		t.Fatalf("double destroy must be 409, got %v", err)
	}
	// 파기된 문서(사본) 검증 → revoked + destroyed + deny
	res, err := e.c.Verify(context.Background(), gatesdk.VerifyRequest{
		LabelDER: resp.LabelDER, ContentHash: hashOf("destroy-doc"), Level: 2})
	if err != nil {
		t.Fatal(err)
	}
	if res.Checks.Revocation != "revoked" || res.VerdictHint != "deny" {
		t.Fatalf("destroyed doc: %+v %s", res.Checks, res.VerdictHint)
	}
	found := false
	for _, r := range res.Reasons {
		if r == "destroyed" {
			found = true
		}
	}
	if !found {
		t.Fatalf("reasons must include 'destroyed': %v", res.Reasons)
	}
	// 원장 증적 확인 — DESTROY 행이 남아 있다
	events, _ := e.st.EventsRange(context.Background(), 1, 100)
	last := events[len(events)-1]
	if string(last.Type) != "DESTROY" || last.RevokedRef == 0 {
		t.Fatalf("ledger must keep DESTROY evidence row: %+v", last)
	}
}
