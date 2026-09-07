package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// 트레일러 내장 형식 라운드트립 — PWA(src/lib/embed.js)와 형식이 같아야 한다
// (docs/label-profile.md §5).
func TestTrailerRoundTrip(t *testing.T) {
	orig := []byte("원본 문서 내용")
	der := bytes.Repeat([]byte{0x30, 0x82}, 200)

	path := filepath.Join(t.TempDir(), "doc.txt")
	if err := os.WriteFile(path, orig, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := appendTrailer(path, der); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	gotOrig, gotDER, ok := splitEmbedded(data)
	if !ok {
		t.Fatal("trailer not detected")
	}
	if !bytes.Equal(gotOrig, orig) || !bytes.Equal(gotDER, der) {
		t.Fatal("round trip mismatch")
	}
	// 트레일러 없는 파일은 오탐하지 않는다
	if _, _, ok := splitEmbedded(orig); ok {
		t.Fatal("false positive on plain file")
	}
	// 매직만 있고 길이가 깨진 경우
	bad := append([]byte("xx"), []byte("\x00\x00\x00\x00\x00\x00\xff\xffLMLABEL1")...)
	if _, _, ok := splitEmbedded(bad); ok {
		t.Fatal("false positive on corrupt trailer")
	}
}
