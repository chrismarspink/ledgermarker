package attach

import (
	"bytes"
	"testing"
)

// 골든 테스트 — 정규화 규칙을 잠근다 (작업지시서 §2.4).
// 이 테스트가 깨지면 기존 발급 문서의 해시가 깨진다. 기대값을 코드에
// 맞춰 고치지 말 것. JS 미러(verify-pwa/src/lib/attach.js)와 함께 갱신.
func TestNormalizeGolden(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want []byte
	}{
		{
			name: "BOM 제거 + CRLF→LF + 끝 개행 1개",
			in:   []byte("\xEF\xBB\xBF줄1\r\n줄2\r\n\r\n"),
			want: []byte("줄1\n줄2\n"),
		},
		{
			name: "후행 공백은 유지",
			in:   []byte("줄1  \n줄2\t\n"),
			want: []byte("줄1  \n줄2\t\n"),
		},
		{
			name: "끝 개행 없음 → 1개 추가",
			in:   []byte("한 줄"),
			want: []byte("한 줄\n"),
		},
		{
			name: "NFD 한글 → NFC",
			in:   []byte("\u1112\u1161\u11AB\u1100\u1173\u11AF\n"), // 한글 (조합형)
			want: []byte("한글\n"),
		},
		{
			name: "외따로 남은 CR도 LF로",
			in:   []byte("줄1\r줄2\n"),
			want: []byte("줄1\n줄2\n"),
		},
	}
	for _, c := range cases {
		if got := NormalizeText(c.in); !bytes.Equal(got, c.want) {
			t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}
