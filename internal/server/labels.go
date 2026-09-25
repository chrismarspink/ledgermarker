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

	"github.com/chrismarspink/ledgermarker/internal/attach"
	"github.com/chrismarspink/ledgermarker/internal/fingerprint"
	"github.com/chrismarspink/ledgermarker/internal/issue"
	"github.com/chrismarspink/ledgermarker/internal/ledger"
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
	// Attach 는 클라이언트가 수행한 부착 결과 보고다 (작업지시서 §2.5·§3.3).
	// 부착·해시는 클라이언트에서 일어나므로(파일 미전송 원칙) 서버는
	// 보고를 원장에 기록하고 카탈로그 정보를 덧붙여 회신한다.
	Attach *AttachDecl `json:"attach,omitempty"`
	// Fingerprint 는 내용 유사도 지문(MinHash 시그니처, base64)이다 —
	// 클라이언트가 텍스트에서 계산해 보낸다. 본문 복원 불가한 단방향
	// 요약이므로 불변식 3(본문 미저장)과 정합.
	Fingerprint *FingerprintDecl `json:"fingerprint,omitempty"`
	// TextHash 는 정규화 본문 텍스트 SHA-256(hex, 선택) — 재저장·재압축
	// 후에도 유지되는 2차 식별 색인 (SigNET H-5 흡수).
	TextHash string `json:"textHash,omitempty"`
	// DocsimFp 는 사내 docsim 모듈의 정밀 지문(JSON, 선택) — 원문 복원
	// 불가. lm identify --deep 의 의미 비교에 쓰인다.
	DocsimFp string `json:"docsimFp,omitempty"`
	// ApprovalToken: 파생물 등급이 부모보다 낮을 때(상속 규칙 하향) 필수.
	ApprovalToken string `json:"approvalToken,omitempty"`
	// IssuerOrg: 발급기관 선택(예: KPOST, INNOTIUM). 빈 값이면 기본 기관.
	IssuerOrg string `json:"issuerOrg,omitempty"`
	// Filename: 원본 파일명 — 개발·운영 확인용 주석성 메타데이터(정체성 무관).
	Filename string `json:"filename,omitempty"`
	// Text: 본문 텍스트(옵트인) — docsim 의미 지문을 서버가 계산하는 데만 쓴다.
	// 전달되면 본문이 서버로 전송된다(기본 미전송 원칙의 예외 — 사용자 동의 필요).
	// 저장하지 않고 지문 계산에만 사용한다.
	Text string `json:"text,omitempty"`
	// Sign: 서명 포함 여부. nil/true면 서명 라벨 생성, false면 원장
	// 등록만(라벨 서명 없음 — 검증 시 signature=absent).
	Sign *bool `json:"sign,omitempty"`
}

// FingerprintDecl 은 지문 제출이다.
type FingerprintDecl struct {
	MinHash string `json:"minhash"` // base64(uint64×128 BE)
}

// AttachDecl 은 부착 결과 선언이다.
type AttachDecl struct {
	Method         string `json:"method"`                   // embedded|container|sidecar|ledger_only
	FormatID       string `json:"formatId"`                 // formats.yaml id (unknown 포함)
	FallbackReason string `json:"fallbackReason,omitempty"` // not_implemented|attach_failed
}

// LineageDecl 은 선언적 계보 입력이다.
type LineageDecl struct {
	ParentHash string `json:"parentHash"` // hex — 직전 버전 content_hash
	Transform  string `json:"transform"`  // edit|convert|merge|extract
}

// IssueResponse 는 201 응답이다.
type IssueResponse struct {
	DocGUID   string        `json:"docGuid"`
	LabelDER  string        `json:"labelData"`
	LedgerSeq int64         `json:"ledgerSeq"`
	RootDocID string        `json:"rootDocId,omitempty"`
	IssuedAt  time.Time     `json:"issuedAt"`
	NotAfter  time.Time     `json:"notAfter"`
	Attach    *AttachResult `json:"attach,omitempty"` // §3.3
}

