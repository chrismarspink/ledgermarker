package fingerprint

import (
	"archive/zip"
	"bytes"
	"regexp"
	"strings"

	pdflib "github.com/ledongthuc/pdf"

	"github.com/chrismarspink/ledgermarker/internal/attach"
)

// ExtractText 는 지문 계산용 텍스트를 추출한다. 지원하지 않는 형식이면
// ("", false). 라벨(트레일러·ZIP 코멘트·front matter lm_* 줄)은 추출 전에
// 제거한다 — 라벨 유무가 유사도를 흐리면 안 된다.
//
// 지원: txt·log·csv·md(그대로), docx·pptx·xlsx·hwpx·odt(ZIP 내 XML 태그
// 제거), pdf(텍스트 레이어). 이미지·스캔 PDF의 OCR은 범위 밖 — 한계로 명시.
func ExtractText(filename string, data []byte) (string, bool) {
	// 부착 라벨 제거
	if orig, _, ok := attach.SplitTrailer(data); ok {
		data = orig
	}
	if orig, _, ok := attach.SplitZipComment(data); ok {
		data = orig
	}

	name := strings.ToLower(filename)
	ext := ""
	if i := strings.LastIndex(name, "."); i >= 0 {
		ext = name[i:]
	}
	switch ext {
	case ".txt", ".log", ".csv", ".md", ".markdown":
		return stripLMLines(string(data)), true
	case ".docx", ".pptx", ".xlsx", ".hwpx", ".odt", ".ods", ".odp":
		return zipXMLText(data)
	case ".pdf":
		return pdfText(data)
	}
	return "", false
}

// stripLMLines 는 md front matter의 lm_* 줄과 구획선('---')을 제거한다 —
// 라벨 부착 여부가 지문에 영향을 주면 안 된다. 구획선은 라벨 유무와
// 무관하게 항상 제거되므로 비교의 양쪽에서 동일하게 사라진다.
func stripLMLines(s string) string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "lm_") || t == "---" {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

var xmlTag = regexp.MustCompile(`<[^>]*>`)

// zipXMLText 는 ZIP 컨테이너 문서의 XML 파트에서 텍스트를 추출한다.
func zipXMLText(data []byte) (string, bool) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", false
	}
	var sb strings.Builder
	for _, f := range zr.File {
		n := strings.ToLower(f.Name)
		if !strings.HasSuffix(n, ".xml") {
			continue
		}
		// 본문 파트만: OOXML(word/·ppt/·xl/), ODF(content.xml), HWPX(contents/)
		if !(strings.HasPrefix(n, "word/") || strings.HasPrefix(n, "ppt/slides/") ||
			strings.HasPrefix(n, "xl/") || n == "content.xml" ||
			strings.HasPrefix(n, "contents/")) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b := new(bytes.Buffer)
		_, _ = b.ReadFrom(rc)
		rc.Close()
		// 블록 경계를 공백으로 — 태그 제거 시 단어가 붙지 않게
		s := strings.ReplaceAll(b.String(), "><", "> <")
		sb.WriteString(xmlTag.ReplaceAllString(s, ""))
		sb.WriteString(" ")
	}
	text := sb.String()
	if strings.TrimSpace(text) == "" {
		return "", false
	}
	return text, true
}

// pdfText 는 PDF 텍스트 레이어를 추출한다 (스캔 PDF는 불가 — OCR 범위 밖).
func pdfText(data []byte) (text string, ok bool) {
	defer func() {
		if recover() != nil { // 라이브러리가 비정형 PDF에서 panic할 수 있다
			text, ok = "", false
		}
	}()
	r, err := pdflib.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", false
	}
	rd, err := r.GetPlainText()
	if err != nil {
		return "", false
	}
	b := new(bytes.Buffer)
	if _, err := b.ReadFrom(rd); err != nil {
		return "", false
	}
	if strings.TrimSpace(b.String()) == "" {
		return "", false
	}
	return b.String(), true
}
