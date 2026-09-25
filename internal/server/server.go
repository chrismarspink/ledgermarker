// Package server 는 LM Server의 HTTP API(/v1)를 구현한다 (DEV SPEC §6).
package server

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	lmcrypto "github.com/chrismarspink/ledgermarker/internal/crypto"
	"github.com/chrismarspink/ledgermarker/internal/ledger"
	"github.com/chrismarspink/ledgermarker/internal/store"
	"github.com/chrismarspink/ledgermarker/internal/treaty"
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
	// Issuers 는 발급기관 선택을 위한 추가 발급자 집합이다(선택).
	// 키는 orgId. 발급 요청의 issuerOrg가 여기 있으면 그 기관 키로 서명한다.
	// 비어 있으면 IssuerOrg/LabelSigner 단일 기관으로 동작(하위 호환).
	Issuers map[string]*Issuer
	// APIKeys 가 비어 있지 않으면 비공개 엔드포인트에 X-LM-Key를 요구한다.
	// ✎ 운영 환경 인증 방식(mTLS vs API Key) 확정 필요 (DEV SPEC §13-4).
	APIKeys []string
	// RegradeApprovalToken 은 등급 하향 승인 토큰이다 (T9).
	RegradeApprovalToken string
	// DestroyApprovalToken 은 파기 심의 승인 토큰이다. 미구성이면 파기가
	// 전면 비활성화된다 — 파기는 심의 거버넌스 없이는 불가능해야 한다
	// (docs/lifecycle-policy.md §2).
	DestroyApprovalToken string
	// KeyShredder 는 파기 시 KMS DEK 파기를 지시한다(Phase 2, nil 허용).
	KeyShredder lmcrypto.KeyShredder
	// Treaty 는 등가성 협정 서비스다(선택). 검증 L3 반영은 Phase 2 —
	// Phase 1은 목록 노출(/v1/treaties)까지만 한다.
	Treaty treaty.Service
	// DocsimBin/DocsimDir: 사내 docsim 실행 파일과 작업 디렉터리(선택).
	// 설정되면 /v1/identify 에서 텍스트가 오면 정밀 판정을 채워 준다.
	DocsimBin string
	DocsimDir string
	// SampleDir: 기능 테스트용 샘플 폴더(manifest.json 포함, 선택). 설정되면
	// POST /v1/admin/load-samples 가 샘플을 일괄 발급해 원장을 채운다.
	SampleDir string
	// WebDir: 빌드된 PWA(verify-pwa/dist) 폴더(선택). 설정되면 /v1 밖의 경로를 정적 파일로
	// 서비스하고, 없는 경로는 index.html 로 돌린다(SPA 라우팅). 웹과 API 를 한 주소·한
	// 프로세스로 묶는 단일 서버 데모(Hugging Face Space 등)용이다.
	WebDir string
	Logger               *slog.Logger
	// RefreshView 는 쓰기 후 current_label 구체화 뷰 갱신 훅(선택)이다.
	RefreshView func(ctx context.Context) error
}

// Issuer 는 한 발급기관의 서명 자산이다.
type Issuer struct {
	OrgID          string
	OrgName        string // 표시명(예: 우정사업본부) — 로고와 함께 검증 결과에 노출
	LabelSigner    lmcrypto.Signer
	CACert         *x509.Certificate
	CACertPEM      []byte
	RevokedSerials func() map[string]bool
}

type Server struct {
	cfg    Config
	writer *ledger.Writer
	jobs   *jobRegistry
	log    *slog.Logger

	issueMu sync.Mutex // 멱등키 확인→발급을 직렬화 (T12)
}

// issuerFor 는 orgId에 맞는 발급자를 반환한다. 빈 문자열이거나 미등록이면
// 기본 발급기관(cfg.IssuerOrg/LabelSigner)을 쓴다.
func (s *Server) issuerFor(orgID string) *Issuer {
	if orgID != "" && s.cfg.Issuers != nil {
		if iss, ok := s.cfg.Issuers[orgID]; ok {
			return iss
		}
	}
	return &Issuer{
		OrgID:          s.cfg.IssuerOrg,
		OrgName:        s.cfg.IssuerOrg,
		LabelSigner:    s.cfg.LabelSigner,
		CACert:         s.cfg.CACert,
		CACertPEM:      s.cfg.CACertPEM,
		RevokedSerials: s.cfg.RevokedSerials,
	}
}

