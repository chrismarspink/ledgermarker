package attach

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
)

// zipAttacher 는 ZIP 계열 컨테이너(OOXML·HWPX·ODF·ZIP·JAR)의 내장이다.
//
// 방식: ZIP 아카이브 코멘트(EOCD comment)에 "LMLABEL1:<base64 DER>"를 넣는다.
//   - 모든 ZIP 리더(Office·한컴·압축 툴)가 아카이브 코멘트를 무시하므로
//     파일이 깨지지 않는다. customXml 파트 삽입은 [Content_Types].xml
//     불일치 시 Office가 손상 파일로 판정할 위험이 있어 Phase 2 실측 후.
//   - 재저장 시 앱이 ZIP을 재조립하며 코멘트가 소실될 수 있다(카탈로그 notes).
//
// 해시 대상: LM 코멘트를 제거(코멘트 길이 0으로 복원)한 바이트 전체.
type zipAttacher struct {
	format Format
}

var _ Attacher = (*zipAttacher)(nil)

const zipCommentPrefix = "LMLABEL1:"

// findEOCD 는 End of Central Directory 레코드 오프셋과 기존 코멘트를 찾는다.
func findEOCD(data []byte) (off int, comment []byte, ok bool) {
	const sigLen = 22 // EOCD 고정부 길이
	if len(data) < sigLen {
		return 0, nil, false
	}
	min := len(data) - sigLen - 65535
	if min < 0 {
		min = 0
	}
	for i := len(data) - sigLen; i >= min; i-- {
		if data[i] == 0x50 && data[i+1] == 0x4b && data[i+2] == 0x05 && data[i+3] == 0x06 {
			cl := int(binary.LittleEndian.Uint16(data[i+20 : i+22]))
			if i+sigLen+cl == len(data) {
				return i, data[i+sigLen:], true
			}
		}
	}
	return 0, nil, false
}

// SplitZipComment 는 LM 코멘트가 있으면 (제거된 원본, DER, true)를 반환한다.
func SplitZipComment(data []byte) (orig, der []byte, ok bool) {
	off, comment, found := findEOCD(data)
	if !found || !strings.HasPrefix(string(comment), zipCommentPrefix) {
		return nil, nil, false
	}
	d, err := base64.StdEncoding.DecodeString(string(comment[len(zipCommentPrefix):]))
	if err != nil {
		return nil, nil, false
	}
	out := make([]byte, off+22)
	copy(out, data[:off+22])
	binary.LittleEndian.PutUint16(out[off+20:off+22], 0) // 코멘트 길이 0 복원
	return out, d, true
}

func (z *zipAttacher) FormatID() string { return z.format.ID }

func (z *zipAttacher) HashTarget(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	if orig, _, ok := SplitZipComment(data); ok {
		data = orig
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

func (z *zipAttacher) Attach(src io.Reader, dst io.Writer, labelDER []byte) error {
	data, err := io.ReadAll(src)
	if err != nil {
		return fmt.Errorf("attach: read src: %w", err)
	}
	off, comment, found := findEOCD(data)
	if !found {
		return fmt.Errorf("attach: ZIP EOCD not found (손상되었거나 ZIP이 아님)")
	}
	if strings.HasPrefix(string(comment), zipCommentPrefix) {
		return fmt.Errorf("attach: label already embedded (재발급은 라벨 제거본에)")
	}
	if len(comment) > 0 {
		// 기존 코멘트를 덮어쓰면 원본 정보가 소실된다 → 폴백 대상
		return fmt.Errorf("attach: ZIP archive comment already in use")
	}
	c := zipCommentPrefix + base64.StdEncoding.EncodeToString(labelDER)
	if len(c) > 65535 {
		return fmt.Errorf("attach: label too large for ZIP comment (%d bytes)", len(c))
	}
	out := make([]byte, off+22)
	copy(out, data[:off+22])
	binary.LittleEndian.PutUint16(out[off+20:off+22], uint16(len(c)))
	if _, err := dst.Write(out); err != nil {
		return err
	}
	_, err = io.WriteString(dst, c)
	return err
}

func (z *zipAttacher) Extract(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	if _, der, ok := SplitZipComment(data); ok {
		return der, nil
	}
	return nil, ErrNoLabel
}
