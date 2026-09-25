package issue

import (
	"encoding/asn1"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// RFC 5652 구조 중 라벨 속성 추출에 필요한 최소한만 정의한다.
// 서명 검증 자체는 pkcs7 라이브러리가 수행하고(verify 패키지),
// 여기서는 signedAttributes를 평문으로 읽기만 한다 — 게이트가
// 복호화·검증 없이도 등급을 읽을 수 있어야 한다는 불변식 2의 구현체다.

type contentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue `asn1:"explicit,optional,tag:0"`
}

type signedDataMin struct {
	Version          int
	DigestAlgorithms asn1.RawValue `asn1:"set"`
	EncapContent     asn1.RawValue
	Certificates     asn1.RawValue `asn1:"optional,tag:0"`
	CRLs             asn1.RawValue `asn1:"optional,tag:1"`
	SignerInfos      asn1.RawValue `asn1:"set"`
}

type signerInfoMin struct {
	Version               int
	IssuerAndSerialNumber asn1.RawValue
	DigestAlgorithm       asn1.RawValue
	SignedAttrs           asn1.RawValue `asn1:"optional,tag:0"`
	// 이후 필드(서명 알고리즘·서명값)는 여기서 불필요
}

type attributeRaw struct {
	Type   asn1.ObjectIdentifier
	Values asn1.RawValue `asn1:"set"`
}

// Parse 는 CMS 라벨 DER에서 라벨 필드를 추출한다. 서명 검증은 하지 않는다.
func Parse(der []byte) (*Label, error) {
	var ci contentInfo
	if _, err := asn1.Unmarshal(der, &ci); err != nil {
		return nil, fmt.Errorf("issue: parse ContentInfo: %w", err)
	}
	var sd signedDataMin
	if _, err := asn1.Unmarshal(ci.Content.Bytes, &sd); err != nil {
		return nil, fmt.Errorf("issue: parse SignedData: %w", err)
	}
	// SignerInfos: SET OF SignerInfo — 첫 서명자만 사용
	var si signerInfoMin
	if _, err := asn1.Unmarshal(wrapSequence(sd.SignerInfos.Bytes), &si); err != nil {
		return nil, fmt.Errorf("issue: parse SignerInfo: %w", err)
	}
	if len(si.SignedAttrs.Bytes) == 0 {
		return nil, fmt.Errorf("issue: label has no signedAttributes")
	}

	lbl := &Label{}
	rest := si.SignedAttrs.Bytes
	for len(rest) > 0 {
		var attr attributeRaw
		var err error
		rest, err = asn1.Unmarshal(rest, &attr)
		if err != nil {
			return nil, fmt.Errorf("issue: parse attribute: %w", err)
		}
		if err := decodeAttr(lbl, &attr); err != nil {
			return nil, fmt.Errorf("issue: decode attribute %v: %w", attr.Type, err)
		}
	}
	if lbl.ProfileVersion == 0 || lbl.Grade == "" {
		return nil, fmt.Errorf("issue: not an LM label (missing profileVersion/grade)")
	}
	return lbl, nil
}

// wrapSequence 는 SET OF의 첫 요소(SEQUENCE)를 그대로 반환하기 위해
// SET 내부 바이트에서 첫 TLV를 취한다. SignerInfo는 SEQUENCE이므로
// 그대로 Unmarshal 가능하다.
func wrapSequence(setInner []byte) []byte {
	return setInner
}

func decodeAttr(l *Label, a *attributeRaw) error {
	v := a.Values.Bytes // SET OF AttributeValue — 단일 값 규약
	switch {
	case a.Type.Equal(OIDProfileVersion):
		return unmarshalInto(v, &l.ProfileVersion, "")
	case a.Type.Equal(OIDGrade):
		return unmarshalInto(v, &l.Grade, "utf8")
	case a.Type.Equal(OIDBasisClause):
		return unmarshalInto(v, &l.BasisClause, "")
	case a.Type.Equal(OIDBasisKeywords):
		return unmarshalInto(v, &l.BasisKeywords, "")
	case a.Type.Equal(OIDBRMPath):
		return unmarshalInto(v, &l.BRMPath, "utf8")
	case a.Type.Equal(OIDIssuerOrgID):
		return unmarshalInto(v, &l.IssuerOrgID, "utf8")
	case a.Type.Equal(OIDDocGUID):
		return unmarshalUUID(v, &l.DocGUID)
	case a.Type.Equal(OIDContentHash):
		return unmarshalInto(v, &l.ContentHash, "")
	case a.Type.Equal(OIDApproverRank):
		return unmarshalInto(v, &l.ApproverRank, "utf8")
	case a.Type.Equal(OIDApprovalState):
		var e asn1.Enumerated
		if err := unmarshalInto(v, &e, ""); err != nil {
			return err
		}
		l.ApprovalState = int(e)
		return nil
	case a.Type.Equal(OIDDisclosureCondition):
		return unmarshalInto(v, &l.DisclosureCondition, "generalized")
	case a.Type.Equal(OIDParentHash):
		return unmarshalInto(v, &l.ParentHash, "")
	case a.Type.Equal(OIDRootDocID):
		return unmarshalUUID(v, &l.RootDocID)
	case a.Type.Equal(OIDTransform):
		return unmarshalInto(v, &l.Transform, "utf8")
	case a.Type.Equal(OIDIssuedAt):
		return unmarshalInto(v, &l.IssuedAt, "generalized")
	case a.Type.Equal(OIDNotAfter):
		return unmarshalInto(v, &l.NotAfter, "generalized")
	case a.Type.Equal(OIDExportApprover):
		return unmarshalInto(v, &l.ExportApprover, "utf8")
	default:
		// 표준 CMS 속성(contentType, messageDigest, signingTime 등)은 무시
		return nil
	}
}

func unmarshalInto(der []byte, out interface{}, params string) error {
	var err error
	if params == "" {
		_, err = asn1.Unmarshal(der, out)
	} else {
		_, err = asn1.UnmarshalWithParams(der, out, params)
	}
	return err
}

func unmarshalUUID(der []byte, out *uuid.UUID) error {
	var b []byte
	if _, err := asn1.Unmarshal(der, &b); err != nil {
		return err
	}
	u, err := uuid.FromBytes(b)
	if err != nil {
		return err
	}
	*out = u
	return nil
}

// EnsureFreshness 는 발급 시각·유효기간 필드를 채운다.
func EnsureFreshness(l *Label, notAfterDays int) {
	now := time.Now().UTC().Truncate(time.Second)
	if l.IssuedAt.IsZero() {
		l.IssuedAt = now
	}
	if l.NotAfter.IsZero() {
		if notAfterDays <= 0 {
			notAfterDays = 365
		}
		l.NotAfter = now.AddDate(0, 0, notAfterDays)
	}
}
