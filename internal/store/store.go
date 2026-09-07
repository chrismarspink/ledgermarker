// Package store 는 원장·부속 테이블 저장소 접근을 제공한다.
// 운영 구현은 PostgreSQL, 테스트 구현은 메모리다.
package store

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/ledger"
)

// TrustAnchor 는 신뢰목록 항목(파트너 기관 CA)이다.
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
	LatestByDoc(ctx context.Context, docGUID uuid.UUID) (*ledger.Event, error)
	ChildrenOf(ctx context.Context, contentHash []byte) ([]ledger.Event, error)

	// ── 멱등키 ──
	GetIdempotent(ctx context.Context, key string) ([]byte, error) // 없으면 (nil, nil)
	PutIdempotent(ctx context.Context, key string, response []byte) error

	// ── 신뢰목록 ──
	TrustAnchors(ctx context.Context) ([]TrustAnchor, error)
	AddTrustAnchor(ctx context.Context, ta *TrustAnchor) error

	// ── 통계 (admin 대시보드) ──
	EventCounts(ctx context.Context) (map[string]int64, error)

	Close()
}