// allIssuers 는 기본 발급기관 + 추가 발급기관을 orgId→Issuer로 반환한다.
func (s *Server) allIssuers() map[string]*Issuer {
	out := map[string]*Issuer{
		s.cfg.IssuerOrg: s.issuerFor(""),
	}
	for id, iss := range s.cfg.Issuers {
		out[id] = iss
	}
	return out
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
	mux.HandleFunc("POST /v1/identify", s.handleIdentify) // 지문 유사도 재식별
	mux.HandleFunc("POST /v1/compare", s.handleCompare)   // 두 텍스트 유사도 (유사도 테스트)
	mux.HandleFunc("GET /v1/documents/{docGuid}/lineage", s.handleLineage)
	mux.HandleFunc("GET /v1/checkpoints/latest", s.handleLatestCheckpoint)
	mux.HandleFunc("GET /v1/checkpoints", s.handleCheckpoints) // 봉인 목록 (시각화)
	mux.HandleFunc("GET /v1/trust/list", s.handleTrustList)
	mux.HandleFunc("GET /v1/keys", s.handleKeys)         // 공개키·인증서만 노출
	mux.HandleFunc("GET /v1/formats", s.handleFormats)   // 포맷 카탈로그 (공개, 캐시 대상)
	mux.HandleFunc("GET /v1/labels/by-hash/{hash}", s.handleLabelByHash) // 라벨 복원용
	mux.HandleFunc("POST /v1/formats/resolve", s.handleFormatsResolve)
	mux.HandleFunc("GET /v1/treaties", s.handleTreaties) // 등가성 협정 (여권 정책)

	// 비공개 (발급·운영)
	mux.HandleFunc("POST /v1/labels", s.auth(s.handleIssue))
	mux.HandleFunc("POST /v1/reindex", s.auth(s.handleReindex)) // 지문 색인 갱신
	mux.HandleFunc("POST /v1/restore", s.auth(s.handleRestore)) // 유출·변형 파일 정체성 복원(재수화)
	mux.HandleFunc("POST /v1/labels/{docGuid}/revoke", s.auth(s.handleRevoke))
	mux.HandleFunc("POST /v1/labels/{docGuid}/regrade", s.auth(s.handleRegrade))
	mux.HandleFunc("POST /v1/labels/{docGuid}/destroy", s.auth(s.handleDestroy))
	mux.HandleFunc("POST /v1/checkpoints", s.auth(s.handleSealCheckpoint))
	mux.HandleFunc("GET /v1/ledger/verify", s.auth(s.handleLedgerVerify))
	mux.HandleFunc("GET /v1/ledger/events", s.auth(s.handleLedgerEvents))
	mux.HandleFunc("POST /v1/trust/import", s.auth(s.handleTrustImport))
	mux.HandleFunc("POST /v1/batch/scan", s.auth(s.handleBatchScan))
	mux.HandleFunc("GET /v1/batch/{jobId}", s.auth(s.handleBatchStatus))
	mux.HandleFunc("GET /v1/admin/stats", s.auth(s.handleAdminStats))
	mux.HandleFunc("POST /v1/admin/load-samples", s.auth(s.handleLoadSamples)) // 샘플 일괄 발급(기능 테스트)
	// 게이트 관측 로그 — 기관 간 보냄·수신·검증 기록 (원장과 분리된 추가 전용 로그)
	mux.HandleFunc("POST /v1/observations", s.auth(s.handleObserve))
	mux.HandleFunc("GET /v1/observations", s.auth(s.handleObservations))

	if s.cfg.WebDir != "" {
		mux.Handle("/", s.spaHandler())
	}

	return s.cors(mux)
}

// spaHandler 는 WebDir 의 정적 파일을 내주고, 파일이 없으면 index.html 을 준다 —
// /ledger 같은 클라이언트 라우트를 새로고침해도 PWA 가 뜨게 한다. /v1 은 API 전용이라
// 매칭되지 않은 /v1 경로는 404 로 남긴다(정적 파일로 오해하지 않도록).
func (s *Server) spaHandler() http.Handler {
	fs := http.FileServer(http.Dir(s.cfg.WebDir))
	index := filepath.Join(s.cfg.WebDir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		p := filepath.Join(s.cfg.WebDir, filepath.FromSlash(path.Clean("/"+r.URL.Path)))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index)
	})
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

// rootsPool 은 모든 발급기관 CA + 신뢰목록의 파트너 CA로 검증 풀을 만든다.
func (s *Server) rootsPool(ctx context.Context) *x509.CertPool {
	pool := x509.NewCertPool()
	for _, iss := range s.allIssuers() {
		if iss.CACert != nil {
			pool.AddCert(iss.CACert)
		}
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

// allRevokedSerials 는 모든 발급기관의 폐기 인증서 일련번호를 합친다.
func (s *Server) allRevokedSerials() map[string]bool {
	out := map[string]bool{}
	for _, iss := range s.allIssuers() {
		if iss.RevokedSerials == nil {
			continue
		}
		for sn, v := range iss.RevokedSerials() {
			if v {
				out[sn] = true
			}
		}
	}
	return out
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
