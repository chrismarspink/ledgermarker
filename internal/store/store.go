// Package store 는 원장·부속 테이블 저장소 접근을 제공한다.
// 운영 구현은 PostgreSQL, 테스트 구현은 메모리다.
package store

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/chrismarspink/ledgermarker/internal/ledger"
)

// TrustAnchor 는 신뢰목록 항목(파트너 기관 CA)이다.
// Observation 은 게이트 관측 로그 한 행이다.
type Observation struct {
	ID              int64     `json:"id"`
	Kind            string    `json:"kind"` // SENT | RECEIVED | VERIFIED
	DocGUID         uuid.UUID `json:"docGuid"`
	ContentHash     []byte    `json:"-"`
	FromOrg         string    `json:"fromOrg"`
	ToOrg           string    `json:"toOrg"`
	Grade           string    `json:"grade,omitempty"`           // 발급 등급
	TranslatedGrade string    `json:"translatedGrade,omitempty"` // 검증 기관 기준 등급
	Treaty          string    `json:"treaty,omitempty"`          // verify.Checks.Treaty 값
	VerdictHint     string    `json:"verdictHint,omitempty"`
	Actor           string    `json:"actor,omitempty"`
	Note            string    `json:"note,omitempty"`
	ObservedAt      time.Time `json:"observedAt"` // 게이트가 보고한 시각
	CreatedAt       time.Time `json:"createdAt"`
}

// ObservationFilter 는 관측 로그 조회 조건이다. 빈 값은 무시한다.
type ObservationFilter struct {
	DocGUID *uuid.UUID
	FromOrg string
	ToOrg   string
	Kind    string
	Limit   int
}

type TrustAnchor struct {
	ID      int64     `json:"id"`
	OrgID   string    `json:"orgId"`
	CertPEM string    `json:"certPem"`
	AddedAt time.Time `json:"addedAt"`
}

// Store 는 서버가 필요로 하는 전체 저장소 계약이다.
// ledger.Writer가 요구하는 계약(ledger.Store)을 포함한다.
type Store interface {
	ledger.Store

	// ── 검증·계보 조회 ──
	EventsByContentHash(ctx context.Context, hash []byte) ([]ledger.Event, error)
	// EventsByTextHash 는 텍스트 해시(2차 식별자)로 조회한다 —
	// 재저장·재압축된 파일의 정확 재식별용.
	EventsByTextHash(ctx context.Context, textHash []byte) ([]ledger.Event, error)
	LatestByDoc(ctx context.Context, docGUID uuid.UUID) (*ledger.Event, error)
	ChildrenOf(ctx context.Context, contentHash []byte) ([]ledger.Event, error)

	// ── 멱등키 ──
	GetIdempotent(ctx context.Context, key string) ([]byte, error) // 없으면 (nil, nil)
	PutIdempotent(ctx context.Context, key string, response []byte) error

	// ── 신뢰목록 ──
	TrustAnchors(ctx context.Context) ([]TrustAnchor, error)
	AddTrustAnchor(ctx context.Context, ta *TrustAnchor) error

	// ── 지문 (관찰적 재식별 — 0001 마이그레이션의 fingerprint 테이블) ──
	// InsertFingerprint 는 문서 지문을 LSH 버킷별 행으로 저장한다.
	InsertFingerprint(ctx context.Context, docGUID uuid.UUID, minhash []byte, buckets []string) error
	// FingerprintCandidates 는 버킷을 하나라도 공유하는 문서들의
	// (docGUID → minhash)를 반환한다.
	FingerprintCandidates(ctx context.Context, buckets []string) (map[uuid.UUID][]byte, error)
	// DeleteFingerprints 는 한 문서의 기존 지문 행을 지운다(재색인용).
	// 지문 테이블은 불변 원장과 달리 갱신 가능한 2차 색인이다.
	DeleteFingerprints(ctx context.Context, docGUID uuid.UUID) error

	// ── 통계 (admin 대시보드) ──
	EventCounts(ctx context.Context) (map[string]int64, error)

	// ── 체크포인트 목록 (시각화의 봉인 구간) ──
	Checkpoints(ctx context.Context, limit int) ([]ledger.Checkpoint, error)

	// ── 게이트 관측 로그 (기관 간 이동·검증 기록) ──
	// 원장과 분리된 추가 전용 로그다: 발급 측 진실(원장)과 달리 게이트가
	// "보고한" 사실(보냈다·받았다·이렇게 읽었다)을 담는다. 본문은 없고
	// 판정은 호출자 보고값이므로 불변식 3·4와 정합한다.
	InsertObservation(ctx context.Context, o *Observation) error
	Observations(ctx context.Context, f ObservationFilter) ([]Observation, error)

	Close()
}
