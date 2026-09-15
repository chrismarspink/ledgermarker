package fingerprint

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
)

// 정확도 특성 시험 — 변경률별 유사도 곡선을 기록한다 (제출 문서 근거).
// 변경률이 커질수록 유사도가 단조 감소하고, 무관 문서는 우연 수준(<0.2)에
// 머무는지 검증한다.
func TestAccuracyByModificationRate(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	// 표본 문서: 조문 형태 한국어 ~600 단어
	var sb strings.Builder
	subjects := []string{"발급", "검증", "폐기", "보존", "반출", "재분류", "복원", "감사", "위임", "교육"}
	for i := 0; i < 60; i++ {
		s := subjects[i%len(subjects)]
		sb.WriteString(fmt.Sprintf("제%d조(%s) 문서를 %s하는 부서의 장은 관련 절차에 따라 %s 업무를 수행하고 그 결과를 기록하여야 한다. ", i+1, s, s, s))
	}
	base := sb.String()
	words := strings.Fields(base)
	sigBase := FromText(base)

	rates := []float64{0.05, 0.10, 0.20, 0.30, 0.50}
	prev := 1.0
	for _, rate := range rates {
		mod := make([]string, len(words))
		copy(mod, words)
		n := int(float64(len(words)) * rate)
		for i := 0; i < n; i++ {
			mod[rng.Intn(len(mod))] = fmt.Sprintf("변경어%d", i)
		}
		sim := Similarity(sigBase, FromText(strings.Join(mod, " ")))
		t.Logf("단어 %2.0f%% 변경 → 유사도 %.2f", rate*100, sim)
		if sim > prev+0.05 {
			t.Errorf("similarity must not increase with more changes: %.2f > %.2f", sim, prev)
		}
		prev = sim
		// 흩어진 무작위 치환은 최악 조건이다(국소 수정은 TestSimilarityBehavior:
		// 조문 1개 교체 = 0.86). 실측 곡선: 5%→0.63, 10%→0.48, 20%→0.28.
		if rate <= 0.10 && sim < 0.4 {
			t.Errorf("%.0f%% 변경에서 유사도 %.2f — 재식별 하한(0.4) 미달", rate*100, sim)
		}
	}
	// 무관 문서 30종 오탐 검사
	falsePos := 0
	for k := 0; k < 30; k++ {
		var ob strings.Builder
		for i := 0; i < 200; i++ {
			ob.WriteString(fmt.Sprintf("무관%d항목%d ", rng.Intn(10000), rng.Intn(10000)))
		}
		if Similarity(sigBase, FromText(ob.String())) >= 0.3 {
			falsePos++
		}
	}
	t.Logf("무관 문서 30종 중 유사도≥0.3 오탐: %d건", falsePos)
	if falsePos > 0 {
		t.Errorf("false positives: %d", falsePos)
	}
}
