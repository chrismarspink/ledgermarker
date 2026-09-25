package verify_test

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/crypto/softhsm"
	"github.com/innotium/ledgermarker/internal/issue"
	"github.com/innotium/ledgermarker/internal/ledger"
	"github.com/innotium/ledgermarker/internal/store"
	"github.com/innotium/ledgermarker/internal/verify"
)

type env struct {
	ks     *softhsm.Keystore
	st     *store.Memory
	writer *ledger.Writer
	pool   *x509.CertPool
}

func setup(t *testing.T) *env {
	t.Helper()
	ks, err := softhsm.Open(t.TempDir(), "TESTORG")
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(ks.CACert())
	st := store.NewMemory()
	return &env{ks: ks, st: st, writer: ledger.NewWriter(st), pool: pool}
}

func (e *env) deps() verify.Deps {
	return verify.Deps{
		Ledger:         e.st,
		Roots:          e.pool,
		RevokedSerials: e.ks.RevokedSerials(),
	}
}

// issueRegistered 는 라벨 발급 + 원장 등록(서버 발급 경로 축약)을 수행한다.
func (e *env) issueRegistered(t *testing.T, content string, grade string) ([]byte, *issue.Label) {
	t.Helper()
	h := sha256.Sum256([]byte(content))
	lbl := &issue.Label{
		Grade: grade, IssuerOrgID: "TESTORG", DocGUID: uuid.New(),
		ContentHash: h[:], ApprovalState: issue.ApprovalConfirmed,
	}
	issue.EnsureFreshness(lbl, 365)
	der, err := issue.Build(context.Background(), e.ks.LabelSigner(), lbl)
	if err != nil {
		t.Fatal(err)
	}
	ev := &ledger.Event{
		Type: ledger.EventIssue, DocGUID: lbl.DocGUID, ContentHash: h[:],
		Grade: grade, ApprovalState: "CONFIRMED", RootDocID: lbl.DocGUID,
		LabelDER: der, IssuerOrg: "TESTORG",
		SignerCertSN: e.ks.LabelSigner().SerialNumber(), Actor: "test",
	}
	if err := e.writer.Append(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	return der, lbl
}

func run(t *testing.T, e *env, labelDER, contentHash []byte, level int) *verify.Result {
	t.Helper()
	res, err := verify.Run(context.Background(), e.deps(),
		verify.Params{LabelDER: labelDER, ContentHash: contentHash, Level: level})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// 정상 경로: 서명 valid + 원장 registered → allow.
func TestVerifyHappyPath(t *testing.T) {
	e := setup(t)
	der, lbl := e.issueRegistered(t, "doc-1", "S")
	res := run(t, e, der, lbl.ContentHash, 2)
	if res.Checks.Signature != verify.SigValid || res.Checks.Ledger != verify.LedgerRegistered {
		t.Fatalf("unexpected checks: %+v", res.Checks)
	}
	if res.VerdictHint != verify.HintAllow {
		t.Errorf("want allow, got %s (%v)", res.VerdictHint, res.Reasons)
	}
	if res.Attribution.Grade != "S" || res.Attribution.Confidence != 1.0 {
		t.Errorf("attribution: %+v", res.Attribution)
	}
}

// T4: 라벨 없는 파일 + 등록된 해시 → 폴백으로 귀속 성공, signature: "absent".
func TestT4_FallbackAttribution(t *testing.T) {
	e := setup(t)
	_, lbl := e.issueRegistered(t, "doc-4", "S")
	res := run(t, e, nil, lbl.ContentHash, 2)
	if res.Checks.Signature != verify.SigAbsent {
		t.Errorf("want signature absent, got %s", res.Checks.Signature)
	}
	if res.Checks.Ledger != verify.LedgerRegistered {
		t.Errorf("want registered, got %s", res.Checks.Ledger)
	}
	if res.Attribution.DocGUID != lbl.DocGUID.String() || res.Attribution.Grade != "S" {
		t.Errorf("fallback attribution failed: %+v", res.Attribution)
	}
}

// T5: 라벨 없는 파일 + 미등록 해시 → ledger: "unregistered".
func TestT5_UnregisteredHash(t *testing.T) {
	e := setup(t)
	h := sha256.Sum256([]byte("never-issued"))
	res := run(t, e, nil, h[:], 2)
	if res.Checks.Ledger != verify.LedgerUnregistered {
		t.Fatalf("want unregistered, got %s", res.Checks.Ledger)
	}
	if res.VerdictHint != verify.HintDeny {
		t.Errorf("want deny hint, got %s", res.VerdictHint)
	}
}

// T6: 원장 접속 차단 상태 → ledger: "unavailable", L1(서명)은 성공.
// T5(unregistered)와 반드시 구분되어야 한다.
func TestT6_LedgerUnavailable(t *testing.T) {
	e := setup(t)
	der, lbl := e.issueRegistered(t, "doc-6", "O")
	e.st.Unavailable = true // 원장 접속 차단

	res := run(t, e, der, lbl.ContentHash, 2)
	if res.Checks.Ledger != verify.LedgerUnavailable {
		t.Fatalf("want unavailable, got %s — unregistered와 혼동 금지", res.Checks.Ledger)
	}
	if res.Checks.Signature != verify.SigValid {
		t.Errorf("L1 must still succeed offline, got signature=%s", res.Checks.Signature)
	}
	if res.VerdictHint == verify.HintDeny {
		t.Error("unavailable must not be judged as deny (판단 보류)")
	}
}

// T7: 서명키 폐기 후, 폐기 이전 발급(원장 등록) 라벨 → 유효 판정.
func TestT7_RevokedKeyRegisteredLabelStillValid(t *testing.T) {
	e := setup(t)
	der, lbl := e.issueRegistered(t, "doc-7", "S")
	if err := e.ks.RevokeSerial(e.ks.LabelSigner().SerialNumber()); err != nil {
		t.Fatal(err)
	}
	res := run(t, e, der, lbl.ContentHash, 2)
	if res.Checks.Signature != verify.SigValid {
		t.Fatalf("registered label must stay valid after key revocation, got %s (%v)",
			res.Checks.Signature, res.Reasons)
	}
}

// T8: 서명키 폐기 후, 원장에 없는 서명 → 위조 판정(무효).
func TestT8_RevokedKeyUnregisteredIsForged(t *testing.T) {
	e := setup(t)
	h := sha256.Sum256([]byte("forged-doc"))
	lbl := &issue.Label{
		Grade: "S", IssuerOrgID: "TESTORG", DocGUID: uuid.New(),
		ContentHash: h[:], ApprovalState: issue.ApprovalConfirmed,
	}
	issue.EnsureFreshness(lbl, 365)
	// 원장에 등록하지 않고 서명만 생성 (유출 키로 만든 위조 라벨 시나리오)
	der, err := issue.Build(context.Background(), e.ks.LabelSigner(), lbl)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.ks.RevokeSerial(e.ks.LabelSigner().SerialNumber()); err != nil {
		t.Fatal(err)
	}
	res := run(t, e, der, h[:], 2)
	if res.Checks.Signature != verify.SigInvalid {
		t.Fatalf("unregistered signature from revoked key must be invalid, got %s (%v)",
			res.Checks.Signature, res.Reasons)
	}
	if res.VerdictHint != verify.HintDeny {
		t.Errorf("want deny, got %s", res.VerdictHint)
	}
}

// 라벨 유효기간 경과 → validity: expired.
func TestExpiredLabel(t *testing.T) {
	e := setup(t)
	der, lbl := e.issueRegistered(t, "doc-exp", "O")
	deps := e.deps()
	deps.Now = func() time.Time { return time.Now().AddDate(2, 0, 0) } // 2년 뒤
	res, err := verify.Run(context.Background(), deps,
		verify.Params{LabelDER: der, ContentHash: lbl.ContentHash, Level: 2})
	if err != nil {
		t.Fatal(err)
	}
	if res.Checks.Validity != verify.ValExpired {
		t.Fatalf("want expired, got %s", res.Checks.Validity)
	}
}

// 다른 문서의 라벨을 붙인 경우(바꿔치기) → signature invalid.
func TestLabelSwapDetected(t *testing.T) {
	e := setup(t)
	der, _ := e.issueRegistered(t, "doc-a", "S")
	other := sha256.Sum256([]byte("doc-b"))
	res := run(t, e, der, other[:], 2)
	if res.Checks.Signature != verify.SigInvalid {
		t.Fatalf("swapped label must be invalid, got %s", res.Checks.Signature)
	}
}
