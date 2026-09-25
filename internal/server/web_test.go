package server_test

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/chrismarspink/ledgermarker/internal/server"
)

// LM_WEB_DIR 이 있으면 정적 파일을 내주고, 없는 경로는 index.html(SPA 라우팅),
// /v1 은 API 전용으로 남는다.
func TestWebDirSPA(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o644)
	os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	os.WriteFile(filepath.Join(dir, "assets", "a.js"), []byte("js"), 0o644)

	e := setupWith(t, func(c *server.Config) { c.WebDir = dir })
	get := func(p string) (int, string) {
		resp, err := http.Get(e.ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if c, b := get("/assets/a.js"); c != 200 || b != "js" {
		t.Fatalf("정적 파일: %d %q", c, b)
	}
	if c, b := get("/ledger"); c != 200 || b != "<html>app</html>" {
		t.Fatalf("SPA 폴백: %d %q", c, b)
	}
	if c, _ := get("/v1/nope"); c != 404 {
		t.Fatalf("/v1 미등록 경로는 404 여야: %d", c)
	}
	if c, _ := get("/v1/healthz"); c != 200 {
		t.Fatalf("API 는 그대로: %d", c)
	}
}
