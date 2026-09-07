package issue_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"testing"
	"time"

	"github.com/google/uuid"

	lmcrypto "github.com/innotium/ledgermarker/internal/crypto"
	"github.com/innotium/ledgermarker/internal/crypto/softhsm"
	"github.com/innotium/ledgermarker/internal/issue"
	"github.com/innotium/ledgermarker/internal/verify"
)

func testSigner(t *testing.T) (lmcrypto.Signer, *x509.CertPool) {
	t.Helper()
	ks, err := softhsm.Open(t.TempDir(), "TESTORG")
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(ks.CACert())
	return ks.LabelSigner(), pool
}

func sampleLabel() *issue.Label {
	h := sha256.Sum256([]byte("문서 본문"))
	return &issue.Label{
		Grade:         "S",
		BasisClause:   6,
		BasisKeywords: []string{"주민등록번호"},
		BRMPath:       "우정 > 우편 > 우편사업지원",
		IssuerOrgID:   "KPOST",
		DocGUID:       uuid.New(),
		ContentHash:   h[:],
		ApproverRank:  "3급",
		ApprovalState: issue.ApprovalConfirmed,
		IssuedAt:      time.Now().UTC().Truncate(time.Second),
		NotAfter:      time.Now().UTC().Truncate(time.Second).AddDate(1, 0, 0),
	}
}

func TestBuildParseRoundTrip(t *testing.T) {
	signer, _ := testSigner(t)
	lbl := sampleLabel()
	der, err := issue.Build(context.Background(), signer, lbl)
	if err != nil {
		t.Fatal(err)
	}
	got, err := issue.Parse(der)
	if err != nil {
		t.Fatal(err)
	}
	if got.Grade != "S" || got.IssuerOrgID != "KPOST" || got.BRMPath != lbl.BRMPath {
		t.Errorf("round trip mismatch: %+v", got)
	}
	if got.DocGUID != lbl.DocGUID || !bytes.Equal(got.ContentHash, lbl.ContentHash) {
		t.Error("docGuid/contentHash mismatch")
	}
	if got.BasisClause != 6 || len(got.BasisKeywords) != 1 || got.BasisKeywords[0] != "주민등록번호" {
		t.Errorf("basis mismatch: %+v", got)
	}
	if !got.IssuedAt.Equal(lbl.IssuedAt) || !got.NotAfter.Equal(lbl.NotAfter) {
		t.Errorf("time mismatch: %v %v", got.IssuedAt, got.NotAfter)
	}
	if got.ApprovalState != issue.ApprovalConfirmed {
		t.Error("approval state mismatch")
	}
}

// T11: C등급 발급 요청은 에러 (범위 밖).
func TestGradeCRejected(t *testing.T) {
	signer, _ := testSigner(t)
	lbl := sampleLabel()
	lbl.Grade = "C"
	if _, err := issue.Build(context.Background(), signer, lbl); err != issue.ErrGradeC {
		t.Fatalf("want ErrGradeC, got %v", err)
	}
}

// T1: 라벨의 grade 필드 1바이트 변조 → 서명 검증 실패 100% 탐지.
func TestT1_GradeTamperingDetected(t *testing.T) {
	signer, pool := testSigner(t)
	lbl := sampleLabel()
	der, err := issue.Build(context.Background(), signer, lbl)
	if err != nil {
		t.Fatal(err)
	}

	v := &verify.CMSVerifier{}
	opts := lmcrypto.VerifyOpts{Content: lbl.ContentHash, Roots: pool, At: time.Now()}

	// 변조 전: 유효
	res, err := v.Verify(context.Background(), der, opts)
	if err != nil || !res.SignatureValid || !res.ChainValid {
		t.Fatalf("pristine label must verify: %+v err=%v", res, err)
	}

	// grade 속성 값('S' 바이트)을 찾아 변조한다
	oidDER, _ := asn1.Marshal(issue.OIDGrade)
	idx := bytes.Index(der, oidDER)
	if idx < 0 {
		t.Fatal("grade OID not found in DER")
	}
	tampered := make([]byte, len(der))
	copy(tampered, der)
	flipped := false
	for i := idx + len(oidDER); i < idx+len(oidDER)+8 && i < len(tampered); i++ {
		if tampered[i] == 'S' {
			tampered[i] = 'O' // S등급을 O등급으로 위조 시도
			flipped = true
			break
		}
	}
	if !flipped {
		t.Fatal("grade byte not found")
	}

	// 변조 후: 파싱은 되지만(평문) 서명 검증은 반드시 실패
	got, err := issue.Parse(tampered)
	if err == nil && got.Grade != "O" {
		t.Fatalf("tampered grade should read as O, got %q", got.Grade)
	}
	res2, err := v.Verify(context.Background(), tampered, opts)
	if err == nil && res2.SignatureValid {
		t.Fatal("tampered label passed signature verification — T1 FAILED")
	}
}
