package server

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/issue"
	"github.com/innotium/ledgermarker/internal/ledger"
)

// IssueRequest 는 POST /v1/labels 본문이다 (DEV SPEC §6.2).
type IssueRequest struct {
	DocGUID             string       `json:"docGuid,omitempty"` // 없으면 서버가 생성
	ContentHash         string       `json:"contentHash"`       // hex SHA-256 — 필수
	Grade               string       `json:"grade"`
	BasisClause         int          `json:"basisClause,omitempty"`
	BasisKeywords       []string     `json:"basisKeywords,omitempty"`
	BRMPath             string       `json:"brmPath,omitempty"`
	ApprovalState       string       `json:"approvalState,omitempty"` // PROVISIONAL | CONFIRMED
	ApproverRank        string       `json:"approverRank,omitempty"`
	DisclosureCondition *time.Time   `json:"disclosureCondition,omitempty"`
	Lineage             *LineageDecl `json:"lineage,omitempty"`
	NotAfterDays        int          `json:"notAfterDays,omitempty"`
	ExportApprover      string       `json:"exportApprover,omitempty"`
}

// LineageDecl 은 선언적 계보 입력이다.
type LineageDecl struct {
	ParentHash string `json:"parentHash"` // hex — 직전 버전 content_hash
	Transform  string `json:"transform"`  // edit|convert|merge|extract
}

// IssueResponse 는 201 응답이다.
type IssueResponse struct {
	DocGUID   string    `json:"docGuid"`
	LabelDER  string    `json:"labelDer"` // base64 CMS
	LedgerSeq int64     `json:"ledgerSeq"`
	RootDocID string    `json:"rootDocId,omitempty"`
	IssuedAt  time.Time `json:"issuedAt"`
	NotAfter  time.Time `json:"notAfter"`
}

func (s *Server) handleIssue(w http.ResponseWriter, r *http.Request) {
	idemKey := r.Header.Get("Idempotency-Key")
	if idemKey == "" {
		writeErr(w, http.StatusBadRequest, "Idempotency-Key header is required")
		return
	}
	var req IssueRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// 멱등키 확인→발급을 직렬화해 동일 키 2회 발급 시 원장 행이 1개만
	// 생기도록 한다 (T12).
	s.issueMu.Lock()
	defer s.issueMu.Unlock()

	if cached, err := s.cfg.Store.GetIdempotent(r.Context(), idemKey); err == nil && cached != nil {
		var resp IssueResponse
		if json.Unmarshal(cached, &resp) == nil {
			writeJSON(w, http.StatusCreated, resp)
			return
		}
	}

	resp, code, err := s.issueLabel(r.Context(), &req, "api:"+idemKey)
	if err != nil {
		writeErr(w, code, err.Error())
		return
	}
	if b, err := json.Marshal(resp); err == nil {
		if err := s.cfg.Store.PutIdempotent(r.Context(), idemKey, b); err != nil {
			s.log.Warn("store idempotency key failed", "err", err)
		}
	}
	writeJSON(w, http.StatusCreated, resp)
}