// AttachResult 는 부착 결과 회신이다 (survivability는 카탈로그에서 보강).
type AttachResult struct {
	Method         string `json:"method"`
	FormatID       string `json:"formatId"`
	Survivability  string `json:"survivability,omitempty"`
	FallbackReason string `json:"fallbackReason,omitempty"`
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
			// 재발급(같은 파일)이라도 지문은 갱신한다 — 지문 정규화·LSH가
			// 바뀌면 기존 색인이 낡아 재식별이 안 되기 때문. 지문 테이블은
			// 불변 원장과 달리 갱신 가능한 2차 색인이다.
			if req.Fingerprint != nil && req.Fingerprint.MinHash != "" {
				if docGUID, perr := uuid.Parse(resp.DocGUID); perr == nil {
					s.refreshFingerprint(r.Context(), docGUID, req.Fingerprint.MinHash)
				}
			}
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
		return nil, http.StatusBadRequest, err // 허용 등급(C/S/O) 밖이면 400
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
			// 라벨 상속 규칙 (SigNET v2-6 흡수): 파생물은 원본 최고 등급을
			// 상속하며, 자동 하향은 금지다 — 복사·요약·발췌는 같은 정보의
			// 다른 형태이기 때문. 하향은 등급 하향과 동일한 승인 토큰 필요.
			if parents[i].Grade != "" && gradeRank(req.Grade) < gradeRank(parents[i].Grade) {
				if req.ApprovalToken == "" || s.cfg.RegradeApprovalToken == "" ||
					req.ApprovalToken != s.cfg.RegradeApprovalToken {
					return nil, http.StatusForbidden, fmt.Errorf(
						"파생물은 원본 등급(%s) 이상을 상속합니다 — 하향(%s) 발급은 승인 토큰이 필요합니다",
						parents[i].Grade, req.Grade)
				}
			}
			break
		}
	}

	// 발급기관 선택: issuerOrg가 지정되면 그 기관 키로 서명한다.
	iss := s.issuerFor(req.IssuerOrg)

	// docsim 의미 지문: 클라이언트가 직접 제출(CLI)했으면 그대로 쓰고,
	// 아니면 본문 텍스트가 옵트인으로 전달되고 서버에 docsim이 구성돼
	// 있을 때 서버가 계산한다(웹에서 브라우저가 docsim을 못 돌리므로).
	// 텍스트 전송은 발급 요청에 text가 실릴 때만 일어나는 명시적 동의다.
	docsimFP := req.DocsimFp
	if docsimFP == "" && req.Text != "" && s.cfg.DocsimBin != "" {
		if fp, err := docsimFingerprintText(s.cfg.DocsimBin, s.cfg.DocsimDir, req.Text); err == nil {
			docsimFP = fp
		} else {
			s.log.Warn("docsim fingerprint at issue failed", "err", err)
		}
	}

	lbl := &issue.Label{
		Grade:          req.Grade,
		BasisClause:    req.BasisClause,
		BasisKeywords:  req.BasisKeywords,
		BRMPath:        req.BRMPath,
		IssuerOrgID:    iss.OrgID,
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

	// 서명 on/off: sign=false면 서명 라벨을 만들지 않고 원장 등록만 한다
	// (해시로 귀속·검증은 가능, 검증 시 signature=absent).
	signed := req.Sign == nil || *req.Sign
	var der []byte
	var signerSN string
	if signed {
		var err error
		der, err = issue.Build(ctx, iss.LabelSigner, lbl)
		if err != nil {
			if errors.Is(err, issue.ErrBadGrade) {
				return nil, http.StatusBadRequest, err
			}
			return nil, http.StatusInternalServerError, fmt.Errorf("build label: %w", err)
		}
		signerSN = iss.LabelSigner.SerialNumber()
	} else {
		// 미서명이라도 등급 유효성은 검사한다 (C/S/O 외 거부).
		if err := issue.ValidateGrade(req.Grade); err != nil {
			return nil, http.StatusBadRequest, err
		}
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
		IssuerOrg:     iss.OrgID,
		SignerCertSN:  signerSN,
		Actor:         actor,
		DocsimFP:      docsimFP,
		Filename:      req.Filename,
	}
	if req.TextHash != "" {
		if th, err := hex.DecodeString(req.TextHash); err == nil && len(th) == 32 {
			ev.TextHash = th
		}
	}
	// 부착 결과 기록 — 폴백 추적 (§2.5). 미보고 시 sidecar/unknown으로 간주.
	var attachOut *AttachResult
	{
		a := req.Attach
		if a == nil {
			a = &AttachDecl{Method: string(attach.MethodSidecar), FormatID: attach.UnknownFormat.ID}
		}
		switch attach.Method(a.Method) {
		case attach.MethodEmbedded, attach.MethodContainer, attach.MethodSidecar, attach.MethodLedgerOnly:
		default:
			return nil, http.StatusBadRequest, fmt.Errorf("invalid attach.method %q", a.Method)
		}
		ev.AttachMethod = a.Method
		ev.FormatID = a.FormatID
		ev.FallbackReason = a.FallbackReason
		attachOut = &AttachResult{
			Method: a.Method, FormatID: a.FormatID, FallbackReason: a.FallbackReason,
		}
		if cat, err := attach.Load(); err == nil {
			if f := cat.ByID(a.FormatID); f != nil {
				attachOut.Survivability = f.Survivability
			} else if a.FormatID == attach.UnknownFormat.ID {
				attachOut.Survivability = attach.UnknownFormat.Survivability
			}
		}
	}
	if err := s.writer.Append(ctx, ev); err != nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("ledger append: %w", err)
	}
	// 지문 저장 (관찰적 재식별용) — 실패해도 발급은 유효 (부가 색인)
	if req.Fingerprint != nil && req.Fingerprint.MinHash != "" {
		s.refreshFingerprint(ctx, docGUID, req.Fingerprint.MinHash)
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
		Attach:    attachOut,
	}, 0, nil
}

