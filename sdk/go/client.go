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
	LabelDER    string `json:"labelDer,omitempty"` // base64. 없으면 폴백 검증
	ContentHash string `json:"contentHash"`        // hex SHA-256 — 필수
	Level       int    `json:"level,omitempty"`    // 1=로컬, 2=원장(기본), 3=상호(Phase 2)
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

type IssueRequest struct {
	DocGUID             string       `json:"docGuid,omitempty"`
	ContentHash         string       `json:"contentHash"`
	Grade               string       `json:"grade"`
	BasisClause         int          `json:"basisClause,omitempty"`
	BasisKeywords       []string     `json:"basisKeywords,omitempty"`
	BRMPath             string       `json:"brmPath,omitempty"`
	ApprovalState       string       `json:"approvalState,omitempty"`
	ApproverRank        string       `json:"approverRank,omitempty"`
	DisclosureCondition *time.Time   `json:"disclosureCondition,omitempty"`
	Lineage             *LineageDecl `json:"lineage,omitempty"`
	NotAfterDays        int          `json:"notAfterDays,omitempty"`
	ExportApprover      string       `json:"exportApprover,omitempty"`
}

type IssueResponse struct {
	DocGUID   string    `json:"docGuid"`
	LabelDER  string    `json:"labelDer"`
	LedgerSeq int64     `json:"ledgerSeq"`
	RootDocID string    `json:"rootDocId,omitempty"`
	IssuedAt  time.Time `json:"issuedAt"`
	NotAfter  time.Time `json:"notAfter"`
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
	LabelDER    string `json:"labelDer,omitempty"`
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
