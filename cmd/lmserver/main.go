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

	"github.com/innotium/ledgermarker/internal/crypto/softhsm"
	"github.com/innotium/ledgermarker/internal/server"
	"github.com/innotium/ledgermarker/internal/store"
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
	var apiKeys []string
	if v := os.Getenv("LM_API_KEYS"); v != "" {
		apiKeys = strings.Split(v, ",")
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
