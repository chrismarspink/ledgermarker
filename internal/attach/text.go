package attach

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
)

// textAttacher 는 마크다운 계열의 front matter 내장이다 (작업지시서 §2.3-2).
//
// 부착 형식 — 문서 머리의 YAML front matter에 lm_* 키:
//
//	---
//	lm_label: <base64 CMS DER>
//	---
//	본문...
//
// 기존 front matter가 있으면 여는 '---' 바로 다음에 lm_label 줄을 삽입한다.
// HashTarget 은 lm_* 키를 제거한 본문을 정규화(NormalizeText)해 해시한다 —
// 라벨 안에 해시가 들어가는 순환을 여기서 끊는다.
type textAttacher struct {
	format Format
}

var _ Attacher = (*textAttacher)(nil)

const lmLabelKey = "lm_label:"

func (t *textAttacher) FormatID() string { return t.format.ID }

// stripLM 은 선두 front matter에서 lm_* 줄을 제거한 본문과, 발견된
// lm_label 값(base64)을 반환한다. lm_* 제거 후 front matter가 비면
// 구획 자체를 제거한다.
func stripLM(data []byte) (body []byte, labelB64 string) {
	s := string(data)
	// 정규화 전 단계이므로 CRLF 허용
	norm := strings.ReplaceAll(s, "\r\n", "\n")
	if !strings.HasPrefix(norm, "---\n") {
		return data, ""
	}
	rest := norm[4:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return data, ""
	}
	fm := rest[:end]
	after := rest[end+len("\n---"):]
	after = strings.TrimPrefix(after, "\n")

	var kept []string
	for _, line := range strings.Split(fm, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "lm_") {
			if strings.HasPrefix(trimmed, lmLabelKey) {
				labelB64 = strings.TrimSpace(trimmed[len(lmLabelKey):])
			}
			continue
		}
		kept = append(kept, line)
	}
	if len(kept) == 0 || (len(kept) == 1 && strings.TrimSpace(kept[0]) == "") {
		return []byte(after), labelB64 // front matter가 비면 구획 제거
	}
	return []byte("---\n" + strings.Join(kept, "\n") + "\n---\n" + after), labelB64
}

func (t *textAttacher) HashTarget(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	// 구버전 트레일러 내장 파일 호환: 트레일러를 먼저 뗀다
	if orig, _, ok := SplitTrailer(data); ok {
		data = orig
	}
	body, _ := stripLM(data)
	sum := sha256.Sum256(NormalizeText(body))
	return sum[:], nil
}

func (t *textAttacher) Attach(src io.Reader, dst io.Writer, labelDER []byte) error {
	data, err := io.ReadAll(src)
	if err != nil {
		return fmt.Errorf("attach: read src: %w", err)
	}
	if _, existing := stripLM(data); existing != "" {
		return fmt.Errorf("attach: label already embedded (재발급은 라벨 제거본에)")
	}
	b64 := base64.StdEncoding.EncodeToString(labelDER)
	s := strings.ReplaceAll(string(data), "\r\n", "\n")
	var out string
	if strings.HasPrefix(s, "---\n") {
		// 기존 front matter의 여는 구획 바로 뒤에 삽입
		out = "---\n" + lmLabelKey + " " + b64 + "\n" + s[4:]
	} else {
		out = "---\n" + lmLabelKey + " " + b64 + "\n---\n" + s
	}
	_, err = io.WriteString(dst, out)
	return err
}

func (t *textAttacher) Extract(r io.ReaderAt, size int64) ([]byte, error) {
	data, err := readAll(r, size)
	if err != nil {
		return nil, fmt.Errorf("attach: read: %w", err)
	}
	// 구버전 트레일러 내장 파일 호환
	if _, der, ok := SplitTrailer(data); ok {
		return der, nil
	}
	_, b64 := stripLM(data)
	if b64 == "" {
		return nil, ErrNoLabel
	}
	der, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("attach: lm_label decode: %w", err)
	}
	return der, nil
}
