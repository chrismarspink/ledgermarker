package fingerprint

import (
	"fmt"
	"os"
	"testing"
)

// 진단용: LM_DUMP_FILES에 나열된 파일의 정규화 추출 텍스트를 출력한다.
// (go test -run TestDumpExtract -v 로만 실행 — 평시에는 skip)
func TestDumpExtract(t *testing.T) {
	files := os.Getenv("LM_DUMP_FILES")
	if files == "" {
		t.Skip("LM_DUMP_FILES not set")
	}
	for _, p := range splitList(files) {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		text, ok := ExtractText(p, data)
		norm := NormalizeForFP(text)
		fmt.Printf("── %s (ok=%v, %d자)\n%s\n\n", p, ok, len([]rune(norm)), norm)
	}
}

func splitList(s string) []string {
	var out []string
	cur := ""
	for _, r := range s {
		if r == ':' {
			out = append(out, cur)
			cur = ""
		} else {
			cur += string(r)
		}
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