// refreshFingerprint 는 문서의 지문 색인을 최신 지문으로 교체한다.
// 기존 지문을 지우고 새로 넣어, 정규화·LSH 규칙이 바뀌어도 재식별이 된다.
func (s *Server) refreshFingerprint(ctx context.Context, docGUID uuid.UUID, minhashB64 string) {
	mh, err := base64.StdEncoding.DecodeString(minhashB64)
	if err != nil {
		s.log.Warn("invalid fingerprint b64", "docGuid", docGUID, "err", err)
		return
	}
	sig, err := fingerprint.Decode(mh)
	if err != nil {
		s.log.Warn("invalid fingerprint submitted", "docGuid", docGUID, "err", err)
		return
	}
	_ = s.cfg.Store.DeleteFingerprints(ctx, docGUID) // 낡은 색인 제거(없으면 무시)
	if err := s.cfg.Store.InsertFingerprint(ctx, docGUID, mh, fingerprint.Buckets(sig)); err != nil {
		s.log.Warn("insert fingerprint failed", "docGuid", docGUID, "err", err)
	}
}

// handleReindex 는 문서의 지문 색인을 갱신한다 (POST /v1/reindex).
// 지문 규칙(정규화·LSH)이 바뀐 뒤 예전 발급 문서를 재식별 가능하게 만든다.
// 서버는 본문을 저장하지 않으므로(불변식 3) 클라이언트가 파일에서 계산한
// contentHash·minhash를 보내면, 서버가 해시로 문서를 찾아 색인을 교체한다.
func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ContentHash string `json:"contentHash"`       // hex SHA-256 (라벨 제외 본문)
		MinHash     string `json:"minhash,omitempty"` // base64 MinHash (직접 제공)
		Text        string `json:"text,omitempty"`    // 또는 본문 텍스트(서버가 지문 계산)
	}
	if err := readJSON(r, &req); err != nil || (req.MinHash == "" && req.Text == "") {
		writeErr(w, http.StatusBadRequest, "contentHash and (minhash or text) are required")
		return
	}
	// 텍스트가 오면 서버가 MinHash를 계산한다(브라우저 재구현 불요).
	if req.MinHash == "" {
		req.MinHash = base64.StdEncoding.EncodeToString(
			fingerprint.Encode(fingerprint.FromText(req.Text)))
	}
	hash, err := hex.DecodeString(req.ContentHash)
	if err != nil || len(hash) != 32 {
		writeErr(w, http.StatusBadRequest, "contentHash must be 64 hex chars")
		return
	}
	events, err := s.cfg.Store.EventsByContentHash(r.Context(), hash)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	var docGUID uuid.UUID
	found := false
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type.IsIssuance() {
			docGUID = events[i].DocGUID
			found = true
			break
		}
	}
	if !found {
		writeErr(w, http.StatusNotFound, "이 해시의 문서가 원장에 없습니다 (먼저 발급 필요)")
		return
	}
	s.refreshFingerprint(r.Context(), docGUID, req.MinHash)
	s.log.Info("reindexed", "docGuid", docGUID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"docGuid": docGUID.String(), "status": "reindexed",
	})
}

