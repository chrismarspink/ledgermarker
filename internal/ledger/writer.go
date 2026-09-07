package ledger

import (
	"context"
	"fmt"
	"sync"
	"time"

	lmcrypto "github.com/innotium/ledgermarker/internal/crypto"
)

// Store 는 Writer가 필요로 하는 최소 저장소 계약이다.
type Store interface {
	// Tip 은 체인 tip을 반환한다. 원장이 비어 있으면 (0, GenesisPrevHash, nil).
	Tip(ctx context.Context) (seq int64, rowHash []byte, err error)
	// InsertEvent 는 완성된(seq·row_hash 포함) 이벤트를 삽입한다.
	InsertEvent(ctx context.Context, e *Event) error
	// EventsRange 는 [from, to] 구간 이벤트를 seq 오름차순으로 반환한다.
	EventsRange(ctx context.Context, from, to int64) ([]Event, error)
	// InsertCheckpoint 는 체크포인트를 저장한다.
	InsertCheckpoint(ctx context.Context, c *Checkpoint) error
	// LatestCheckpoint 는 최신 체크포인트를 반환한다. 없으면 (nil, nil).
	LatestCheckpoint(ctx context.Context) (*Checkpoint, error)
}

// Checkpoint 는 원장 봉인 레코드다.
type Checkpoint struct {
	ID           int64
	FromSeq      int64
	ToSeq        int64
	MerkleRoot   []byte
	Signature    []byte
	SignerCertSN string
	SignedAt     time.Time
}

// Writer 는 원장 유일 기록자다. Phase 1은 단일 writer 직렬화를 쓴다
// (DEV SPEC §3.3 — 구현 단순, 처리량 충분).
type Writer struct {
	mu    sync.Mutex
	store Store
}

func NewWriter(store Store) *Writer {
	return &Writer{store: store}
}

// Append 는 이벤트에 seq·prev_hash·row_hash·created_at을 채워 원장에 추가한다.
func (w *Writer) Append(ctx context.Context, e *Event) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	tipSeq, tipHash, err := w.store.Tip(ctx)
	if err != nil {
		return fmt.Errorf("ledger: read tip: %w", err)
	}
	e.Seq = tipSeq + 1
	e.PrevHash = tipHash
	// PostgreSQL timestamptz는 마이크로초 정밀도다. 저장 후 재계산한 해시가
	// 일치하도록 여기서 마이크로초로 절단한다.
	e.CreatedAt = time.Now().UTC().Truncate(time.Microsecond)
	e.RowHash = EventRowHash(e)

	if err := w.store.InsertEvent(ctx, e); err != nil {
		return fmt.Errorf("ledger: insert event seq %d: %w", e.Seq, err)
	}
	return nil
}

// SealCheckpoint 는 [from, to] 구간을 머클 루트로 봉인하고 서명한다.
// to=0 이면 현재 tip까지. from=0 이면 직전 체크포인트 다음부터.
func (w *Writer) SealCheckpoint(ctx context.Context, signer lmcrypto.Signer, from, to int64) (*Checkpoint, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if to == 0 {
		tipSeq, _, err := w.store.Tip(ctx)
		if err != nil {
			return nil, fmt.Errorf("ledger: read tip: %w", err)
		}
		to = tipSeq
	}
	if from == 0 {
		last, err := w.store.LatestCheckpoint(ctx)
		if err != nil {
			return nil, fmt.Errorf("ledger: read latest checkpoint: %w", err)
		}
		if last != nil {
			from = last.ToSeq + 1
		} else {
			from = 1
		}
	}
	if from > to {
		return nil, fmt.Errorf("ledger: nothing to seal (from %d > to %d)", from, to)
	}
	events, err := w.store.EventsRange(ctx, from, to)
	if err != nil {
		return nil, fmt.Errorf("ledger: read range: %w", err)
	}
	if int64(len(events)) != to-from+1 {
		return nil, fmt.Errorf("ledger: range gap: want %d events, got %d", to-from+1, len(events))
	}
	leaves := make([][]byte, len(events))
	for i := range events {
		leaves[i] = events[i].RowHash
	}
	root := MerkleRoot(leaves)
	sig, err := signer.Sign(ctx, root)
	if err != nil {
		return nil, fmt.Errorf("ledger: sign checkpoint: %w", err)
	}
	c := &Checkpoint{
		FromSeq:      from,
		ToSeq:        to,
		MerkleRoot:   root,
		Signature:    sig,
		SignerCertSN: signer.SerialNumber(),
		SignedAt:     time.Now().UTC().Truncate(time.Microsecond),
	}
	if err := w.store.InsertCheckpoint(ctx, c); err != nil {
		return nil, fmt.Errorf("ledger: insert checkpoint: %w", err)
	}
	return c, nil
}

// Verify 는 [from, to] 구간 체인 무결성을 점검한다.
// 조작 지점 seq를 반환한다 (없으면 0) — T3의 구현체.
func (w *Writer) Verify(ctx context.Context, from, to int64) (badSeq int64, checked int, err error) {
	if from < 1 {
		from = 1
	}
	if to == 0 {
		tipSeq, _, err := w.store.Tip(ctx)
		if err != nil {
			return 0, 0, fmt.Errorf("ledger: read tip: %w", err)
		}
		to = tipSeq
	}
	if to < from {
		return 0, 0, nil
	}
	prev := GenesisPrevHash
	if from > 1 {
		before, err := w.store.EventsRange(ctx, from-1, from-1)
		if err != nil || len(before) != 1 {
			return 0, 0, fmt.Errorf("ledger: read anchor row %d: %w", from-1, err)
		}
		prev = before[0].RowHash
	}
	events, err := w.store.EventsRange(ctx, from, to)
	if err != nil {
		return 0, 0, fmt.Errorf("ledger: read range: %w", err)
	}
	return VerifyChain(events, prev), len(events), nil
}
