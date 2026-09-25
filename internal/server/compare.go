package server

import (
	"fmt"
	"net/http"

	"github.com/innotium/ledgermarker/internal/fingerprint"
)

// handleCompare 는 두 본문 텍스트의 유사도를 계산한다 (POST /v1/compare).
// 웹 '유사도 테스트' 메뉴의 서버 측 — 파일 전체 해시는 브라우저가 계산하고,
// MinHash(자카드 추정)와 docsim 의미 유사도만 서버가 맡는다. 발급 경로와 같은
// fingerprint 구현을 쓰므로 원장 지문과 동일한 기준의 값이 나온다.
// 원문은 저장하지 않고 지문 계산에만 쓴다.
func (s *Server) handleCompare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TextA string `json:"textA"`
		TextB string `json:"textB"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.TextA == "" || req.TextB == "" {
		writeErr(w, http.StatusBadRequest, "textA and textB are required")
		return
	}
	// 슁글 집합 자체(정확 자카드·벤 다이어그램용)와 MinHash 시그니처(해시 배열
	// 시각화용)를 함께 돌려준다. 시그니처는 단방향 요약이라 본문을 드러내지 않는다.
	shA := fingerprint.Shingles(fingerprint.NormalizeForFP(req.TextA))
	shB := fingerprint.Shingles(fingerprint.NormalizeForFP(req.TextB))
	common := 0
	for k := range shA {
		if _, ok := shB[k]; ok {
			common++
		}
	}
	union := len(shA) + len(shB) - common
	exact := 0.0
	if union > 0 {
		exact = float64(common) / float64(union)
	}
	sigA, sigB := fingerprint.MinHash(shA), fingerprint.MinHash(shB)
	matches := make([]bool, fingerprint.SigSize)
	hexA, hexB := make([]string, fingerprint.SigSize), make([]string, fingerprint.SigSize)
	for i := range sigA {
		matches[i] = sigA[i] == sigB[i]
		hexA[i] = fmt.Sprintf("%016x", sigA[i])
		hexB[i] = fmt.Sprintf("%016x", sigB[i])
	}
	resp := map[string]interface{}{
		"minhash": map[string]interface{}{
			"similarity": fingerprint.Similarity(sigA, sigB), "sigSize": fingerprint.SigSize,
			"matches": matches, "sigA": hexA, "sigB": hexB,
		},
		"shingles":         map[string]interface{}{"a": len(shA), "b": len(shB), "common": common, "jaccard": exact},
		"docsimConfigured": s.cfg.DocsimBin != "",
	}
	if s.cfg.DocsimBin != "" {
		v, err := docsimCompareTexts(s.cfg.DocsimBin, s.cfg.DocsimDir, req.TextA, req.TextB)
		if err != nil {
			s.log.Warn("docsim compare failed", "err", err)
			resp["docsimError"] = err.Error()
		} else {
			resp["docsim"] = v
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// docsimCompareTexts 는 두 텍스트의 docsim 지문을 만들어 정밀 비교한다.
func docsimCompareTexts(bin, dir, a, b string) (*deepVerdict, error) {
	fa, err := docsimFingerprintText(bin, dir, a)
	if err != nil {
		return nil, err
	}
	fb, err := docsimFingerprintText(bin, dir, b)
	if err != nil {
		return nil, err
	}
	return docsimCompareFP(bin, dir, fa, fb)
}
