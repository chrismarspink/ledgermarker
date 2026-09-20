package server

import (
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"sort"

	"github.com/innotium/ledgermarker/internal/fingerprint"
)

// handleIdentify 는 지문으로 유사 문서를 찾는다 (POST /v1/identify).
// 해시(정확 일치)로 못 찾는 파일 — 일부 수정본, 형식 변환본 — 을
// 원장의 원본과 연관 짓는 관찰적 재식별의 서버 측이다.
// 응답의 similarity는 추정 귀속이므로 confidence < 1.0 — 판정이 아니라
// 후보 제시이며, 채택 여부는 호출자(운영자·게이트) 몫이다(불변식 4 준용).
func (s *Server) handleIdentify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MinHash string  `json:"minhash"` // base64(uint64×128 BE)
		Limit   int     `json:"limit,omitempty"`
		MinSim  float64 `json:"minSimilarity,omitempty"`
		// Text: 제공되고 docsim이 구성되어 있으면 후보를 docsim으로 정밀
		// 비교해 verdict를 실어 준다(웹의 정밀 판정 표시용). 원문은 저장하지
		// 않고 docsim 지문 생성에만 쓰인다.
		Text string `json:"text,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	// minhash 또는 text 중 하나는 있어야 한다. text가 오면 서버가 MinHash를
	// 계산한다(브라우저가 Go와 동일한 지문을 만들 필요가 없도록) — 원문은
	// 저장하지 않고 지문 계산·docsim 비교에만 쓴다.
	var sig []uint64
	if req.MinHash != "" {
		mh, err := base64.StdEncoding.DecodeString(req.MinHash)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "minhash must be base64")
			return
		}
		sig, err = fingerprint.Decode(mh)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	} else if req.Text != "" {
		sig = fingerprint.FromText(req.Text)
	} else {
		writeErr(w, http.StatusBadRequest, "minhash or text is required")
		return
	}
	if req.Limit <= 0 || req.Limit > 20 {
		req.Limit = 5
	}
	if req.MinSim <= 0 {
		req.MinSim = 0.3 // 기본 하한 — 그 미만은 우연 수준
	}

	cands, err := s.cfg.Store.FingerprintCandidates(r.Context(), fingerprint.Buckets(sig))
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}

	type candidate struct {
		DocGUID       string  `json:"docGuid"`
		Similarity    float64 `json:"similarity"`
		Grade         string  `json:"grade,omitempty"`
		ApprovalState string  `json:"approvalState,omitempty"`
		IssuerOrg     string  `json:"issuerOrg,omitempty"`
		Filename      string  `json:"filename,omitempty"`
		ContentHash   string  `json:"contentHash,omitempty"`
		Revoked       bool    `json:"revoked"`
		// DocsimFp: 발급 시 제출된 사내 docsim 정밀 지문 — 클라이언트가
		// 정밀·의미 비교(lm identify --deep)에 사용한다.
		DocsimFp string `json:"docsimFp,omitempty"`
		// Deep: 서버가 docsim으로 비교한 정밀 판정(웹 표시용, 선택).
		Deep *deepVerdict `json:"deep,omitempty"`
	}
	var out []candidate
	for doc, otherMH := range cands {
		other, err := fingerprint.Decode(otherMH)
		if err != nil {
			continue
		}
		sim := fingerprint.Similarity(sig, other)
		if sim < req.MinSim {
			continue
		}
		c := candidate{DocGUID: doc.String(), Similarity: sim}
		if latest, err := s.cfg.Store.LatestByDoc(r.Context(), doc); err == nil && latest != nil {
			c.Grade = latest.Grade
			c.ApprovalState = latest.ApprovalState
			c.IssuerOrg = latest.IssuerOrg
			c.Filename = latest.Filename
			c.ContentHash = hex.EncodeToString(latest.ContentHash)
			c.Revoked = !latest.Type.IsIssuance()
			c.DocsimFp = latest.DocsimFP
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Similarity > out[j].Similarity })
	if len(out) > req.Limit {
		out = out[:req.Limit]
	}
	// 정밀 판정(선택): 질의 텍스트가 오고 docsim이 구성되어 있으면 후보를
	// 서버가 docsim으로 비교해 verdict를 채운다.
	if req.Text != "" && s.cfg.DocsimBin != "" {
		mineFP, err := docsimFingerprintText(s.cfg.DocsimBin, s.cfg.DocsimDir, req.Text)
		if err != nil {
			s.log.Warn("docsim query fingerprint failed", "err", err)
		} else {
			for i := range out {
				if out[i].DocsimFp == "" {
					continue
				}
				v, err := docsimCompareFP(s.cfg.DocsimBin, s.cfg.DocsimDir, mineFP, out[i].DocsimFp)
				if err == nil {
					out[i].Deep = v
				}
				out[i].DocsimFp = "" // 응답에 지문 원본은 싣지 않는다(용량·불필요)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"candidates": out,
		// 지문 귀속은 추정이다 — 선언적 계보(1.0)와 달리 confidence < 1
		"note": "similarity는 내용 유사도 추정치입니다. 귀속 확정은 운영자 판단(예: lm issue --parent로 계보 선언) 사항입니다.",
	})
}
