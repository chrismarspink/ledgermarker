package fingerprint

import (
	"strings"
	"testing"
)

// 지문 계산·비교의 시간 비용 — 발표자료 성능 항목의 근거. 본문 약 5KB(한글 규정문 반복).
func benchText() string {
	base := "제1조(목적) 이 규정은 우정사업본부의 문서 등급 표시와 검증 체계의 운영에 필요한 사항을 정함을 목적으로 한다. 제2조(정의) 라벨이란 문서에 부여된 서명된 등급 표시를 말한다. "
	return strings.Repeat(base, 40)
}

func BenchmarkFromText(b *testing.B) {
	t := benchText()
	b.SetBytes(int64(len(t)))
	for i := 0; i < b.N; i++ {
		FromText(t)
	}
}

func BenchmarkBuckets(b *testing.B) {
	sig := FromText(benchText())
	for i := 0; i < b.N; i++ {
		Buckets(sig)
	}
}

func BenchmarkSimilarity(b *testing.B) {
	a := FromText(benchText())
	c := FromText(benchText() + " 제3조 추가")
	for i := 0; i < b.N; i++ {
		Similarity(a, c)
	}
}
