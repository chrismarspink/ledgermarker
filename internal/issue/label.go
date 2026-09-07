// Package issue 는 라벨(문서 여권) 발급을 담당한다.
// CMS SignedData(RFC 5652)를 외부 래퍼로 쓰고, LM 라벨 필드는
// signedAttributes(평문·서명 대상)에 커스텀 속성으로 넣는다 (DEV SPEC §4).
//
// 불변식: 라벨의 등급 필드는 평문이다. 게이트가 복호화 없이 읽을 수 있어야 한다.
package issue

import (
	"encoding/asn1"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ProfileVersion 은 현재 라벨 프로파일 버전이다.
// docs/label-profile.md 변경 시에만 올린다.
const ProfileVersion = 1

// OID arc: 사내 임시 할당. ✎ 확인 필요: 정식 OID arc 배정 (DEV SPEC §13-1).
// 정식 배정 시 docs/label-profile.md와 함께 갱신하고 profileVersion을 올린다.
var (
	oidBase                = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 55555, 53, 1}
	OIDProfileVersion      = append(oidBase[:len(oidBase):len(oidBase)], 1)
	OIDGrade               = append(oidBase[:len(oidBase):len(oidBase)], 2)
	OIDBasisClause         = append(oidBase[:len(oidBase):len(oidBase)], 3)
	OIDBasisKeywords       = append(oidBase[:len(oidBase):len(oidBase)], 4)
	OIDBRMPath             = append(oidBase[:len(oidBase):len(oidBase)], 5)
	OIDIssuerOrgID         = append(oidBase[:len(oidBase):len(oidBase)], 6)
	OIDDocGUID             = append(oidBase[:len(oidBase):len(oidBase)], 7)
	OIDContentHash         = append(oidBase[:len(oidBase):len(oidBase)], 8)
	OIDApproverRank        = append(oidBase[:len(oidBase):len(oidBase)], 9)
	OIDApprovalState       = append(oidBase[:len(oidBase):len(oidBase)], 10)
	OIDDisclosureCondition = append(oidBase[:len(oidBase):len(oidBase)], 11)
	OIDParentHash          = append(oidBase[:len(oidBase):len(oidBase)], 12)
	OIDRootDocID           = append(oidBase[:len(oidBase):len(oidBase)], 13)
	OIDTransform           = append(oidBase[:len(oidBase):len(oidBase)], 14)
	OIDIssuedAt            = append(oidBase[:len(oidBase):len(oidBase)], 15)
	OIDNotAfter            = append(oidBase[:len(oidBase):len(oidBase)], 16)
	OIDExportApprover      = append(oidBase[:len(oidBase):len(oidBase)], 17)
)

// 승인 상태 (ENUMERATED)
const (
	ApprovalProvisional = 0 // 기관 내부 통행까지만 유효
	ApprovalConfirmed   = 1
)

// ErrGradeC: C등급은 이 체계의 범위 밖이다. 발급하지 않고 에러 반환 (DEV SPEC §4.2, T11).
var ErrGradeC = errors.New("issue: grade C is out of scope; label not issued")

// ErrBadGrade: 허용 등급은 S/O 뿐이다.
var ErrBadGrade = errors.New("issue: grade must be 'S' or 'O'")

// Label 은 라벨 필드(signedAttributes 커스텀 속성)다 (DEV SPEC §4.2).
type Label struct {
	ProfileVersion      int       `json:"profileVersion"`
	Grade               string    `json:"grade"` // "S" | "O" ("C"는 발급 거부)
	BasisClause         int       `json:"basisClause,omitempty"`
	BasisKeywords       []string  `json:"basisKeywords,omitempty"`
	BRMPath             string    `json:"brmPath,omitempty"`
	IssuerOrgID         string    `json:"issuerOrgId"`
	DocGUID             uuid.UUID `json:"docGuid"`
	ContentHash         []byte    `json:"contentHash"`
	ApproverRank        string    `json:"approverRank,omitempty"`
	ApprovalState       int       `json:"approvalState"`
	DisclosureCondition time.Time `json:"disclosureCondition,omitempty"`
	ParentHash          []byte    `json:"parentHash,omitempty"`
	RootDocID           uuid.UUID `json:"rootDocId,omitempty"`
	Transform           string    `json:"transform,omitempty"` // edit|convert|merge|extract
	IssuedAt            time.Time `json:"issuedAt"`
	NotAfter            time.Time `json:"notAfter"`
	ExportApprover      string    `json:"exportApprover,omitempty"`
}

// ApprovalStateString 은 원장 표기 문자열을 반환한다.
func (l *Label) ApprovalStateString() string {
	if l.ApprovalState == ApprovalConfirmed {
		return "CONFIRMED"
	}
	return "PROVISIONAL"
}

// ValidateGrade 는 발급 가능 등급인지 검사한다.
func ValidateGrade(grade string) error {
	switch grade {
	case "S", "O":
		return nil
	case "C":
		return ErrGradeC
	default:
		return ErrBadGrade
	}
}