// issueLabel 은 발급 공통 경로다(단건·regrade·배치 공용).
func (s *Server) issueLabel(ctx context.Context, req *IssueRequest, actor string) (*IssueResponse, int, error) {
	if err := issue.ValidateGrade(req.Grade); err != nil {
		return nil, http.StatusBadRequest, err // C등급은 400 — 범위 밖 (T11)
	}
	contentHash, err := hex.DecodeString(req.ContentHash)
	if err != nil || len(contentHash) != 32 {
		return nil, http.StatusBadRequest, fmt.Errorf("contentHash must be 64 hex chars (SHA-256)")
	}
	docGUID := uuid.New()
	if req.DocGUID != "" {
		docGUID, err = uuid.Parse(req.DocGUID)
		if err != nil {
			return nil, http.StatusBadRequest, fmt.Errorf("invalid docGuid: %w", err)
		}
	}
	approval := issue.ApprovalConfirmed
	if trimLower(req.ApprovalState) == "provisional" {
		approval = issue.ApprovalProvisional
	}

	// ── 선언적 계보 해석 ──
	var parentHash []byte
	var transform string
	rootDocID := docGUID
	eventType := ledger.EventIssue
	if req.Lineage != nil && req.Lineage.ParentHash != "" {
		parentHash, err = hex.DecodeString(req.Lineage.ParentHash)
		if err != nil || len(parentHash) != 32 {
			return nil, http.StatusBadRequest, fmt.Errorf("lineage.parentHash must be 64 hex chars")
		}
		transform = req.Lineage.Transform
		eventType = ledger.EventDerive
		parents, err := s.cfg.Store.EventsByContentHash(ctx, parentHash)
		if err != nil {
			return nil, http.StatusServiceUnavailable, fmt.Errorf("ledger unavailable: %w", err)
		}
		for i := len(parents) - 1; i >= 0; i-- {
			if parents[i].Type == ledger.EventRevoke {
				continue
			}
			if parents[i].RootDocID != uuid.Nil {
				rootDocID = parents[i].RootDocID
			} else {
				rootDocID = parents[i].DocGUID
			}
			break
		}
	}

	lbl := &issue.Label{
		Grade:          req.Grade,
		BasisClause:    req.BasisClause,
		BasisKeywords:  req.BasisKeywords,
		BRMPath:        req.BRMPath,
		IssuerOrgID:    s.cfg.IssuerOrg,
		DocGUID:        docGUID,
		ContentHash:    contentHash,
		ApproverRank:   req.ApproverRank,
		ApprovalState:  approval,
		ParentHash:     parentHash,
		RootDocID:      rootDocID,
		Transform:      transform,
		ExportApprover: req.ExportApprover,
	}
	if req.DisclosureCondition != nil {
		lbl.DisclosureCondition = *req.DisclosureCondition
	}
	issue.EnsureFreshness(lbl, req.NotAfterDays)

	der, err := issue.Build(ctx, s.cfg.LabelSigner, lbl)
	if err != nil {
		if errors.Is(err, issue.ErrGradeC) || errors.Is(err, issue.ErrBadGrade) {
			return nil, http.StatusBadRequest, err
		}
		return nil, http.StatusInternalServerError, fmt.Errorf("build label: %w", err)
	}

	ev := &ledger.Event{
		Type:          eventType,
		DocGUID:       docGUID,
		ContentHash:   contentHash,
		Grade:         req.Grade,
		BasisClause:   int16(req.BasisClause),
		BasisKeywords: req.BasisKeywords,
		BRMPath:       req.BRMPath,
		ApprovalState: lbl.ApprovalStateString(),
		ParentHash:    parentHash,
		RootDocID:     rootDocID,
		Transform:     transform,
		LabelDER:      der,
		IssuerOrg:     s.cfg.IssuerOrg,
		SignerCertSN:  s.cfg.LabelSigner.SerialNumber(),
		Actor:         actor,
	}
	if err := s.writer.Append(ctx, ev); err != nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("ledger append: %w", err)
	}
	s.refreshView(ctx)
	// 로그에는 해시·GUID만 남긴다 — 본문·지문 원본 금지 (DEV SPEC §12)
	s.log.Info("label issued", "docGuid", docGUID, "seq", ev.Seq, "grade", req.Grade)

	return &IssueResponse{
		DocGUID:   docGUID.String(),
		LabelDER:  base64.StdEncoding.EncodeToString(der),
		LedgerSeq: ev.Seq,
		RootDocID: rootDocID.String(),
		IssuedAt:  lbl.IssuedAt,
		NotAfter:  lbl.NotAfter,
	}, 0, nil
}

// handleRevoke 는 라벨 폐기를 원장 REVOKE 이벤트로 기록한다(삭제 아님).
func (s *Server) handleRevoke(w http.ResponseWriter, r *http.Request) {
	docGUID, err := uuid.Parse(r.PathValue("docGuid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid docGuid")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	latest, err := s.cfg.Store.LatestByDoc(r.Context(), docGUID)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	if latest == nil {
		writeErr(w, http.StatusNotFound, "document not found in ledger")
		return
	}
	if latest.Type == ledger.EventRevoke {
		writeErr(w, http.StatusConflict, "label already revoked")
		return
	}
	ev := &ledger.Event{
		Type:        ledger.EventRevoke,
		DocGUID:     docGUID,
		ContentHash: latest.ContentHash,
		RootDocID:   latest.RootDocID,
		IssuerOrg:   s.cfg.IssuerOrg,
		RevokedRef:  latest.Seq,
		Reason:      req.Reason,
		Actor:       "api",
	}
	if err := s.writer.Append(r.Context(), ev); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger append failed")
		return
	}
	s.refreshView(r.Context())
	s.log.Info("label revoked", "docGuid", docGUID, "seq", ev.Seq, "ref", latest.Seq)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"docGuid": docGUID.String(), "ledgerSeq": ev.Seq, "revokedRef": latest.Seq,
	})
}

