// Package ledger 는 추가 전용 원장(대장)을 구현한다.
//
// 불변식 (DEV SPEC §0):
//   - 원장은 절대 수정·삭제되지 않는다. 모든 변경은 새 이벤트 행 추가다.
//   - 폐기·등급변경은 REVOKE/REGRADE 이벤트 행 추가로 표현한다.
package ledger

import (
	"time"

	"github.com/google/uuid"
)

// EventType 은 원장 이벤트 종류다.
type EventType string

const (
	EventIssue   EventType = "ISSUE"
	EventRevoke  EventType = "REVOKE"
	EventRegrade EventType = "REGRADE"
	EventDerive  EventType = "DERIVE"
)

// Event 는 ledger_event 한 행이다.
type Event struct {
	Seq           int64
	Type          EventType
	DocGUID       uuid.UUID
	ContentHash   []byte // SHA-256, 32 bytes
	Grade         string // "S" | "O" | "" (REVOKE 등)
	BasisClause   int16  // 정보공개법 9조 호수 1~8, 0 = 없음
	BasisKeywords []string
	BRMPath       string
	ApprovalState string // "PROVISIONAL" | "CONFIRMED"
	ParentHash    []byte // 선언적 계보(직전 버전 content_hash)
	RootDocID     uuid.UUID
	Transform     string // edit | convert | merge | extract
	LabelDER      []byte // CMS 라벨 원본
	IssuerOrg     string
	SignerCertSN  string
	RevokedRef    int64 // REVOKE/REGRADE가 가리키는 원 seq, 0 = 없음
	Reason        string
	Actor         string
	PrevHash      []byte
	RowHash       []byte
	CreatedAt     time.Time
}
