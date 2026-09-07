package store

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/ledger"
)

// ErrUnavailable 은 원장 접속 불가를 흉내낼 때 반환된다 (T6 테스트용).
var ErrUnavailable = errors.New("store: ledger unavailable")

// Memory 는 테스트·데모용 인메모리 저장소다. append-only 규칙을
// 코드로 흉내낸다(수정 API 자체가 없다).
type Memory struct {
	mu          sync.RWMutex
	events      []ledger.Event
	checkpoints []ledger.Checkpoint
	idem        map[string][]byte
	anchors     []TrustAnchor

	// Unavailable 이 true면 원장 조회가 에러를 반환한다 —
	// "unavailable"(접속 불가)과 "unregistered"(없음)의 구분 테스트용.
	Unavailable bool
}

var _ Store = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{idem: map[string][]byte{}}
}

func (m *Memory) Tip(_ context.Context) (int64, []byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.Unavailable {
		return 0, nil, ErrUnavailable
	}
	if len(m.events) == 0 {
		return 0, ledger.GenesisPrevHash, nil
	}
	last := m.events[len(m.events)-1]
	return last.Seq, last.RowHash, nil
}

func (m *Memory) InsertEvent(_ context.Context, e *ledger.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Unavailable {
		return ErrUnavailable
	}
	m.events = append(m.events, *e)
	return nil
}

func (m *Memory) EventsRange(_ context.Context, from, to int64) ([]ledger.Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.Unavailable {
		return nil, ErrUnavailable
	}
	var out []ledger.Event
	for _, e := range m.events {
		if e.Seq >= from && e.Seq <= to {
			out = append(out, e)
		}
	}
	return out, nil
}

// CorruptRow 는 T3 테스트용: 슈퍼유저의 강제 조작을 흉내낸다.
func (m *Memory) CorruptRow(seq int64, mutate func(*ledger.Event)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.events {
		if m.events[i].Seq == seq {
			mutate(&m.events[i])
			return
		}
	}
}

func (m *Memory) InsertCheckpoint(_ context.Context, c *ledger.Checkpoint) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c.ID = int64(len(m.checkpoints) + 1)
	m.checkpoints = append(m.checkpoints, *c)
	return nil
}

func (m *Memory) LatestCheckpoint(_ context.Context) (*ledger.Checkpoint, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.checkpoints) == 0 {
		return nil, nil
	}
	c := m.checkpoints[len(m.checkpoints)-1]
	return &c, nil
}

func (m *Memory) EventsByContentHash(_ context.Context, hash []byte) ([]ledger.Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.Unavailable {
		return nil, ErrUnavailable
	}
	var out []ledger.Event
	for _, e := range m.events {
		if bytes.Equal(e.ContentHash, hash) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (m *Memory) LatestByDoc(_ context.Context, docGUID uuid.UUID) (*ledger.Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.Unavailable {
		return nil, ErrUnavailable
	}
	for i := len(m.events) - 1; i >= 0; i-- {
		if m.events[i].DocGUID == docGUID {
			e := m.events[i]
			return &e, nil
		}
	}
	return nil, nil
}

func (m *Memory) ChildrenOf(_ context.Context, contentHash []byte) ([]ledger.Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.Unavailable {
		return nil, ErrUnavailable
	}
	var out []ledger.Event
	for _, e := range m.events {
		if bytes.Equal(e.ParentHash, contentHash) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (m *Memory) GetIdempotent(_ context.Context, key string) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.idem[key], nil
}

func (m *Memory) PutIdempotent(_ context.Context, key string, response []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.idem[key] = response
	return nil
}

func (m *Memory) TrustAnchors(_ context.Context) ([]TrustAnchor, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]TrustAnchor{}, m.anchors...), nil
}

func (m *Memory) AddTrustAnchor(_ context.Context, ta *TrustAnchor) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ta.ID = int64(len(m.anchors) + 1)
	ta.AddedAt = time.Now().UTC()
	m.anchors = append(m.anchors, *ta)
	return nil
}

func (m *Memory) EventCounts(_ context.Context) (map[string]int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string]int64{}
	for _, e := range m.events {
		out[string(e.Type)]++
	}
	return out, nil
}

func (m *Memory) Close() {}
