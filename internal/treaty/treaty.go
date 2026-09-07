// Package treaty 는 등가성 협정·신뢰목록 인터페이스다.
// Phase 2 구현 예정 — Phase 1은 인터페이스만 뚫어둔다 (DEV SPEC §1, §9).
package treaty

import (
	"context"
	"time"
)

// Treaty 는 기관 간 등급 등가성 협정문이다.
type Treaty struct {
	ID        string            `json:"id"`
	PartyA    string            `json:"partyA"`
	PartyB    string            `json:"partyB"`
	GradeMap  map[string]string `json:"gradeMap"` // A등급 → B등급 번역표
	SignedAt  time.Time         `json:"signedAt"`
	NotAfter  time.Time         `json:"notAfter"`
	Signature []byte            `json:"signature,omitempty"` // Treaty Signer 서명
}

// Service 는 협정 조회·등급 번역 계약이다. Phase 1 구현체는 없으며,
// 검증 응답의 treaty 체크는 항상 "not_applicable"이다.
type Service interface {
	// List 는 유효한 협정 목록을 반환한다 (GET /v1/treaties).
	List(ctx context.Context) ([]Treaty, error)
	// Translate 는 발급 기관 등급을 검증 기관 기준으로 번역한다 (검증 L3).
	Translate(ctx context.Context, issuerOrg, verifierOrg, grade string) (translated string, found bool, err error)
}
