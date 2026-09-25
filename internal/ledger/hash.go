package ledger

import (
	"bytes"
	"crypto/sha256"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// GenesisPrevHash 는 최초 행의 prev_hash(32바이트 0)다.
var GenesisPrevHash = make([]byte, 32)

// RowHash 는 원장 행 해시를 계산한다 (DEV SPEC §3.3).
//
//	row_hash = SHA256(prev_hash || seq || event_type || doc_guid || content_hash ||
//	                  COALESCE(grade,'') || COALESCE(parent_hash,'') || issuer_org ||
//	                  actor || created_at(RFC3339Nano))
//
// 직렬화 규칙(테스트로 잠금 — 변경 금지):
//   - prev_hash, content_hash, parent_hash: 원시 바이트
//   - seq: 10진수 ASCII
//   - doc_guid: 소문자 하이픈 표기 문자열
//   - created_at: UTC RFC3339Nano 문자열
//   - 필드 구분자 없음, 고정 순서 연결
func RowHash(prevHash []byte, seq int64, eventType EventType, docGUID uuid.UUID,
	contentHash []byte, grade string, parentHash []byte, issuerOrg, actor string,
	createdAt time.Time) []byte {

	h := sha256.New()
	h.Write(prevHash)
	h.Write([]byte(strconv.FormatInt(seq, 10)))
	h.Write([]byte(eventType))
	h.Write([]byte(docGUID.String()))
	h.Write(contentHash)
	h.Write([]byte(grade))
	h.Write(parentHash)
	h.Write([]byte(issuerOrg))
	h.Write([]byte(actor))
	h.Write([]byte(createdAt.UTC().Format(time.RFC3339Nano)))
	return h.Sum(nil)
}

// EventRowHash 는 채워진 이벤트의 행 해시를 계산한다.
func EventRowHash(e *Event) []byte {
	return RowHash(e.PrevHash, e.Seq, e.Type, e.DocGUID, e.ContentHash,
		e.Grade, e.ParentHash, e.IssuerOrg, e.Actor, e.CreatedAt)
}

// VerifyChain 은 연속 이벤트 구간의 체인 무결성을 점검한다.
// events는 seq 오름차순이어야 한다. prevHash는 구간 직전 행의 row_hash
// (구간이 seq 1부터면 GenesisPrevHash)다.
// 반환: 조작이 발견된 첫 seq (없으면 0).
func VerifyChain(events []Event, prevHash []byte) (badSeq int64) {
	for i := range events {
		e := &events[i]
		if !bytes.Equal(e.PrevHash, prevHash) {
			return e.Seq
		}
		if !bytes.Equal(EventRowHash(e), e.RowHash) {
			return e.Seq
		}
		prevHash = e.RowHash
	}
	return 0
}
