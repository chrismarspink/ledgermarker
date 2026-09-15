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
	// EventDestroy 는 파기다: 보존기간 만료 + 심의 후 키 파기.
	// 원장 행(해시·메타·계보)은 영구 보존된다 — 파기 증적이자,
	// 파기된 문서의 사본 유통을 게이트가 차단할 근거다.
	EventDestroy EventType = "DESTROY"
)

// IsIssuance 는 라벨을 동반하는 발급성 이벤트인지 반환한다.
func (t EventType) IsIssuance() bool {
	return t == EventIssue || t == EventDerive || t == EventRegrade
}

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
	// 부착 방식 기록 (작업지시서 §2.5) — 폴백 추적용.
	// 행 해시(§3.3 직렬화)에는 포함되지 않는 주석성 필드다.
	AttachMethod   string // embedded | container | sidecar | ledger_only
	FormatID       string // formats.yaml 의 id (unknown 포함)
	FallbackReason string // "" | not_implemented | attach_failed
	// TextHash: 정규화 본문 텍스트의 SHA-256 (SigNET H-5 흡수) —
	// 재저장·재압축으로 바이트가 바뀌어도 유지되는 2차 식별 색인.
	TextHash []byte
	// DocsimFP: 사내 docsim 모듈의 정밀 지문(JSON, 원문 복원 불가) — 선택.
	DocsimFP string
	PrevHash       []byte
	RowHash        []byte
	CreatedAt      time.Time
}
