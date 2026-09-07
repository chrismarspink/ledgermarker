package attach

import (
	"crypto/sha256"
	"fmt"
	"io"
)

// SidecarExt 는 사이드카 파일 확장자다. ✎ 사내 확장자 정책 확인 (작업지시서 §7-4).
const SidecarExt = ".lmsig"

// sidecarAttacher 는 전 포맷 폴백이다 (작업지시서 §2.3-1).
// 파일 자체는 건드리지 않으므로 Attach는 정책상 거부하고(ErrSidecarOnly),
// 라벨은 별도 .lmsig 파일로 다뤄진다 — 호출자(CLI·웹)가 파일 옆에 쓴다.
//
// 과거에 트레일러로 내장된 파일과의 호환을 위해 HashTarget·Extract는
// 트레일러를 인식한다.
type sidecarAttacher struct {
	format Format
}

var _ Attacher = (*sidecarAttacher)(nil)

func (s *sidecarAttacher) FormatID() string { return s.format.ID }

func (s *sidecarAttacher) HashTarget(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	if orig, _, ok := SplitTrailer(data); ok {
		data = orig // 구버전 트레일러 내장 파일 호환
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

func (s *sidecarAttacher) Attach(_ io.Reader, _ io.Writer, _ []byte) error {
	return ErrSidecarOnly
}

func (s *sidecarAttacher) Extract(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	if _, der, ok := SplitTrailer(data); ok {
		return der, nil
	}
	return nil, ErrNoLabel
}
