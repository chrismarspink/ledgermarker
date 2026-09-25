// lmserver 는 LM의 유일한 백엔드다. 발급·원장·계보·협정·신뢰목록을
// 내부 기능으로 포함한다 (DEV SPEC §1).
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"encoding/json"

	"github.com/chrismarspink/ledgermarker/internal/attach"
	"github.com/chrismarspink/ledgermarker/internal/crypto/softhsm"
	"github.com/chrismarspink/ledgermarker/internal/server"
	"github.com/chrismarspink/ledgermarker/internal/store"
	"github.com/chrismarspink/ledgermarker/internal/treaty"
	"github.com/chrismarspink/ledgermarker/migrations"
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

	// 추가 발급기관 — LM_ISSUERS="INNOTIUM:이노티움:./keystore-innotium,..."
	// (orgId:표시명:키스토어경로). 발급 시 issuerOrg로 선택한다.
	issuers := map[string]*server.Issuer{}
	if v := os.Getenv("LM_ISSUERS"); v != "" {
		for _, spec := range strings.Split(v, ",") {
			parts := strings.SplitN(strings.TrimSpace(spec), ":", 3)
			if len(parts) != 3 {
				log.Error("invalid LM_ISSUERS spec (want orgId:name:dir)", "spec", spec)
				os.Exit(1)
			}
			id, name, dir := parts[0], parts[1], parts[2]
			iks, err := softhsm.Open(dir, id)
			if err != nil {
				log.Error("open issuer keystore", "org", id, "dir", dir, "err", err)
				os.Exit(1)
			}
			issuers[id] = &server.Issuer{
				OrgID: id, OrgName: name,
				LabelSigner:    iks.LabelSigner(),
				CACert:         iks.CACert(),
				CACertPEM:      iks.CACertPEM(),
				RevokedSerials: iks.RevokedSerials,
			}
			log.Info("issuer registered", "org", id, "name", name, "dir", dir)
		}
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
		Issuers:              issuers,
		APIKeys:              apiKeys,
		RegradeApprovalToken: regradeToken,
		DestroyApprovalToken: destroyToken,
		Treaty:               treatySvc,
		DocsimBin:            docsimBin(),
		SampleDir:            os.Getenv("LM_SAMPLE_DIR"),
		WebDir:               os.Getenv("LM_WEB_DIR"), // 빌드된 PWA 를 같은 주소에서 서비스(단일 서버 데모)
		DocsimDir:            docsimDir(docsimBin()),
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

// docsimBin 은 docsim 실행 파일 경로다. LM_DOCSIM 이 있으면 그것을, 없으면
// 표준 설치 위치(~/docsim/.venv/bin/docsim)가 존재할 때 그것을 쓴다 — docsim은
// 기본 동작이며, 설치돼 있지 않을 때만 비활성화된다.
func docsimBin() string {
	if b := os.Getenv("LM_DOCSIM"); b != "" {
		return b
	}
	if home, err := os.UserHomeDir(); err == nil {
		std := filepath.Join(home, "docsim", ".venv", "bin", "docsim")
		if st, err := os.Stat(std); err == nil && !st.IsDir() {
			return std
		}
	}
	return ""
}

// docsimDir 는 docsim 실행 파일 경로에서 프로젝트 루트를 추정한다
// (config.yaml·mu.npy 위치). LM_DOCSIM_DIR 이 있으면 그것을 쓴다.
func docsimDir(bin string) string {
	if d := os.Getenv("LM_DOCSIM_DIR"); d != "" {
		return d
	}
	if i := strings.Index(bin, "/.venv/"); i > 0 {
		return bin[:i]
	}
	return ""
}