// handleLabelByHash 는 해시로 라벨 원본을 회수한다 (GET /v1/labels/by-hash/{hash}).
// 라벨 복원(재적용)의 구현체: 라벨이 유실된 파일도 원장에 보관된 label_der로
// 이름표를 되살릴 수 있다 — "식별된 파일에 기존 보안정책 재적용" 시나리오.
// 라벨은 비밀이 아니므로(등급 평문 설계) 공개 조회다.
func (s *Server) handleLabelByHash(w http.ResponseWriter, r *http.Request) {
	hash, err := hex.DecodeString(r.PathValue("hash"))
	if err != nil || len(hash) != 32 {
		writeErr(w, http.StatusBadRequest, "hash must be 64 hex chars (SHA-256)")
		return
	}
	// kind=text 면 텍스트 해시(2차 식별자)로 조회 — 재저장본 복원용
	var events []ledger.Event
	if r.URL.Query().Get("kind") == "text" {
		events, err = s.cfg.Store.EventsByTextHash(r.Context(), hash)
	} else {
		events, err = s.cfg.Store.EventsByContentHash(r.Context(), hash)
	}
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	var matched *ledger.Event
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type.IsIssuance() && len(events[i].LabelDER) > 0 {
			matched = &events[i]
			break
		}
	}
	if matched == nil {
		writeErr(w, http.StatusNotFound, "no label found in ledger for this hash")
		return
	}
	revoked, destroyed := false, false
	if latest, err := s.cfg.Store.LatestByDoc(r.Context(), matched.DocGUID); err == nil && latest != nil {
		revoked = latest.Type == ledger.EventRevoke || latest.Type == ledger.EventDestroy
		destroyed = latest.Type == ledger.EventDestroy
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"docGuid":       matched.DocGUID.String(),
		"grade":         matched.Grade,
		"approvalState": matched.ApprovalState,
		"issuerOrg":     matched.IssuerOrg,
		"ledgerSeq":     matched.Seq,
		"labelData":     base64.StdEncoding.EncodeToString(matched.LabelDER),
		"revoked":       revoked,
		"destroyed":     destroyed,
	})
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

// handleDestroy 는 파기다 (docs/lifecycle-policy.md §3).
// 보존기간 만료 + 파기 심의를 전제로 하며, 심의 토큰 없이는 불가능하다.
// 동작: (1) KMS에 문서별 DEK 파기 지시(Phase 2 훅), (2) 원장에 DESTROY
// 이벤트 추가. 원장 행(해시·메타·계보)은 영구 보존된다 — 파기 증적이자
// 사본 유통 차단 근거.
func (s *Server) handleDestroy(w http.ResponseWriter, r *http.Request) {
	docGUID, err := uuid.Parse(r.PathValue("docGuid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid docGuid")
		return
	}
	var req struct {
		Reason        string `json:"reason"`        // 파기 심의 근거 — 필수
		ApprovalToken string `json:"approvalToken"` // 파기 심의 승인 토큰 — 필수
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if s.cfg.DestroyApprovalToken == "" {
		writeErr(w, http.StatusForbidden, "destroy is disabled: 파기 심의 토큰(LM_DESTROY_TOKEN)이 구성되지 않았습니다")
		return
	}
	if req.ApprovalToken != s.cfg.DestroyApprovalToken {
		writeErr(w, http.StatusForbidden, "destroy requires a valid 파기 심의 approvalToken")
		return
	}
	if req.Reason == "" {
		writeErr(w, http.StatusBadRequest, "reason(파기 심의 근거)은 필수입니다")
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
	if latest.Type == ledger.EventDestroy {
		writeErr(w, http.StatusConflict, "already destroyed")
		return
	}

	// (1) KMS 키 파기 지시 — 성공해야 원장에 기록한다 (키가 살아 있는데
	// 파기됐다고 기록하면 안 된다). Phase 1은 KMS 미연동으로 생략된다.
	if s.cfg.KeyShredder != nil {
		if err := s.cfg.KeyShredder.DestroyDocumentKey(r.Context(), docGUID.String()); err != nil {
			writeErr(w, http.StatusInternalServerError, "KMS key destruction failed: "+err.Error())
			return
		}
	} else {
		s.log.Warn("destroy without KMS shredding (Phase 1 — 키 파기 훅 미연동)", "docGuid", docGUID)
	}

	// (2) 원장 파기 이벤트
	ev := &ledger.Event{
		Type:        ledger.EventDestroy,
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
	s.log.Info("document destroyed", "docGuid", docGUID, "seq", ev.Seq, "ref", latest.Seq)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"docGuid": docGUID.String(), "ledgerSeq": ev.Seq, "destroyedRef": latest.Seq,
		"note": "원장 증적은 영구 보존됩니다. 이후 이 문서(사본 포함)의 검증은 destroyed/deny로 판정됩니다.",
	})
}

// gradeRank: N2SF 민감도 순서 C(비밀) > S(민감) > O(공개). 하향은 승인 토큰
// 필수 (T9), 상향은 즉시 처리 + 구 라벨 superseded (T10).
func gradeRank(g string) int {
	switch g {
	case "C":
		return 3
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
