package server

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"net/http"

	"github.com/innotium/ledgermarker/internal/fingerprint"
	"github.com/innotium/ledgermarker/internal/ledger"
)

// 재수화(rehydrate) 임계치.
//   - autoInheritSim 이상이면 유사도가 충분히 높다고 보고, apply=true일 때
//     원본 귀속(File ID 계보·등급·태그)을 상속한 새 라벨을 자동 발급한다.
//   - 그 미만~reviewFloor 구간은 사람 확인(review)으로 넘긴다.
//   - reviewFloor 미만은 우연 수준 — 미식별.
const (
	autoInheritSim = 0.70
	reviewFloor    = 0.30
)

// handleRestore 는 유출·변형된 파일의 정체성을 되살린다 (POST /v1/restore).
//
// 저항 사다리를 한 호출로 엮은 오케스트레이션이다:
//  1. content hash → 원본 서명 라벨 회수 (무수정 사본)          [mode=exact]
//  2. text hash    → 원본 서명 라벨 회수 (재저장·형식 변환본)     [mode=text]
//  3. 지문 유사도  → 원본 후보 식별 →                             [mode=review]
//     apply=true & 유사도 충분 → 원본 귀속을 상속한 새 라벨 발급  [mode=inherited]
//
// exact·text는 원본 라벨을 그대로 되살린다(라벨 복원). inherited는 수정본
// 자신의 해시에 묶인 새 서명 라벨을 발급하되 원본의 File ID 계보·등급·태그를
// 승계한다(귀속 복원) — 수정본에 원본 라벨을 재부착하면 해시 불일치로 서명이
// 깨지기 때문이다. 본문 자체는 저장·복원하지 않는다(불변식 3) — 되살아난
// File ID로 ECM 정본을 회수하는 것은 호출자 몫이다.
func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ContentHash   string      `json:"contentHash"`
		TextHash      string      `json:"textHash,omitempty"`
		MinHash       string      `json:"minhash,omitempty"`
		MinSimilarity float64     `json:"minSimilarity,omitempty"`
		Apply         bool        `json:"apply,omitempty"` // true → 상속 라벨 발급
		Attach        *AttachDecl `json:"attach,omitempty"`
		IssuerOrg     string      `json:"issuerOrg,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	ctx := r.Context()

	// ── 1) content hash 로 원본 라벨 회수 (무수정 사본) ──
	if req.ContentHash != "" {
		hash, err := hex.DecodeString(req.ContentHash)
		if err != nil || len(hash) != 32 {
			writeErr(w, http.StatusBadRequest, "contentHash must be 64 hex chars (SHA-256)")
			return
		}
		if m, ok := s.recoverLabel(ctx, hash, false); ok {
			writeJSON(w, http.StatusOK, m.restoreResponse("exact",
				"원본과 바이트가 동일 — 원장의 원본 서명 라벨을 그대로 회수했습니다."))
			return
		}
	}

	// ── 2) text hash 로 원본 라벨 회수 (재저장·형식 변환본) ──
	if req.TextHash != "" {
		th, err := hex.DecodeString(req.TextHash)
		if err == nil && len(th) == 32 {
			if m, ok := s.recoverLabel(ctx, th, true); ok {
				writeJSON(w, http.StatusOK, m.restoreResponse("text",
					"재저장·형식 변환으로 바이트는 달라졌으나 본문 텍스트가 동일 — 원본 서명 라벨을 회수했습니다."))
				return
			}
		}
	}

	// ── 3) 지문 유사도로 원본 후보 식별 → (apply) 상속 복원 ──
	if req.MinHash == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"mode":    "not_found",
			"reasons": []string{"해시·텍스트해시로 원장에서 찾지 못했고, 지문(minhash)이 없어 유사도 재식별을 할 수 없습니다."},
		})
		return
	}
	mh, err := base64.StdEncoding.DecodeString(req.MinHash)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "minhash must be base64")
		return
	}
	sig, err := fingerprint.Decode(mh)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	floor := req.MinSimilarity
	if floor <= 0 {
		floor = reviewFloor
	}
	best, bestSim, others := s.bestCandidate(ctx, sig, floor)
	if best == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"mode":    "not_found",
			"reasons": []string{"유사도가 하한 미만입니다 — 원본 후보를 찾지 못했습니다."},
		})
		return
	}

	// 유사도가 충분하지 않거나 자동 적용이 아니면 사람 확인으로 넘긴다.
	if bestSim < autoInheritSim || !req.Apply {
		reason := "유사 원본 후보를 찾았습니다."
		if bestSim >= autoInheritSim {
			reason = "유사도 충분 — apply=true로 원본 귀속(File ID·등급·태그)을 상속 복원할 수 있습니다."
		} else {
			reason = "유사도가 자동 복원 임계치 미만 — 운영자 확인 후 계보 확정을 권장합니다."
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"mode":              "review",
			"similarity":        bestSim,
			"parentDocGuid":     best.DocGUID.String(),
			"parentContentHash": hex.EncodeToString(best.ContentHash),
			"grade":             best.Grade,
			"candidates":        others,
			"reasons":           []string{reason},
		})
		return
	}

	// ── 상속 복원: 수정본 자신의 해시로 새 라벨을 발급하되 원본 귀속을 승계 ──
	orphanHash := req.ContentHash
	if orphanHash == "" {
		writeErr(w, http.StatusBadRequest, "apply requires the file's own contentHash to bind the inherited label")
		return
	}
	inherit := &IssueRequest{
		ContentHash:   orphanHash,
		Grade:         best.Grade, // 등급 상속(자동 하향 금지 — issueLabel이 강제)
		BasisClause:   int(best.BasisClause),
		BasisKeywords: best.BasisKeywords,
		BRMPath:       best.BRMPath,
		TextHash:      req.TextHash,
		IssuerOrg:     req.IssuerOrg,
		Attach:        req.Attach,
		Lineage: &LineageDecl{
			ParentHash: hex.EncodeToString(best.ContentHash),
			Transform:  "edit",
		},
		Fingerprint: &FingerprintDecl{MinHash: req.MinHash},
	}
	if inherit.IssuerOrg == "" {
		inherit.IssuerOrg = best.IssuerOrg
	}
	resp, status, err := s.issueLabel(ctx, inherit, "restore:rehydrate")
	if err != nil {
		writeErr(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"mode":              "inherited",
		"docGuid":           resp.DocGUID,
		"grade":             best.Grade,
		"rootDocId":         resp.RootDocID,
		"ledgerSeq":         resp.LedgerSeq,
		"labelData":         resp.LabelDER,
		"similarity":        bestSim,
		"parentDocGuid":     best.DocGUID.String(),
		"parentContentHash": hex.EncodeToString(best.ContentHash),
		"attach":            resp.Attach,
		"reasons": []string{
			"유사 원본을 식별해 File ID 계보·등급·태그를 상속한 새 서명 라벨을 발급했습니다(수정본 자신의 해시에 결속).",
		},
	})
}

// matchedLabel 은 회수된 원본 라벨 이벤트다.
type matchedLabel struct {
	ev        *ledger.Event
	revoked   bool
	destroyed bool
}

func (m matchedLabel) restoreResponse(mode, reason string) map[string]interface{} {
	return map[string]interface{}{
		"mode":      mode,
		"docGuid":   m.ev.DocGUID.String(),
		"grade":     m.ev.Grade,
		"rootDocId": m.ev.RootDocID.String(),
		"ledgerSeq": m.ev.Seq,
		"labelData": base64.StdEncoding.EncodeToString(m.ev.LabelDER),
		"revoked":   m.revoked,
		"destroyed": m.destroyed,
		"reasons":   []string{reason},
	}
}

// recoverLabel 은 해시(content 또는 text)로 원장에서 원본 서명 라벨을 찾는다.
func (s *Server) recoverLabel(ctx context.Context, hash []byte, byText bool) (matchedLabel, bool) {
	var events []ledger.Event
	var err error
	if byText {
		events, err = s.cfg.Store.EventsByTextHash(ctx, hash)
	} else {
		events, err = s.cfg.Store.EventsByContentHash(ctx, hash)
	}
	if err != nil {
		return matchedLabel{}, false
	}
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type.IsIssuance() && len(events[i].LabelDER) > 0 {
			m := matchedLabel{ev: &events[i]}
			if latest, err := s.cfg.Store.LatestByDoc(ctx, events[i].DocGUID); err == nil && latest != nil {
				m.revoked = latest.Type == ledger.EventRevoke || latest.Type == ledger.EventDestroy
				m.destroyed = latest.Type == ledger.EventDestroy
			}
			return m, true
		}
	}
	return matchedLabel{}, false
}

// bestCandidate 는 지문 유사도가 가장 높은 원본 후보의 최신 이벤트를 돌려준다.
// 나머지 후보는 review 표시용으로 요약해 반환한다(유사도 내림차순).
func (s *Server) bestCandidate(ctx context.Context, sig []uint64, floor float64) (*ledger.Event, float64, []map[string]interface{}) {
	cands, err := s.cfg.Store.FingerprintCandidates(ctx, fingerprint.Buckets(sig))
	if err != nil {
		return nil, 0, nil
	}
	type scored struct {
		latest *ledger.Event
		sim    float64
	}
	var all []scored
	for doc, otherMH := range cands {
		other, err := fingerprint.Decode(otherMH)
		if err != nil {
			continue
		}
		sim := fingerprint.Similarity(sig, other)
		if sim < floor {
			continue
		}
		latest, err := s.cfg.Store.LatestByDoc(ctx, doc)
		if err != nil || latest == nil {
			continue
		}
		all = append(all, scored{latest: latest, sim: sim})
	}
	if len(all) == 0 {
		return nil, 0, nil
	}
	for i := range all {
		for j := i + 1; j < len(all); j++ {
			if all[j].sim > all[i].sim {
				all[i], all[j] = all[j], all[i]
			}
		}
	}
	var others []map[string]interface{}
	for _, c := range all {
		others = append(others, map[string]interface{}{
			"docGuid":     c.latest.DocGUID.String(),
			"similarity":  c.sim,
			"grade":       c.latest.Grade,
			"contentHash": hex.EncodeToString(c.latest.ContentHash),
			"revoked":     !c.latest.Type.IsIssuance(),
		})
	}
	return all[0].latest, all[0].sim, others
}
