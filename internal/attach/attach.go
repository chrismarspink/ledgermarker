package attach

import (
	"errors"
	"io"
)

// ErrNoLabel: 부착된 라벨이 없다 (사이드카·원장 조회로 폴백).
var ErrNoLabel = errors.New("attach: no label found")

// ErrSidecarOnly: 이 포맷은 정책상 내장하지 않는다 (예: 코드 서명 실행 파일).
var ErrSidecarOnly = errors.New("attach: format is sidecar-only by policy")

// Attacher 는 포맷 1종(또는 1군)의 라벨 부착·추출을 담당한다 (작업지시서 §2.1).
type Attacher interface {
	// FormatID 는 formats.yaml 의 id 와 일치해야 한다.
	FormatID() string

	// HashTarget 은 "라벨을 제외한 본문"의 SHA-256 을 계산한다.
	// 순환 문제(라벨 안에 해시가 들어감)를 여기서 끊는다.
	HashTarget(r io.ReaderAt, size int64) ([]byte, error)

	// Attach 는 원본에 라벨을 부착해 dst 로 쓴다.
	Attach(src io.Reader, dst io.Writer, labelDER []byte) error

	// Extract 는 부착된 라벨을 꺼낸다. 없으면 ErrNoLabel.
	Extract(r io.ReaderAt, size int64) ([]byte, error)
}

// Resolution 은 Resolve 결과다. 폴백이 일어나면 원장 이벤트에
// Method·FallbackReason 을 함께 기록한다 (§2.2).
type Resolution struct {
	Format Format
	// Method 는 실제 적용될 부착 방식이다 (폴백 반영 후).
	Method Method
	// FallbackReason: "" | "not_implemented" | "attach_failed"
	FallbackReason string
}

// impls 는 formats.yaml id → 구현 매핑이다. 여기 없는 embedded/container
// 포맷은 사이드카로 폴백된다("not_implemented").
// Phase 1-b에서 zip/cfb/pdf(증분 갱신) Attacher가 추가된다 (§2.3).
func implFor(f Format) Attacher {
	switch f.ID {
	case "markdown":
		return &textAttacher{format: f}
	case "pdf", "jpeg", "png":
		return &trailerAttacher{format: f}
	}
	return nil
}

// Resolve 는 확장자·매직넘버로 Attacher를 고른다.
// 등록된 구현이 없으면 반드시 사이드카 Attacher를 반환한다 — nil을
// 반환하지 않는다 (§2.2 폴백 규칙).
func Resolve(filename string, head []byte) (Attacher, Resolution) {
	cat, err := Load()
	if err != nil {
		// 카탈로그 파손은 기동 시 걸러진다. 방어적으로 사이드카 폴백.
		return &sidecarAttacher{format: UnknownFormat},
			Resolution{Format: UnknownFormat, Method: MethodSidecar}
	}
	f, found := cat.Lookup(filename, head)
	if !found {
		// 폴백 규칙 1: 카탈로그에 없는 포맷 → 사이드카, id "unknown"
		return &sidecarAttacher{format: UnknownFormat},
			Resolution{Format: UnknownFormat, Method: MethodSidecar}
	}
	switch f.Method {
	case MethodSidecar, MethodLedgerOnly:
		return &sidecarAttacher{format: f}, Resolution{Format: f, Method: f.Method}
	}
	if a := implFor(f); a != nil {
		return a, Resolution{Format: f, Method: f.Method}
	}
	// 폴백 규칙 2: planned(구현 없음) → 사이드카 + not_implemented
	return &sidecarAttacher{format: f},
		Resolution{Format: f, Method: MethodSidecar, FallbackReason: "not_implemented"}
}

// FallbackToSidecar 는 내장 시도 실패 시의 폴백이다 (§2.2 규칙 3).
// 실패로 처리하지 않는다 — 발급은 사이드카로 계속된다.
func FallbackToSidecar(res Resolution) (Attacher, Resolution) {
	return &sidecarAttacher{format: res.Format}, Resolution{
		Format: res.Format, Method: MethodSidecar, FallbackReason: "attach_failed",
	}
}

func readAll(r io.ReaderAt, size int64) ([]byte, error) {
	buf := make([]byte, size)
	if size == 0 {
		return buf, nil
	}
	n, err := r.ReadAt(buf, 0)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return buf[:n], nil
}
