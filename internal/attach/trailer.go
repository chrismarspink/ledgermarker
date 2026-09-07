package attach

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
)

// 라벨 트레일러 형식 (docs/label-profile.md §5):
//
//	[원본 바이트][CMS DER][DER 길이 uint64 BE 8바이트][매직 "LMLABEL1" 8바이트]
//
// contentHash는 항상 원본 바이트 기준이다. 꼬리 데이터를 무시하는
// 포맷(PDF·JPEG·PNG 등)에만 쓴다 — 어떤 포맷에 쓸지는 formats.yaml이 정한다.
const TrailerMagic = "LMLABEL1"

// SplitTrailer 는 트레일러가 있으면 (원본, DER, true)를 반환한다.
func SplitTrailer(data []byte) (orig, der []byte, ok bool) {
	n := len(data)
	if n < 20 || string(data[n-8:]) != TrailerMagic {
		return nil, nil, false
	}
	derLen := binary.BigEndian.Uint64(data[n-16 : n-8])
	if derLen == 0 || derLen > uint64(n-16) {
		return nil, nil, false
	}
	cut := n - 16 - int(derLen)
	return data[:cut], data[cut : n-16], true
}

// AppendTrailer 는 트레일러 바이트(DER+길이+매직)를 만들어 반환한다.
func AppendTrailer(der []byte) []byte {
	out := make([]byte, 0, len(der)+16)
	out = append(out, der...)
	lenBuf := make([]byte, 8)
	binary.BigEndian.PutUint64(lenBuf, uint64(len(der)))
	out = append(out, lenBuf...)
	return append(out, []byte(TrailerMagic)...)
}

// trailerAttacher 는 파일 끝 트레일러 방식의 내장이다.
type trailerAttacher struct {
	format Format
}

var _ Attacher = (*trailerAttacher)(nil)

func (t *trailerAttacher) FormatID() string { return t.format.ID }

func (t *trailerAttacher) HashTarget(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	if orig, _, ok := SplitTrailer(data); ok {
		data = orig
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

func (t *trailerAttacher) Attach(src io.Reader, dst io.Writer, labelDER []byte) error {
	data, err := io.ReadAll(src)
	if err != nil {
		return fmt.Errorf("attach: read src: %w", err)
	}
	if _, _, ok := SplitTrailer(data); ok {
		return fmt.Errorf("attach: label already embedded (재발급은 라벨 제거본에)")
	}
	if _, err := dst.Write(data); err != nil {
		return err
	}
	_, err = dst.Write(AppendTrailer(labelDER))
	return err
}

func (t *trailerAttacher) Extract(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	if _, der, ok := SplitTrailer(data); ok {
		return der, nil
	}
	return nil, ErrNoLabel
}
