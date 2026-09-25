package issue

import (
	"context"
	"crypto/x509"
	"encoding/asn1"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/smallstep/pkcs7"

	lmcrypto "github.com/chrismarspink/ledgermarker/internal/crypto"
)

// Build 는 라벨을 CMS SignedData(DER)로 조립·서명한다.
//
// 구조 (DEV SPEC §4.1):
//   - encapContentInfo: detached (원문은 contentHash 32바이트)
//   - signedAttributes: LM 라벨 필드 (평문·서명 대상)
//
// S등급 본문 EnvelopedData는 서버가 본문을 저장하지 않으므로(불변식 3)
// 서버 발급 라벨에는 포함되지 않는다. 본문 암호화는 클라이언트 측
// 작업이며 crypto.Cipher 인터페이스로 수행한다.
func Build(ctx context.Context, signer lmcrypto.Signer, lbl *Label) ([]byte, error) {
	if err := ValidateGrade(lbl.Grade); err != nil {
		return nil, err
	}
	if len(lbl.ContentHash) != 32 {
		return nil, fmt.Errorf("issue: contentHash must be 32 bytes, got %d", len(lbl.ContentHash))
	}
	lbl.ProfileVersion = ProfileVersion

	attrs, err := signedAttributes(lbl)
	if err != nil {
		return nil, fmt.Errorf("issue: build signed attributes: %w", err)
	}

	sd, err := pkcs7.NewSignedData(lbl.ContentHash)
	if err != nil {
		return nil, fmt.Errorf("issue: new SignedData: %w", err)
	}
	sd.SetDigestAlgorithm(pkcs7.OIDDigestAlgorithmSHA256)

	cert, err := x509.ParseCertificate(signer.CertDER())
	if err != nil {
		return nil, fmt.Errorf("issue: parse signer cert: %w", err)
	}
	std, err := lmcrypto.NewStdSigner(signer)
	if err != nil {
		return nil, fmt.Errorf("issue: adapt signer: %w", err)
	}
	if err := sd.AddSigner(cert, std, pkcs7.SignerInfoConfig{ExtraSignedAttributes: attrs}); err != nil {
		return nil, fmt.Errorf("issue: add signer: %w", err)
	}
	sd.Detach()
	der, err := sd.Finish()
	if err != nil {
		return nil, fmt.Errorf("issue: finish CMS: %w", err)
	}
	return der, nil
}

// signedAttributes 는 라벨 필드를 커스텀 signedAttributes로 인코딩한다.
// 인코딩 규칙은 docs/label-profile.md에 고정되어 있다.
func signedAttributes(l *Label) ([]pkcs7.Attribute, error) {
	var attrs []pkcs7.Attribute
	var firstErr error
	add := func(oid asn1.ObjectIdentifier, der []byte, err error) {
		if firstErr != nil {
			return
		}
		if err != nil {
			firstErr = fmt.Errorf("attribute %v: %w", oid, err)
			return
		}
		attrs = append(attrs, pkcs7.Attribute{Type: oid, Value: asn1.RawValue{FullBytes: der}})
	}
	marshal := func(v interface{}) ([]byte, error) { return asn1.Marshal(v) }

	// 필수 필드
	der, err := marshal(l.ProfileVersion)
	add(OIDProfileVersion, der, err)
	der, err = marshalUTF8(l.Grade)
	add(OIDGrade, der, err)
	der, err = marshalUTF8(l.IssuerOrgID)
	add(OIDIssuerOrgID, der, err)
	der, err = marshal(l.DocGUID[:])
	add(OIDDocGUID, der, err)
	der, err = marshal(l.ContentHash)
	add(OIDContentHash, der, err)
	der, err = marshal(asn1.Enumerated(l.ApprovalState))
	add(OIDApprovalState, der, err)
	der, err = marshalGeneralizedTime(l.IssuedAt)
	add(OIDIssuedAt, der, err)
	der, err = marshalGeneralizedTime(l.NotAfter)
	add(OIDNotAfter, der, err)

	// 선택 필드
	if l.BasisClause != 0 {
		der, err = marshal(l.BasisClause)
		add(OIDBasisClause, der, err)
	}
	if len(l.BasisKeywords) > 0 {
		der, err = marshalUTF8Seq(l.BasisKeywords)
		add(OIDBasisKeywords, der, err)
	}
	if l.BRMPath != "" {
		der, err = marshalUTF8(l.BRMPath)
		add(OIDBRMPath, der, err)
	}
	if l.ApproverRank != "" {
		der, err = marshalUTF8(l.ApproverRank)
		add(OIDApproverRank, der, err)
	}
	if !l.DisclosureCondition.IsZero() {
		der, err = marshalGeneralizedTime(l.DisclosureCondition)
		add(OIDDisclosureCondition, der, err)
	}
	if len(l.ParentHash) > 0 {
		der, err = marshal(l.ParentHash)
		add(OIDParentHash, der, err)
	}
	if l.RootDocID != uuid.Nil {
		der, err = marshal(l.RootDocID[:])
		add(OIDRootDocID, der, err)
	}
	if l.Transform != "" {
		der, err = marshalUTF8(l.Transform)
		add(OIDTransform, der, err)
	}
	if l.ExportApprover != "" {
		der, err = marshalUTF8(l.ExportApprover)
		add(OIDExportApprover, der, err)
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return attrs, nil
}

// marshalUTF8 은 문자열을 항상 UTF8String 태그로 인코딩한다
// (encoding/asn1 기본값은 PrintableString이므로 강제한다).
func marshalUTF8(s string) ([]byte, error) {
	return asn1.MarshalWithParams(s, "utf8")
}

func marshalGeneralizedTime(t time.Time) ([]byte, error) {
	return asn1.MarshalWithParams(t.UTC().Truncate(time.Second), "generalized")
}

// marshalUTF8Seq 는 SEQUENCE OF UTF8String을 인코딩한다.
func marshalUTF8Seq(ss []string) ([]byte, error) {
	var inner []byte
	for _, s := range ss {
		b, err := marshalUTF8(s)
		if err != nil {
			return nil, err
		}
		inner = append(inner, b...)
	}
	return asn1.Marshal(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: inner})
}
