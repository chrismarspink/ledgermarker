// Package gatesdk 는 게이트 장비(CDS/DLP/AI필터)가 LM 검증을 호출하기 위한
// Go 클라이언트다 (DEV SPEC §1 산출물 4). REST 명세는 api/openapi.yaml 참조.
//
// 사용 규칙: VerdictHint는 참고값이다. 통과 여부는 게이트 정책이 정한다 —
// LM은 "이 문서가 무엇인가"만 답한다 (불변식 4).
package gatesdk

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client 는 LM Server API 클라이언트다.
type Client struct {
	BaseURL string // 예: https://lm.example.go.kr
	APIKey  string // X-LM-Key (✎ 운영 인증 방식 확정 필요 — mTLS 시 HTTP 클라이언트에 TLS 설정)
	HTTP    *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTP:    &http.Client{Timeout: 15 * time.Second},
	}
}

// ── 검증 (POST /v1/verify) ──────────────────────────────

type VerifyRequest struct {
	LabelDER    string `json:"labelData,omitempty"` // base64. 없으면 폴백 검증
	ContentHash string `json:"contentHash"`         // hex SHA-256 — 필수
	TextHash    string `json:"textHash,omitempty"`  // 정규화 본문 텍스트 해시 (재저장본 재식별)
	Level       int    `json:"level,omitempty"`     // 1=로컬, 2=원장(기본), 3=상호(Phase 2)
}

type Attribution struct {
	DocGUID       string  `json:"docGuid,omitempty"`
	Grade         string  `json:"grade,omitempty"`
	ApprovalState string  `json:"approvalState,omitempty"`
	IssuerOrg     string  `json:"issuerOrg,omitempty"`
	RootDocID     string  `json:"rootDocId,omitempty"`
	Confidence    float64 `json:"confidence"`
}

type Checks struct {
	Signature  string `json:"signature"`  // valid | invalid | absent | untrusted_ca
	Ledger     string `json:"ledger"`     // registered | unregistered | unavailable
	Revocation string `json:"revocation"` // none | revoked | superseded
	Validity   string `json:"validity"`   // in_window | expired | not_yet
	Treaty     string `json:"treaty"`     // present | absent | not_applicable
}

type VerifyResponse struct {
	Attribution     Attribution `json:"attribution"`
	Checks          Checks      `json:"checks"`
	TranslatedGrade string      `json:"translatedGrade,omitempty"`
	// VerdictHint는 참고값일 뿐이다. 판정처럼 쓰지 말 것.
	VerdictHint string   `json:"verdictHint"`
	Reasons     []string `json:"reasons"`
}

