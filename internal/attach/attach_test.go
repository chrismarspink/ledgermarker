package attach

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestCatalogLoads(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.ByID("markdown") == nil || c.ByID("pe") == nil || c.ByID("nonfile") == nil {
		t.Fatal("catalog missing expected entries")
	}
	if c.ETag() == "" {
		t.Fatal("etag empty")
	}
}

// A6: id 중복 등록 → 기동 실패.
func TestA6_DuplicateIDFails(t *testing.T) {
	y := `
version: 1
formats:
  - {id: a, name: A, extensions: [".a"], method: sidecar, survivability: B, status: supported}
  - {id: a, name: A2, extensions: [".a2"], method: sidecar, survivability: B, status: supported}
`
	if _, err := ParseCatalog([]byte(y)); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("want duplicate id error, got %v", err)
	}
	// 확장자 중복도 실패
	y2 := `
version: 1
formats:
  - {id: a, name: A, extensions: [".x"], method: sidecar, survivability: B, status: supported}
  - {id: b, name: B, extensions: [".x"], method: sidecar, survivability: B, status: supported}
`
	if _, err := ParseCatalog([]byte(y2)); err == nil || !strings.Contains(err.Error(), "twice") {
		t.Fatalf("want duplicate extension error, got %v", err)
	}
}

// A7: method embedded/container인데 location 없음 → 기동 실패.
func TestA7_EmbeddedWithoutLocationFails(t *testing.T) {
	y := `
version: 1
formats:
  - {id: a, name: A, extensions: [".a"], method: embedded, survivability: A, status: planned}
`
	if _, err := ParseCatalog([]byte(y)); err == nil || !strings.Contains(err.Error(), "location") {
		t.Fatalf("want location error, got %v", err)
	}
}

// A1: 카탈로그에 없는 확장자 → 사이드카, formatId "unknown". nil 반환 금지.
func TestA1_UnknownFormatFallsBackToSidecar(t *testing.T) {
	a, res := Resolve("자료.xyz확장자", nil)
	if a == nil {
		t.Fatal("Resolve must never return nil attacher")
	}
	if res.Format.ID != "unknown" || res.Method != MethodSidecar {
		t.Fatalf("unknown format: %+v", res)
	}
}

// A2: status planned(구현 없음) 포맷 → 사이드카 폴백 + not_implemented.
func TestA2_PlannedFormatFallsBack(t *testing.T) {
	a, res := Resolve("보고서.hwp", nil)
	if res.Format.ID != "hwp" {
		t.Fatalf("want hwp, got %s", res.Format.ID)
	}
	if res.Method != MethodSidecar || res.FallbackReason != "not_implemented" {
		t.Fatalf("want sidecar/not_implemented, got %+v", res)
	}
	if _, ok := a.(*sidecarAttacher); !ok {
		t.Fatalf("want sidecarAttacher, got %T", a)
	}
	// 확장자 없이 매직넘버(CFB)로도 인식
	head, _ := hex.DecodeString("D0CF11E0A1B11AE1")
	_, res2 := Resolve("첨부파일", head)
	if res2.Format.ID != "hwp" && res2.Format.ID != "msg" {
		t.Fatalf("magic lookup failed: %+v", res2.Format)
	}
}

// A3: 내장 시도 실패 → 사이드카 폴백 + attach_failed. 실패로 처리하지 않는다.
func TestA3_AttachFailureFallsBack(t *testing.T) {
	a, res := Resolve("문서.md", nil)
	if res.Format.ID != "markdown" || res.Method != MethodEmbedded {
		t.Fatalf("resolve md: %+v", res)
	}
	// 이미 라벨이 내장된 파일에 재부착 → Attach 실패 시나리오
	labeled := "---\nlm_label: QUJD\n---\n본문\n"
	var dst bytes.Buffer
	err := a.Attach(strings.NewReader(labeled), &dst, []byte("DER"))
	if err == nil {
		t.Fatal("re-attach must fail")
	}
	fb, fbRes := FallbackToSidecar(res)
	if fbRes.Method != MethodSidecar || fbRes.FallbackReason != "attach_failed" {
		t.Fatalf("fallback: %+v", fbRes)
	}
	if fb.FormatID() != "markdown" {
		t.Fatalf("fallback keeps format id, got %s", fb.FormatID())
	}
}

