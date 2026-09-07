// lmserver 는 LM의 유일한 백엔드다. 발급·원장·계보·협정·신뢰목록을
// 내부 기능으로 포함한다 (DEV SPEC §1).
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"encoding/json"

	"github.com/innotium/ledgermarker/internal/attach"
	"github.com/innotium/ledgermarker/internal/crypto/softhsm"
	"github.com/innotium/ledgermarker/internal/server"
	"github.com/innotium/ledgermarker/internal/store"
	"github.com/innotium/ledgermarker/internal/treaty"
	"github.com/innotium/ledgermarker/migrations"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)

	addr := envOr("LM_ADDR", ":8080")
	dbURL := os.Getenv("LM_DB_URL") // 비어 있으면 인메모리(데모 모드)
	keystoreDir := envOr("LM_KEYSTORE", "./keystore")
	issuerOrg := envOr("LM_ISSUER_ORG", "DEVORG")
	regradeToken := os.Getenv("LM_REGRADE_TOKEN")
	destroyToken := os.Getenv("LM_DESTROY_TOKEN") // 미설정 = 파기 비활성화
	var apiKeys []string
	if v := os.Getenv("LM_API_KEYS"); v != "" {
		apiKeys = strings.Split(v, ",")
	}

	// 포맷 카탈로그 검증 — id·확장자 중복, embedded인데 location 없음 등은
	// 기동 실패로 처리한다 (작업지시서 §1.4, A6·A7).
	if _, err := attach.Load(); err != nil {
		log.Error("format catalog invalid", "err", err)
		os.Exit(1)
	}

	ks, err := softhsm.Open(keystoreDir, issuerOrg)
	if err != nil {
		log.Error("open keystore", "err", err)
		os.Exit(1)
	}

	ctx := context.Background()
	var st store.Store
	var refresh func(context.Context) error
	if dbURL != "" {
		if err := migrations.Run(dbURL); err != nil {
			log.Error("run migrations", "err", err)
			os.Exit(1)
		}
		pg, err := store.OpenPostgres(ctx, dbURL)
		if err != nil {
			log.Error("open postgres", "err", err)
			os.Exit(1)
		}
		st = pg
		refresh = pg.RefreshCurrentLabel
		log.Info("store: postgresql")
	} else {
		st = store.NewMemory()
		log.Warn("store: in-memory (LM_DB_URL not set) — 데모 전용, 재시작 시 소실")
	}
	defer st.Close()

	// 등가성 협정(여권 정책) — LM_TREATIES=협정 JSON 경로 (docs/treaty-policy.md)
	var treatySvc treaty.Service
	if path := os.Getenv("LM_TREATIES"); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			log.Error("read treaties file", "path", path, "err", err)
			os.Exit(1)
		}
		var list []treaty.Treaty
		if err := json.Unmarshal(b, &list); err != nil {
			log.Error("parse treaties file", "path", path, "err", err)
			os.Exit(1)
		}
		treatySvc = treaty.NewStatic(list)
		log.Info("treaties loaded", "count", len(list), "path", path)
	}

	srv := server.New(server.Config{
		Store:                st,
		LabelSigner:          ks.LabelSigner(),
		CheckpointSigner:     ks.CheckpointSigner(),
		CACert:               ks.CACert(),
		CACertPEM:            ks.CACertPEM(),
		RevokedSerials:       ks.RevokedSerials,
		IssuerOrg:            issuerOrg,
		APIKeys:              apiKeys,
		RegradeApprovalToken: regradeToken,
		DestroyApprovalToken: destroyToken,
		Treaty:               treatySvc,
		Logger:               log,
		RefreshView:          refresh,
	})

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Info("lmserver listening", "addr", addr, "issuerOrg", issuerOrg)
	if err := httpSrv.ListenAndServe(); err != nil {
		log.Error("server exited", "err", err)
		os.Exit(1)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
