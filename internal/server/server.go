// Package server 는 LM Server의 HTTP API(/v1)를 구현한다 (DEV SPEC §6).
package server

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	lmcrypto "github.com/innotium/ledgermarker/internal/crypto"
	"github.com/innotium/ledgermarker/internal/ledger"
	"github.com/innotium/ledgermarker/internal/store"
)

// Config 는 서버 구성이다.
type Config struct {
	Store            store.Store
	LabelSigner      lmcrypto.Signer
	CheckpointSigner lmcrypto.Signer
	// CACert 는 자기 기관 CA(신뢰 체인 검증·신뢰목록 배포용)다.
	CACert    *x509.Certificate
	CACertPEM []byte
	// RevokedSerials 는 폐기 인증서 일련번호를 반환한다(CRL 대용).
	RevokedSerials func() map[string]bool
	IssuerOrg      string
	// APIKeys 가 비어 있지 않으면 비공개 엔드포인트에 X-LM-Key를 요구한다.
	// ✎ 운영 환경 인증 방식(mTLS vs API Key) 확정 필요 (DEV SPEC §13-4).
	APIKeys []string
	// RegradeApprovalToken 은 등급 하향 승인 토큰이다 (T9).
	RegradeApprovalToken string
	Logger               *slog.Logger
	// RefreshView 는 쓰기 후 current_label 구체화 뷰 갱신 훅(선택)이다.
	RefreshView func(ctx context.Context) error
}

type Server struct {
	cfg    Config
	writer *ledger.Writer
	jobs   *jobRegistry
	log    *slog.Logger

	issueMu sync.Mutex // 멱등키 확인→발급을 직렬화 (T12)
}

func New(cfg Config) *Server {
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg:    cfg,
		writer: ledger.NewWriter(cfg.Store),
		jobs:   newJobRegistry(),
		log:    log,
	}
}

// Writer 는 원장 기록자를 노출한다(테스트용).
func (s *Server) Writer() *ledger.Writer { return s.writer }

// Handler 는 라우팅이 구성된 http.Handler를 반환한다.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// 공개 (PWA·게이트 공용 — 읽기와 검증)
	mux.HandleFunc("GET /v1/healthz", s.handleHealthz)
	mux.HandleFunc("POST /v1/verify", s.handleVerify)
	mux.HandleFunc("GET /v1/documents/{docGuid}/lineage", s.handleLineage)
	mux.HandleFunc("GET /v1/checkpoints/latest", s.handleLatestCheckpoint)
	mux.HandleFunc("GET /v1/trust/list", s.handleTrustList)
	mux.HandleFunc("GET /v1/treaties", s.handleTreaties) // Phase 2 — 빈 목록

	// 비공개 (발급·운영)
	mux.HandleFunc("POST /v1/labels", s.auth(s.handleIssue))
	mux.HandleFunc("POST /v1/labels/{docGuid}/revoke", s.auth(s.handleRevoke))
	mux.HandleFunc("POST /v1/labels/{docGuid}/regrade", s.auth(s.handleRegrade))
	mux.HandleFunc("POST /v1/checkpoints", s.auth(s.handleSealCheckpoint))
	mux.HandleFunc("GET /v1/ledger/verify", s.auth(s.handleLedgerVerify))
	mux.HandleFunc("GET /v1/ledger/events", s.auth(s.handleLedgerEvents))
	mux.HandleFunc("POST /v1/trust/import", s.auth(s.handleTrustImport))
	mux.HandleFunc("POST /v1/batch/scan", s.auth(s.handleBatchScan))
	mux.HandleFunc("GET /v1/batch/{jobId}", s.auth(s.handleBatchStatus))
	mux.HandleFunc("GET /v1/admin/stats", s.auth(s.handleAdminStats))

	return s.cors(mux)
}

// auth 는 API Key 검사 미들웨어다. 키가 구성되지 않았으면 통과(개발 모드).
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if len(s.cfg.APIKeys) > 0 {
			key := r.Header.Get("X-LM-Key")
			ok := false
			for _, k := range s.cfg.APIKeys {
				if k != "" && key == k {
					ok = true
					break
				}
			}
			if !ok {
				writeErr(w, http.StatusUnauthorized, "invalid or missing X-LM-Key")
				return
			}
		}
		next(w, r)
	}
}

// cors 는 PWA(별도 오리진)의 호출을 허용한다.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-LM-Key, Idempotency-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// rootsPool 은 자기 CA + 신뢰목록의 파트너 CA로 검증 풀을 만든다.
func (s *Server) rootsPool(ctx context.Context) *x509.CertPool {
	pool := x509.NewCertPool()
	if s.cfg.CACert != nil {
		pool.AddCert(s.cfg.CACert)
	}
	anchors, err := s.cfg.Store.TrustAnchors(ctx)
	if err != nil {
		s.log.Warn("trust anchors unavailable", "err", err)
		return pool
	}
	for _, a := range anchors {
		pool.AppendCertsFromPEM([]byte(a.CertPEM))
	}
	return pool
}

func (s *Server) refreshView(ctx context.Context) {
	if s.cfg.RefreshView == nil {
		return
	}
	if err := s.cfg.RefreshView(ctx); err != nil {
		s.log.Warn("refresh current_label failed", "err", err)
	}
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v interface{}) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func trimLower(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