// A4: md front matter 부착 후 — front matter 제외 본문 해시가 부착 전과 일치.
func TestA4_MarkdownAttachRoundTrip(t *testing.T) {
	a, _ := Resolve("문서.md", nil)
	original := []byte("# 제목\n\n본문 문단입니다.\n")
	der := bytes.Repeat([]byte{0x30, 0x82, 0x01}, 100)

	h1, err := a.HashTarget(bytes.NewReader(original), int64(len(original)))
	if err != nil {
		t.Fatal(err)
	}
	var labeled bytes.Buffer
	if err := a.Attach(bytes.NewReader(original), &labeled, der); err != nil {
		t.Fatal(err)
	}
	// 부착 후에도 해시 대상은 동일
	h2, err := a.HashTarget(bytes.NewReader(labeled.Bytes()), int64(labeled.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(h1, h2) {
		t.Fatal("hash target must exclude front matter label")
	}
	// 추출 라운드트립
	got, err := a.Extract(bytes.NewReader(labeled.Bytes()), int64(labeled.Len()))
	if err != nil || !bytes.Equal(got, der) {
		t.Fatalf("extract: %v", err)
	}
	// 기존 front matter가 있는 문서에도 삽입·보존
	withFM := []byte("---\ntitle: 보고서\n---\n본문\n")
	hf1, _ := a.HashTarget(bytes.NewReader(withFM), int64(len(withFM)))
	var labeled2 bytes.Buffer
	if err := a.Attach(bytes.NewReader(withFM), &labeled2, der); err != nil {
		t.Fatal(err)
	}
	hf2, _ := a.HashTarget(bytes.NewReader(labeled2.Bytes()), int64(labeled2.Len()))
	if !bytes.Equal(hf1, hf2) {
		t.Fatal("existing front matter must be preserved in hash target")
	}
	if !strings.Contains(labeled2.String(), "title: 보고서") {
		t.Fatal("existing front matter keys must survive")
	}
}

// A5: CRLF↔LF 변환 후에도 해시 일치 (정규화).
func TestA5_NormalizationSurvivesCRLF(t *testing.T) {
	a, _ := Resolve("문서.md", nil)
	lf := []byte("# 제목\n본문 줄1\n본문 줄2\n")
	crlf := bytes.ReplaceAll(lf, []byte("\n"), []byte("\r\n"))
	bom := append([]byte{0xEF, 0xBB, 0xBF}, lf...)

	h1, _ := a.HashTarget(bytes.NewReader(lf), int64(len(lf)))
	h2, _ := a.HashTarget(bytes.NewReader(crlf), int64(len(crlf)))
	h3, _ := a.HashTarget(bytes.NewReader(bom), int64(len(bom)))
	if !bytes.Equal(h1, h2) || !bytes.Equal(h1, h3) {
		t.Fatal("CRLF/BOM variants must hash identically")
	}
}

// 트레일러 attacher (pdf 등) 라운드트립 + 사이드카 attacher의 구버전
// 트레일러 호환.
func TestTrailerAttacherRoundTrip(t *testing.T) {
	a, res := Resolve("스캔본.pdf", nil)
	if res.Format.ID != "pdf" || res.Method != MethodEmbedded {
		t.Fatalf("resolve pdf: %+v", res)
	}
	original := []byte("%PDF-1.7 fake body")
	der := bytes.Repeat([]byte{0xAB}, 64)

	var labeled bytes.Buffer
	if err := a.Attach(bytes.NewReader(original), &labeled, der); err != nil {
		t.Fatal(err)
	}
	h, _ := a.HashTarget(bytes.NewReader(labeled.Bytes()), int64(labeled.Len()))
	want := sha256.Sum256(original)
	if !bytes.Equal(h, want[:]) {
		t.Fatal("trailer hash target must be original bytes")
	}
	got, err := a.Extract(bytes.NewReader(labeled.Bytes()), int64(labeled.Len()))
	if err != nil || !bytes.Equal(got, der) {
		t.Fatalf("extract: %v", err)
	}
	// 사이드카 attacher(예: txt)도 구버전 트레일러 내장 파일을 인식
	sc, _ := Resolve("메모.txt", nil)
	got2, err := sc.Extract(bytes.NewReader(labeled.Bytes()), int64(labeled.Len()))
	if err != nil || !bytes.Equal(got2, der) {
		t.Fatalf("sidecar attacher trailer compat: %v", err)
	}
}

// 실행 파일은 정책상 사이드카 고정 — Attach 거부 (§6-6).
func TestPESidecarOnly(t *testing.T) {
	a, res := Resolve("setup.exe", nil)
	if res.Format.ID != "pe" || res.Method != MethodSidecar {
		t.Fatalf("resolve exe: %+v", res)
	}
	if res.Format.Warning == "" {
		t.Fatal("pe must carry code-signing warning")
	}
	var dst bytes.Buffer
	if err := a.Attach(strings.NewReader("MZ..."), &dst, []byte("DER")); err != ErrSidecarOnly {
		t.Fatalf("want ErrSidecarOnly, got %v", err)
	}
}