// gradeRank: 민감도 순서. 하향(S→O)은 승인 토큰 필수 (T9),
// 상향(O→S)은 즉시 처리 + 구 라벨 superseded (T10).
func gradeRank(g string) int {
	switch g {
	case "S":
		return 2
	case "O":
		return 1
	}
	return 0
}

func (s *Server) handleRegrade(w http.ResponseWriter, r *http.Request) {
	docGUID, err := uuid.Parse(r.PathValue("docGuid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid docGuid")
		return
	}
	var req struct {
		Grade         string `json:"grade"`
		ApprovalToken string `json:"approvalToken,omitempty"`
		Reason        string `json:"reason,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := issue.ValidateGrade(req.Grade); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	latest, err := s.cfg.Store.LatestByDoc(r.Context(), docGUID)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	if latest == nil {
		writeErr(w, http.StatusNotFound, "document not found in ledger")
		return
	}
	if latest.Type == ledger.EventRevoke {
		writeErr(w, http.StatusConflict, "label is revoked; issue a new label instead")
		return
	}
	if latest.Grade == req.Grade {
		writeErr(w, http.StatusConflict, "grade unchanged")
		return
	}
	if gradeRank(req.Grade) < gradeRank(latest.Grade) {
		// 등급 하향: 승인 토큰 필수
		if req.ApprovalToken == "" || s.cfg.RegradeApprovalToken == "" ||
			req.ApprovalToken != s.cfg.RegradeApprovalToken {
			writeErr(w, http.StatusForbidden, "downgrade requires a valid approvalToken")
			return
		}
	}

	// 기존 라벨 필드를 물려받아 새 등급으로 재발급
	old, err := issue.Parse(latest.LabelDER)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "parse existing label failed")
		return
	}
	lbl := *old
	lbl.Grade = req.Grade
	lbl.IssuedAt = time.Time{}
	lbl.NotAfter = time.Time{}
	issue.EnsureFreshness(&lbl, 365)

	der, err := issue.Build(r.Context(), s.cfg.LabelSigner, &lbl)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "build label failed")
		return
	}
	ev := &ledger.Event{
		Type:          ledger.EventRegrade,
		DocGUID:       docGUID,
		ContentHash:   latest.ContentHash,
		Grade:         req.Grade,
		BasisClause:   latest.BasisClause,
		BasisKeywords: latest.BasisKeywords,
		BRMPath:       latest.BRMPath,
		ApprovalState: latest.ApprovalState,
		ParentHash:    latest.ParentHash,
		RootDocID:     latest.RootDocID,
		LabelDER:      der,
		IssuerOrg:     s.cfg.IssuerOrg,
		SignerCertSN:  s.cfg.LabelSigner.SerialNumber(),
		RevokedRef:    latest.Seq, // 구 라벨은 superseded로 판정된다 (T10)
		Reason:        req.Reason,
		Actor:         "api",
	}
	if err := s.writer.Append(r.Context(), ev); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger append failed")
		return
	}
	s.refreshView(r.Context())
	s.log.Info("label regraded", "docGuid", docGUID, "seq", ev.Seq,
		"from", latest.Grade, "to", req.Grade)
	writeJSON(w, http.StatusOK, IssueResponse{
		DocGUID:   docGUID.String(),
		LabelDER:  base64.StdEncoding.EncodeToString(der),
		LedgerSeq: ev.Seq,
		RootDocID: uuidOrEmpty(latest.RootDocID),
		IssuedAt:  lbl.IssuedAt,
		NotAfter:  lbl.NotAfter,
	})
}

func uuidOrEmpty(u uuid.UUID) string {
	if u == uuid.Nil {
		return ""
	}
	return u.String()
}
