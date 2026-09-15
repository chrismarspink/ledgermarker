package fingerprint

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

const sampleKo = `제1조(목적) 이 규정은 우정사업본부의 문서 등급 표시와 검증 체계의
운영에 필요한 사항을 정함을 목적으로 한다.
제2조(정의) 이 규정에서 사용하는 용어의 뜻은 다음과 같다.
1. "라벨"이란 문서에 부여된 서명된 등급 표시를 말한다.
2. "원장"이란 발급 사실이 기록되는 추가 전용 장부를 말한다.
제3조(발급) 문서를 생산한 부서의 장은 지체 없이 라벨 발급을 요청하여야 한다.
제4조(검증) 게이트 운영 부서는 문서 반출 전 라벨을 검증하여야 한다.
제5조(폐기) 라벨의 폐기는 원장에 이벤트로 기록하며 삭제하지 아니한다.`

// 동일 문서 → 유사도 1.0, 일부 수정 → 높은 유사도, 무관 문서 → 낮음.
func TestSimilarityBehavior(t *testing.T) {
	sigA := FromText(sampleKo)
	if sim := Similarity(sigA, FromText(sampleKo)); sim != 1.0 {
		t.Fatalf("identical text must be 1.0, got %.2f", sim)
	}
	// 일부 수정: 한 조문 교체 (약 15% 변경)
	modified := strings.Replace(sampleKo,
		"제3조(발급) 문서를 생산한 부서의 장은 지체 없이 라벨 발급을 요청하여야 한다.",
		"제3조(발급 절차) 문서 생산 부서의 장은 3일 이내에 라벨 발급을 신청한다.", 1)
	simMod := Similarity(sigA, FromText(modified))
	if simMod < 0.5 {
		t.Fatalf("modified doc similarity too low: %.2f", simMod)
	}
	// 서식 변경(줄바꿈·공백·대소문자)은 유사도에 영향 없어야 한다 (정규화)
	reflowed := strings.ReplaceAll(sampleKo, "\n", " ")
	if sim := Similarity(sigA, FromText(reflowed)); sim < 0.98 {
		t.Fatalf("reflowed text must be ~1.0, got %.2f", sim)
	}
	// 무관한 문서
	other := `오늘 점심 메뉴는 김치찌개였다. 내일은 비가 온다고 한다.
주말에는 등산을 갈 예정이며 준비물은 물과 간식이다.`
	if sim := Similarity(sigA, FromText(other)); sim > 0.2 {
		t.Fatalf("unrelated doc similarity too high: %.2f", sim)
	}
	t.Logf("수정본 유사도=%.2f (기준 ≥0.5)", simMod)
}

// 수정본은 LSH 버킷을 최소 1개 공유해야 후보로 잡힌다.
func TestLSHBucketsCatchModified(t *testing.T) {
	a := Buckets(FromText(sampleKo))
	modified := strings.Replace(sampleKo, "우정사업본부", "우정사업본부와 소속 기관", 1)
	b := Buckets(FromText(modified))
	set := map[string]bool{}
	for _, x := range a {
		set[x] = true
	}
	shared := 0
	for _, x := range b {
		if set[x] {
			shared++
		}
	}
	if shared == 0 {
		t.Fatal("modified doc must share at least one LSH bucket")
	}
	t.Logf("공유 버킷 %d/16", shared)
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	sig := FromText(sampleKo)
	got, err := Decode(Encode(sig))
	if err != nil {
		t.Fatal(err)
	}
	if Similarity(sig, got) != 1.0 {
		t.Fatal("encode/decode round trip mismatch")
	}
}

// DOCX(ZIP XML) 텍스트 추출 — 같은 본문의 txt와 지문이 거의 일치해야
// "형식 변환 파생관계 식별"이 성립한다.
func TestExtractDocxMatchesText(t *testing.T) {
	var raw bytes.Buffer
	zw := zip.NewWriter(&raw)
	f, _ := zw.Create("word/document.xml")
	// 문단마다 태그로 감싼 OOXML 흉내
	var body strings.Builder
	body.WriteString(`<w:document><w:body>`)
	for _, line := range strings.Split(sampleKo, "\n") {
		body.WriteString(`<w:p><w:r><w:t>` + line + `</w:t></w:r></w:p>`)
	}
	body.WriteString(`</w:body></w:document>`)
	f.Write([]byte(body.String()))
	zw.Close()

	docxText, ok := ExtractText("규정.docx", raw.Bytes())
	if !ok {
		t.Fatal("docx extraction failed")
	}
	sim := Similarity(FromText(sampleKo), FromText(docxText))
	if sim < 0.9 {
		t.Fatalf("docx→text similarity too low: %.2f", sim)
	}
	t.Logf("docx↔txt 유사도=%.2f", sim)
}

// 라벨이 부착된 파일의 지문 = 원본 지문 (라벨은 추출 전 제거).
func TestExtractIgnoresLabel(t *testing.T) {
	withLabel := "---\nlm_label: QUJDREVG\n---\n" + sampleKo
	a, _ := ExtractText("문서.md", []byte(sampleKo))
	b, _ := ExtractText("문서.md", []byte(withLabel))
	if Similarity(FromText(a), FromText(b)) < 0.99 {
		t.Fatal("label must not affect fingerprint")
	}
}
