package ledger

import (
	"bytes"
	"context"
	"encoding/hex"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestRowHashGolden 은 행 해시 직렬화 규칙을 잠근다 (DEV SPEC §3.3 —
// "구현 시 헬퍼 하나로 고정하고 테스트로 잠글 것").
// 이 테스트가 깨지면 기존 원장 전체의 체인 검증이 깨진다. 절대 기대값을
// 코드에 맞춰 고치지 말 것.
func TestRowHashGolden(t *testing.T) {
	docGUID := uuid.MustParse("3f2a0000-0000-4000-8000-000000000001")
	contentHash := bytes.Repeat([]byte{0x9c}, 32)
	parentHash := bytes.Repeat([]byte{0x1a}, 32)
	createdAt := time.Date(2026, 9, 6, 4, 11, 0, 123456000, time.UTC)

	got := RowHash(GenesisPrevHash, 1, EventIssue, docGUID, contentHash,
		"S", parentHash, "KPOST", "api:test", createdAt)

	const want = "20823adb304c30525b025f57423c3ab9cea8e6b7a626761d601468d072c9b9df"
	if hex.EncodeToString(got) != want {
		t.Fatalf("row hash serialization changed!\n got %s\nwant %s", hex.EncodeToString(got), want)
	}
}

func TestRowHashSensitivity(t *testing.T) {
	docGUID := uuid.New()
	ch := bytes.Repeat([]byte{1}, 32)
	at := time.Now().UTC().Truncate(time.Microsecond)
	base := RowHash(GenesisPrevHash, 1, EventIssue, docGUID, ch, "S", nil, "ORG", "a", at)

	if bytes.Equal(base, RowHash(GenesisPrevHash, 2, EventIssue, docGUID, ch, "S", nil, "ORG", "a", at)) {
		t.Error("seq change must change hash")
	}
	if bytes.Equal(base, RowHash(GenesisPrevHash, 1, EventIssue, docGUID, ch, "O", nil, "ORG", "a", at)) {
		t.Error("grade change must change hash")
	}
}

// TestVerifyChainDetectsTampering 은 강제 조작 지점의 seq를 정확히
// 지목하는지 확인한다 (T3의 코어 로직).
func TestVerifyChainDetectsTampering(t *testing.T) {
	events := buildChain(t, 10)
	if bad := VerifyChain(events, GenesisPrevHash); bad != 0 {
		t.Fatalf("clean chain reported bad seq %d", bad)
	}
	// seq 5의 grade를 조작
	events[4].Grade = "O"
	if bad := VerifyChain(events, GenesisPrevHash); bad != 5 {
		t.Fatalf("want bad seq 5, got %d", bad)
	}
}

func buildChain(t *testing.T, n int) []Event {
	t.Helper()
	var events []Event
	prev := GenesisPrevHash
	for i := 1; i <= n; i++ {
		e := Event{
			Seq:         int64(i),
			Type:        EventIssue,
			DocGUID:     uuid.New(),
			ContentHash: bytes.Repeat([]byte{byte(i)}, 32),
			Grade:       "S",
			IssuerOrg:   "ORG",
			Actor:       "test",
			PrevHash:    prev,
			CreatedAt:   time.Now().UTC().Truncate(time.Microsecond),
		}
		e.RowHash = EventRowHash(&e)
		prev = e.RowHash
		events = append(events, e)
	}
	return events
}

func TestMerkleRoot(t *testing.T) {
	a := MerkleRoot([][]byte{{1}, {2}, {3}})
	b := MerkleRoot([][]byte{{1}, {2}, {3}})
	if !bytes.Equal(a, b) {
		t.Error("merkle root must be deterministic")
	}
	c := MerkleRoot([][]byte{{1}, {2}, {4}})
	if bytes.Equal(a, c) {
		t.Error("different leaves must yield different root")
	}
}

// 단일 writer 직렬화 스모크 테스트: Append가 seq·체인을 이어가는지.
func TestWriterAppend(t *testing.T) {
	st := &fakeStore{}
	w := NewWriter(st)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		e := &Event{Type: EventIssue, DocGUID: uuid.New(),
			ContentHash: bytes.Repeat([]byte{byte(i)}, 32), Grade: "O",
			IssuerOrg: "ORG", Actor: "t"}
		if err := w.Append(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	if bad := VerifyChain(st.events, GenesisPrevHash); bad != 0 {
		t.Fatalf("writer produced broken chain at %d", bad)
	}
}

type fakeStore struct{ events []Event }

func (f *fakeStore) Tip(context.Context) (int64, []byte, error) {
	if len(f.events) == 0 {
		return 0, GenesisPrevHash, nil
	}
	last := f.events[len(f.events)-1]
	return last.Seq, last.RowHash, nil
}
func (f *fakeStore) InsertEvent(_ context.Context, e *Event) error {
	f.events = append(f.events, *e)
	return nil
}
func (f *fakeStore) EventsRange(_ context.Context, from, to int64) ([]Event, error) {
	var out []Event
	for _, e := range f.events {
		if e.Seq >= from && e.Seq <= to {
			out = append(out, e)
		}
	}
	return out, nil
}
func (f *fakeStore) InsertCheckpoint(context.Context, *Checkpoint) error   { return nil }
func (f *fakeStore) LatestCheckpoint(context.Context) (*Checkpoint, error) { return nil, nil }
