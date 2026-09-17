package server

import (
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/ledger"
	"github.com/innotium/ledgermarker/internal/lineage"
	"github.com/innotium/ledgermarker/internal/store"
	"github.com/innotium/ledgermarker/internal/verify"
)

// handleVerify 는 POST /v1/verify — 가장 중요한 계약이다 (DEV SPEC §6.3).
// LM은 귀속만 답하고, 통과 여부는 호출자 정책이 정한다(불변식 4).
func (s *Server) handleVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LabelDER    string `json:"labelData,omitempty"` // 없으면 폴백 검증
		ContentHash string `json:"contentHash"`        // 필수
		TextHash    string `json:"textHash,omitempty"` // 2차 식별(재저장본 재식별)
		Level       int    `json:"level,omitempty"`    // 1|2|3(Phase 2)
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	contentHash, err := hex.DecodeString(req.ContentHash)
	if err != nil || len(contentHash) != 32 {
		writeErr(w, http.StatusBadRequest, "contentHash must be 64 hex chars (SHA-256)")
		return
	}
	var labelDER []byte
	if req.LabelDER != "" {
		labelDER, err = base64.StdEncoding.DecodeString(req.LabelDER)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "labelData must be base64")
			return
		}
	}
	deps := verify.Deps{
		Ledger:         s.cfg.Store,
		Roots:          s.rootsPool(r.Context()),
		RevokedSerials: s.allRevokedSerials(),
	}
	var textHash []byte
	if req.TextHash != "" {
		if th, err := hex.DecodeString(req.TextHash); err == nil && len(th) == 32 {
			textHash = th
		}
	}
	res, err := verify.Run(r.Context(), deps, verify.Params{
		LabelDER:    labelDER,
		ContentHash: contentHash,
		TextHash:    textHash,
		Level:       req.Level,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleLineage(w http.ResponseWriter, r *http.Request) {
	docGUID, err := uuid.Parse(r.PathValue("docGuid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid docGuid")
		return
	}
	depth, _ := strconv.Atoi(r.URL.Query().Get("depth"))
	direction := r.URL.Query().Get("direction")
	if direction == "" {
		direction = "both"
	}
	g, err := lineage.Query(r.Context(), s.cfg.Store, docGUID, depth, direction)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) handleLatestCheckpoint(w http.ResponseWriter, r *http.Request) {
	c, err := s.cfg.Store.LatestCheckpoint(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	if c == nil {
		writeErr(w, http.StatusNotFound, "no checkpoint yet")
		return
	}
	writeJSON(w, http.StatusOK, checkpointJSON(c))
}

func (s *Server) handleSealCheckpoint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FromSeq int64 `json:"fromSeq,omitempty"`
		ToSeq   int64 `json:"toSeq,omitempty"`
	}
	_ = readJSON(r, &req) // 본문 없으면 직전 체크포인트 이후 ~ tip
	c, err := s.writer.SealCheckpoint(r.Context(), s.cfg.CheckpointSigner, req.FromSeq, req.ToSeq)
	if err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	s.log.Info("checkpoint sealed", "from", c.FromSeq, "to", c.ToSeq)
	writeJSON(w, http.StatusCreated, checkpointJSON(c))
}

// checkpointJSON 은 바이너리 필드를 hex로 인코딩해 반환한다.
func checkpointJSON(c *ledger.Checkpoint) map[string]interface{} {
	return map[string]interface{}{
		"ckptId":       c.ID,
		"fromSeq":      c.FromSeq,
		"toSeq":        c.ToSeq,
		"merkleRoot":   hex.EncodeToString(c.MerkleRoot),
		"signature":    base64.StdEncoding.EncodeToString(c.Signature),
		"signerCertSn": c.SignerCertSN,
		"signedAt":     c.SignedAt,
	}
}

func (s *Server) handleLedgerVerify(w http.ResponseWriter, r *http.Request) {
	from, _ := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
	to, _ := strconv.ParseInt(r.URL.Query().Get("to"), 10, 64)
	badSeq, checked, err := s.writer.Verify(r.Context(), from, to)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      badSeq == 0,
		"badSeq":  badSeq, // 조작 지점 seq (0 = 무결) — T3
		"checked": checked,
	})
}