func (c *Client) Verify(ctx context.Context, req VerifyRequest) (*VerifyResponse, error) {
	var out VerifyResponse
	if err := c.do(ctx, http.MethodPost, "/v1/verify", "", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── 발급 (POST /v1/labels) ──────────────────────────────

type LineageDecl struct {
	ParentHash string `json:"parentHash"`
	Transform  string `json:"transform"`
}

// AttachDecl 은 클라이언트가 수행한 부착 결과 보고다.
type AttachDecl struct {
	Method         string `json:"method"` // embedded|container|sidecar|ledger_only
	FormatID       string `json:"formatId"`
	FallbackReason string `json:"fallbackReason,omitempty"`
}

type IssueRequest struct {
	DocGUID             string           `json:"docGuid,omitempty"`
	ContentHash         string           `json:"contentHash"`
	Grade               string           `json:"grade"`
	BasisClause         int              `json:"basisClause,omitempty"`
	BasisKeywords       []string         `json:"basisKeywords,omitempty"`
	BRMPath             string           `json:"brmPath,omitempty"`
	ApprovalState       string           `json:"approvalState,omitempty"`
	ApproverRank        string           `json:"approverRank,omitempty"`
	DisclosureCondition *time.Time       `json:"disclosureCondition,omitempty"`
	Lineage             *LineageDecl     `json:"lineage,omitempty"`
	NotAfterDays        int              `json:"notAfterDays,omitempty"`
	ExportApprover      string           `json:"exportApprover,omitempty"`
	Attach              *AttachDecl      `json:"attach,omitempty"`
	Fingerprint         *FingerprintDecl `json:"fingerprint,omitempty"`
	TextHash            string           `json:"textHash,omitempty"`      // 2차 식별 색인
	DocsimFp            string           `json:"docsimFp,omitempty"`      // docsim 정밀 지문 (선택)
	ApprovalToken       string           `json:"approvalToken,omitempty"` // 파생물 하향 상속 승인
	IssuerOrg           string           `json:"issuerOrg,omitempty"`     // 발급기관 선택
	Filename            string           `json:"filename,omitempty"`      // 원본 파일명(확인용 메타)
	Text                string           `json:"text,omitempty"`          // 옵트인 본문(서버 docsim 지문 계산용)
	Sign                *bool            `json:"sign,omitempty"`          // 서명 on/off (기본 on)
}

// FingerprintDecl 은 내용 유사도 지문 제출이다 (MinHash, base64).
type FingerprintDecl struct {
	MinHash string `json:"minhash"`
}

// AttachResult 는 발급 응답의 부착 결과다.
type AttachResult struct {
	Method         string `json:"method"`
	FormatID       string `json:"formatId"`
	Survivability  string `json:"survivability,omitempty"`
	FallbackReason string `json:"fallbackReason,omitempty"`
}

type IssueResponse struct {
	DocGUID   string        `json:"docGuid"`
	LabelDER  string        `json:"labelData"`
	LedgerSeq int64         `json:"ledgerSeq"`
	RootDocID string        `json:"rootDocId,omitempty"`
	IssuedAt  time.Time     `json:"issuedAt"`
	NotAfter  time.Time     `json:"notAfter"`
	Attach    *AttachResult `json:"attach,omitempty"`
}

// IssueLabel 은 라벨을 발급한다. idemKey(Idempotency-Key)는 필수다.
func (c *Client) IssueLabel(ctx context.Context, req IssueRequest, idemKey string) (*IssueResponse, error) {
	var out IssueResponse
	if err := c.do(ctx, http.MethodPost, "/v1/labels", idemKey, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Revoke(ctx context.Context, docGUID, reason string) error {
	return c.do(ctx, http.MethodPost, "/v1/labels/"+docGUID+"/revoke", "",
		map[string]string{"reason": reason}, nil)
}

func (c *Client) Regrade(ctx context.Context, docGUID, grade, approvalToken, reason string) (*IssueResponse, error) {
	var out IssueResponse
	err := c.do(ctx, http.MethodPost, "/v1/labels/"+docGUID+"/regrade", "",
		map[string]string{"grade": grade, "approvalToken": approvalToken, "reason": reason}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// Destroy 는 파기다 — 파기 심의 토큰과 심의 근거(reason)가 필수다.
// 불가역이며, 원장 증적(해시·계보)은 영구 보존된다.
func (c *Client) Destroy(ctx context.Context, docGUID, reason, approvalToken string) error {
	return c.do(ctx, http.MethodPost, "/v1/labels/"+docGUID+"/destroy", "",
		map[string]string{"reason": reason, "approvalToken": approvalToken}, nil)
}

// IdentifyCandidate 는 지문 유사도 재식별 후보다.
type IdentifyCandidate struct {
	DocGUID       string  `json:"docGuid"`
	Similarity    float64 `json:"similarity"`
	Grade         string  `json:"grade,omitempty"`
	ApprovalState string  `json:"approvalState,omitempty"`
	IssuerOrg     string  `json:"issuerOrg,omitempty"`
	ContentHash   string  `json:"contentHash,omitempty"`
	Revoked       bool    `json:"revoked"`
	DocsimFp      string  `json:"docsimFp,omitempty"` // 정밀 비교용 (lm identify --deep)
}

// Identify 는 MinHash 지문으로 유사 문서 후보를 조회한다 (관찰적 재식별).
// similarity는 추정치다 — 귀속 확정은 호출자 판단.
func (c *Client) Identify(ctx context.Context, minhashB64 string, limit int) ([]IdentifyCandidate, error) {
	var out struct {
		Candidates []IdentifyCandidate `json:"candidates"`
	}
	err := c.do(ctx, http.MethodPost, "/v1/identify", "",
		map[string]interface{}{"minhash": minhashB64, "limit": limit}, &out)
	if err != nil {
		return nil, err
	}
	return out.Candidates, nil
}

// RestoreRequest 는 유출·변형된 파일의 정체성 복원 요청이다.
type RestoreRequest struct {
	ContentHash   string  `json:"contentHash"`             // 파일 자신의 해시 (필수)
	TextHash      string  `json:"textHash,omitempty"`      // 정규화 본문 텍스트 해시 (2차 식별)
	MinHash       string  `json:"minhash,omitempty"`       // base64 지문 (유사도 재식별)
	MinSimilarity float64 `json:"minSimilarity,omitempty"` // 후보 하한(기본 0.3)
	Apply         bool    `json:"apply,omitempty"`         // true → 유사도 충분 시 상속 라벨 발급
	IssuerOrg     string  `json:"issuerOrg,omitempty"`
}

// RestoreResult 는 복원 결과다. Mode 로 어떤 경로로 되살아났는지 구분한다:
// exact(무수정 사본)·text(재저장·변환본)·inherited(수정본 상속 복원)·
// review(사람 확인 필요)·not_found.
type RestoreResult struct {
	Mode              string              `json:"mode"`
	DocGUID           string              `json:"docGuid,omitempty"`
	Grade             string              `json:"grade,omitempty"`
	RootDocID         string              `json:"rootDocId,omitempty"`
	LedgerSeq         int64               `json:"ledgerSeq,omitempty"`
	LabelDER          string              `json:"labelData,omitempty"`
	Similarity        float64             `json:"similarity,omitempty"`
	ParentDocGUID     string              `json:"parentDocGuid,omitempty"`
	ParentContentHash string              `json:"parentContentHash,omitempty"`
	Revoked           bool                `json:"revoked,omitempty"`
	Destroyed         bool                `json:"destroyed,omitempty"`
	Candidates        []IdentifyCandidate `json:"candidates,omitempty"`
	Reasons           []string            `json:"reasons,omitempty"`
}

// Restore 는 저항 사다리(해시→텍스트해시→지문)를 한 호출로 엮어 파일 정체성을
// 되살린다. Apply=true면 유사도가 충분한 수정본에 원본 귀속을 상속한 새 라벨을
// 발급한다(재수화). 발급이 일어나므로 API 키가 필요하다.
func (c *Client) Restore(ctx context.Context, req RestoreRequest) (*RestoreResult, error) {
	var out RestoreResult
	if err := c.do(ctx, http.MethodPost, "/v1/restore", "", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LabelInfo 는 해시로 회수한 라벨 원본이다 (라벨 복원용).
type LabelInfo struct {
	DocGUID       string `json:"docGuid"`
	Grade         string `json:"grade"`
	ApprovalState string `json:"approvalState"`
	IssuerOrg     string `json:"issuerOrg"`
	LedgerSeq     int64  `json:"ledgerSeq"`
	LabelDER      string `json:"labelData"` // base64
	Revoked       bool   `json:"revoked"`
	Destroyed     bool   `json:"destroyed"`
}

// LabelByHash 는 원장에서 해시로 라벨 원본을 회수한다 (복원·재적용).
func (c *Client) LabelByHash(ctx context.Context, hashHex string) (*LabelInfo, error) {
	var out LabelInfo
	if err := c.do(ctx, http.MethodGet, "/v1/labels/by-hash/"+hashHex, "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LabelByTextHash 는 텍스트 해시(2차 식별자)로 라벨을 회수한다 —
// 재저장·재압축으로 원시 해시가 달라진 파일의 복원용.
func (c *Client) LabelByTextHash(ctx context.Context, textHashHex string) (*LabelInfo, error) {
	var out LabelInfo
	if err := c.do(ctx, http.MethodGet, "/v1/labels/by-hash/"+textHashHex+"?kind=text", "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── 계보·원장·신뢰목록 ──────────────────────────────────

type LineageNode struct {
	DocGUID       string    `json:"docGuid"`
	ContentHash   string    `json:"contentHash"`
	Grade         string    `json:"grade,omitempty"`
	ApprovalState string    `json:"approvalState,omitempty"`
	IssuerOrg     string    `json:"issuerOrg,omitempty"`
	Revoked       bool      `json:"revoked"`
	CreatedAt     time.Time `json:"createdAt"`
	Seq           int64     `json:"seq"`
}

type LineageEdge struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Transform string `json:"transform,omitempty"`
}

type LineageGraph struct {
	Target string        `json:"target"`
	Root   string        `json:"rootDocId,omitempty"`
	Nodes  []LineageNode `json:"nodes"`
	Edges  []LineageEdge `json:"edges"`
}

func (c *Client) Lineage(ctx context.Context, docGUID string, depth int, direction string) (*LineageGraph, error) {
	var out LineageGraph
	path := fmt.Sprintf("/v1/documents/%s/lineage?depth=%d&direction=%s", docGUID, depth, direction)
	if err := c.do(ctx, http.MethodGet, path, "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type LedgerVerifyResult struct {
	OK      bool  `json:"ok"`
	BadSeq  int64 `json:"badSeq"`
	Checked int   `json:"checked"`
}

func (c *Client) LedgerVerify(ctx context.Context, from, to int64) (*LedgerVerifyResult, error) {
	var out LedgerVerifyResult
	path := fmt.Sprintf("/v1/ledger/verify?from=%d&to=%d", from, to)
	if err := c.do(ctx, http.MethodGet, path, "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LedgerEventRow 는 원장 열람 행이다 (label_der 제외).
type LedgerEventRow struct {
	Seq            int64     `json:"seq"`
	EventType      string    `json:"eventType"`
	DocGUID        string    `json:"docGuid"`
	ContentHash    string    `json:"contentHash"`
	Grade          string    `json:"grade,omitempty"`
	ApprovalState  string    `json:"approvalState,omitempty"`
	ParentHash     string    `json:"parentHash,omitempty"`
	RootDocID      string    `json:"rootDocId,omitempty"`
	Transform      string    `json:"transform,omitempty"`
	IssuerOrg      string    `json:"issuerOrg"`
	RevokedRef     int64     `json:"revokedRef,omitempty"`
	Reason         string    `json:"reason,omitempty"`
	Actor          string    `json:"actor"`
	AttachMethod   string    `json:"attachMethod,omitempty"`
	FormatID       string    `json:"formatId,omitempty"`
	FallbackReason string    `json:"fallbackReason,omitempty"`
	RowHash        string    `json:"rowHash"`
	PrevHash       string    `json:"prevHash"`
	CreatedAt      time.Time `json:"createdAt"`
}

type LedgerEventsPage struct {
	Tip    int64            `json:"tip"`
	From   int64            `json:"from"`
	To     int64            `json:"to"`
	Events []LedgerEventRow `json:"events"`
}

// LedgerEvents 는 원장을 열람한다. from/to=0 이면 최근 limit행.
func (c *Client) LedgerEvents(ctx context.Context, from, to int64, limit int) (*LedgerEventsPage, error) {
	var out LedgerEventsPage
	path := fmt.Sprintf("/v1/ledger/events?from=%d&to=%d&limit=%d", from, to, limit)
	if err := c.do(ctx, http.MethodGet, path, "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type Checkpoint struct {
	CkptID       int64     `json:"ckptId"`
	FromSeq      int64     `json:"fromSeq"`
	ToSeq        int64     `json:"toSeq"`
	MerkleRoot   string    `json:"merkleRoot"`
	Signature    string    `json:"signature"`
	SignerCertSN string    `json:"signerCertSn"`
	SignedAt     time.Time `json:"signedAt"`
}

func (c *Client) SealCheckpoint(ctx context.Context) (*Checkpoint, error) {
	var out Checkpoint
	if err := c.do(ctx, http.MethodPost, "/v1/checkpoints", "", map[string]int64{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) LatestCheckpoint(ctx context.Context) (*Checkpoint, error) {
	var out Checkpoint
	if err := c.do(ctx, http.MethodGet, "/v1/checkpoints/latest", "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) TrustImport(ctx context.Context, orgID, certPEM string) error {
	return c.do(ctx, http.MethodPost, "/v1/trust/import", "",
		map[string]string{"orgId": orgID, "certPem": certPEM}, nil)
}

// ── 배치 ────────────────────────────────────────────────

type BatchItemResult struct {
	ContentHash string `json:"contentHash"`
	DocGUID     string `json:"docGuid,omitempty"`
	LabelDER    string `json:"labelData,omitempty"`
	LedgerSeq   int64  `json:"ledgerSeq,omitempty"`
	Error       string `json:"error,omitempty"`
}

type BatchJob struct {
	JobID     string            `json:"jobId"`
	State     string            `json:"state"`
	Total     int               `json:"total"`
	Done      int               `json:"done"`
	Failed    int               `json:"failed"`
	StartedAt time.Time         `json:"startedAt"`
	Results   []BatchItemResult `json:"results,omitempty"`
}

func (c *Client) BatchScan(ctx context.Context, items []IssueRequest) (jobID string, err error) {
	var out struct {
		JobID string `json:"jobId"`
	}
	if err := c.do(ctx, http.MethodPost, "/v1/batch/scan",
		"", map[string]interface{}{"items": items}, &out); err != nil {
		return "", err
	}
	return out.JobID, nil
}

func (c *Client) BatchStatus(ctx context.Context, jobID string) (*BatchJob, error) {
	var out BatchJob
	if err := c.do(ctx, http.MethodGet, "/v1/batch/"+jobID, "", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── 공통 ────────────────────────────────────────────────

// APIError 는 서버가 반환한 오류다.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("lm server: %d: %s", e.StatusCode, e.Message)
}

func (c *Client) do(ctx context.Context, method, path, idemKey string, in, out interface{}) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return fmt.Errorf("gatesdk: marshal request: %w", err)
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return fmt.Errorf("gatesdk: new request: %w", err)
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.APIKey != "" {
		req.Header.Set("X-LM-Key", c.APIKey)
	}
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	httpc := c.HTTP
	if httpc == nil {
		httpc = http.DefaultClient
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return fmt.Errorf("gatesdk: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return fmt.Errorf("gatesdk: read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Error == "" {
			e.Error = string(data)
		}
		return &APIError{StatusCode: resp.StatusCode, Message: e.Error}
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("gatesdk: decode response: %w", err)
		}
	}
	return nil
}