// handleLedgerEvents 는 원장 열람이다 (읽기 전용 — 원장은 조회만 가능하다).
// ?from=&to=&limit= — 기본: 최근 limit(50)행. label_der는 크기 때문에 제외.
func (s *Server) handleLedgerEvents(w http.ResponseWriter, r *http.Request) {
	from, _ := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
	to, _ := strconv.ParseInt(r.URL.Query().Get("to"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	tip, _, err := s.cfg.Store.Tip(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	if to == 0 || to > tip {
		to = tip
	}
	if from == 0 {
		from = to - int64(limit) + 1
	}
	if from < 1 {
		from = 1
	}
	var events []ledger.Event
	if to >= from {
		events, err = s.cfg.Store.EventsRange(r.Context(), from, to)
		if err != nil {
			writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
			return
		}
	}
	out := make([]map[string]interface{}, 0, len(events))
	for i := range events {
		e := &events[i]
		row := map[string]interface{}{
			"seq":         e.Seq,
			"eventType":   string(e.Type),
			"docGuid":     e.DocGUID.String(),
			"contentHash": hex.EncodeToString(e.ContentHash),
			"grade":       e.Grade,
			"issuerOrg":   e.IssuerOrg,
			"actor":       e.Actor,
			"rowHash":     hex.EncodeToString(e.RowHash),
			"prevHash":    hex.EncodeToString(e.PrevHash),
			"createdAt":   e.CreatedAt,
		}
		if e.ApprovalState != "" {
			row["approvalState"] = e.ApprovalState
		}
		if len(e.ParentHash) > 0 {
			row["parentHash"] = hex.EncodeToString(e.ParentHash)
		}
		if e.RootDocID != uuid.Nil {
			row["rootDocId"] = e.RootDocID.String()
		}
		if e.Transform != "" {
			row["transform"] = e.Transform
		}
		if e.RevokedRef != 0 {
			row["revokedRef"] = e.RevokedRef
		}
		if e.Reason != "" {
			row["reason"] = e.Reason
		}
		if e.AttachMethod != "" {
			row["attachMethod"] = e.AttachMethod
		}
		if e.FormatID != "" {
			row["formatId"] = e.FormatID
		}
		if e.FallbackReason != "" {
			row["fallbackReason"] = e.FallbackReason
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tip": tip, "from": from, "to": to, "events": out,
	})
}

// handleTrustList 는 PWA가 오프라인 캐시하는 신뢰목록이다.
func (s *Server) handleTrustList(w http.ResponseWriter, r *http.Request) {
	anchors, err := s.cfg.Store.TrustAnchors(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "trust list unavailable")
		return
	}
	revoked := []string{}
	for sn := range s.allRevokedSerials() {
		revoked = append(revoked, sn)
	}
	// 모든 발급기관 CA를 노출한다(PWA 오프라인 L1 검증이 서명 기관을 신뢰하도록).
	issuers := []map[string]string{}
	for id, iss := range s.allIssuers() {
		issuers = append(issuers, map[string]string{
			"orgId": id, "orgName": iss.OrgName, "caCert": string(iss.CACertPEM),
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"orgId":  s.cfg.IssuerOrg,
		"caCert": string(s.cfg.CACertPEM),
		"issuers": issuers, // 발급기관별 CA·표시명
		// 라벨 폐기(원장 이벤트)와 별개인 인증서 폐기 목록 (CRL 대용, §5.3)
		"revokedCertSerials": revoked,
		"anchors":            anchors,
	})
}

func (s *Server) handleTrustImport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrgID   string `json:"orgId"`
		CertPEM string `json:"certPem"`
	}
	if err := readJSON(r, &req); err != nil || req.CertPEM == "" {
		writeErr(w, http.StatusBadRequest, "orgId and certPem are required")
		return
	}
	ta := &store.TrustAnchor{OrgID: req.OrgID, CertPEM: req.CertPEM}
	if err := s.cfg.Store.AddTrustAnchor(r.Context(), ta); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ta)
}

func (s *Server) handleTreaties(w http.ResponseWriter, r *http.Request) {
	// 등가성 협정 목록 (여권 정책 — docs/treaty-policy.md).
	// Phase 1은 목록 노출까지; 검증 L3 번역 반영은 Phase 2.
	if s.cfg.Treaty == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"treaties": []interface{}{}})
		return
	}
	list, err := s.cfg.Treaty.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"treaties": list})
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	counts, err := s.cfg.Store.EventCounts(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	ckpt, _ := s.cfg.Store.LatestCheckpoint(r.Context())
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"eventCounts":      counts,
		"latestCheckpoint": ckpt,
		"labelSigner": map[string]interface{}{
			"serial":   s.cfg.LabelSigner.SerialNumber(),
			"notAfter": s.cfg.LabelSigner.NotAfter(),
		},
	})
}
