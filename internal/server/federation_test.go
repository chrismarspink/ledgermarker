package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/innotium/ledgermarker/internal/server"
	"github.com/innotium/ledgermarker/internal/treaty"
	gatesdk "github.com/innotium/ledgermarker/sdk/go"
)

// 모델 A(단일 서버 다중 기관): 검증 기관이 발급 기관과 다를 때 협정 번역(L3).
func TestVerifyTreatyL3(t *testing.T) {
	now := time.Now()
	e := setupWith(t, func(c *server.Config) {
		c.Treaty = treaty.NewStatic([]treaty.Treaty{
			{ID: "t1", PartyA: "TESTORG", PartyB: "PARTNER", GradeMap: map[string]string{"S": "S", "O": "O"},
				SignedAt: now.Add(-24 * time.Hour), NotAfter: now.Add(365 * 24 * time.Hour)},
			{ID: "t0", PartyA: "TESTORG", PartyB: "OLDPARTNER", GradeMap: map[string]string{"S": "S", "O": "O"},
				SignedAt: now.Add(-48 * time.Hour), NotAfter: now.Add(-24 * time.Hour)},
		})
	})
	ctx := context.Background()
	sDoc := e.issue(t, "sensitive doc", "S", "l3-s")
	cDoc := e.issue(t, "classified doc", "C", "l3-c")

	verify := func(resp *gatesdk.IssueResponse, content, verifier string) *gatesdk.VerifyResponse {
		t.Helper()
		out, err := e.c.Verify(ctx, gatesdk.VerifyRequest{LabelDER: resp.LabelDER, ContentHash: hashOf(content), Level: 2, VerifierOrg: verifier})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	// 자기 기관: 협정 무관
	if r := verify(sDoc, "sensitive doc", "TESTORG"); r.Checks.Treaty != "not_applicable" || r.VerdictHint != "allow" {
		t.Fatalf("same org: %+v", r)
	}
	// 협정 있는 상대 기관: 번역됨
	if r := verify(sDoc, "sensitive doc", "PARTNER"); r.Checks.Treaty != "translated" || r.TranslatedGrade != "S" || r.VerdictHint != "allow" {
		t.Fatalf("partner: %+v", r)
	}
	// 협정 없는 기관: 서명 진위까지만 → review
	if r := verify(sDoc, "sensitive doc", "NOBODY"); r.Checks.Treaty != "no_treaty" || r.VerdictHint != "review" {
		t.Fatalf("no treaty: %+v", r)
	}
	// 만료된 협정
	if r := verify(sDoc, "sensitive doc", "OLDPARTNER"); r.Checks.Treaty != "expired" || r.VerdictHint != "review" {
		t.Fatalf("expired: %+v", r)
	}
	// C 등급은 기관 내부 전용 → 번역 불가·deny
	if r := verify(cDoc, "classified doc", "PARTNER"); r.Checks.Treaty != "not_translatable" || r.VerdictHint != "deny" {
		t.Fatalf("classified: %+v", r)
	}
}

// 게이트 관측 로그·체크포인트 목록 API.
func TestObservationsAndCheckpoints(t *testing.T) {
	e := setupWith(t, func(c *server.Config) { c.APIKeys = []string{"k1"} })
	e.c = gatesdk.New(e.ts.URL, "k1")
	doc := e.issue(t, "moving doc", "S", "obs-1")

	post := func(path string, body interface{}) (int, map[string]interface{}) {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, e.ts.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-LM-Key", "k1")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	get := func(path string) map[string]interface{} {
		req, _ := http.NewRequest(http.MethodGet, e.ts.URL+path, nil)
		req.Header.Set("X-LM-Key", "k1")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return out
	}
	if code, _ := post("/v1/observations", map[string]string{"kind": "SENT", "docGuid": doc.DocGUID, "fromOrg": "TESTORG", "toOrg": "MOIS"}); code != http.StatusCreated {
		t.Fatalf("SENT: %d", code)
	}
	if code, _ := post("/v1/observations", map[string]string{"kind": "VERIFIED", "docGuid": doc.DocGUID, "fromOrg": "TESTORG", "toOrg": "MOIS", "translatedGrade": "S", "treaty": "translated", "verdictHint": "allow"}); code != http.StatusCreated {
		t.Fatalf("VERIFIED: %d", code)
	}
	if code, _ := post("/v1/observations", map[string]string{"kind": "BOGUS", "docGuid": doc.DocGUID, "fromOrg": "A", "toOrg": "B"}); code != http.StatusBadRequest {
		t.Fatalf("bogus kind must be 400, got %d", code)
	}
	if list := get("/v1/observations?toOrg=mois")["observations"].([]interface{}); len(list) != 2 {
		t.Fatalf("toOrg filter: %d", len(list))
	}
	if list := get("/v1/observations?kind=VERIFIED&docGuid=" + doc.DocGUID)["observations"].([]interface{}); len(list) != 1 {
		t.Fatalf("kind+doc filter: %d", len(list))
	}
	// 봉인 두 번 → 목록 2건
	if code, _ := post("/v1/checkpoints", map[string]int{}); code != http.StatusCreated {
		t.Fatal("seal 1")
	}
	e.issue(t, "another doc", "O", "obs-2")
	if code, _ := post("/v1/checkpoints", map[string]int{}); code != http.StatusCreated {
		t.Fatal("seal 2")
	}
	if list := get("/v1/checkpoints")["checkpoints"].([]interface{}); len(list) != 2 {
		t.Fatalf("checkpoints: %d", len(list))
	}
}

// 샘플 일괄 발급 — 멱등(두 번 눌러도 중복 없음), 이벤트·관측까지 재현.
func TestLoadSamples(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("제1조 문서 등급 표시 규정. 제2조 라벨 정의. 제3조 발급 절차."), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("제1조 문서 등급 표시 규정. 제2조 라벨 정의. 제3조 발급 절차. 제4조 부칙."), 0o644)
	manifest := map[string]interface{}{"steps": []map[string]interface{}{
		{"type": "issue", "id": "a", "file": "a.txt", "grade": "S", "brmPath": "총무/문서관리", "basisClause": 5, "keywords": []string{"내부규정"}},
		{"type": "issue", "id": "b", "file": "b.txt", "grade": "S", "parent": "a", "transform": "edit"},
		{"type": "checkpoint"},
		{"type": "regrade", "doc": "b", "grade": "O", "reason": "공개 심의"},
		{"type": "revoke", "doc": "a", "reason": "대체됨"},
		{"type": "observe", "kind": "SENT", "doc": "b", "from": "TESTORG", "to": "MOIS", "at": "2026-10-01T00:00:00Z"},
		{"type": "observe", "kind": "VERIFIED", "doc": "b", "from": "TESTORG", "to": "MOIS", "translatedGrade": "O", "treaty": "translated", "verdictHint": "allow", "at": "2026-10-01T00:05:00Z"},
	}}
	mb, _ := json.Marshal(manifest)
	os.WriteFile(filepath.Join(dir, "manifest.json"), mb, 0o644)

	e := setupWith(t, func(c *server.Config) { c.SampleDir = dir })
	load := func() map[string]interface{} {
		resp, err := http.Post(e.ts.URL+"/v1/admin/load-samples", "application/json", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("load: %d %+v", resp.StatusCode, out)
		}
		return out
	}
	r1 := load()
	if r1["failed"].(float64) != 0 || r1["issued"].(float64) != 2 || r1["events"].(float64) != 3 || r1["observations"].(float64) != 2 {
		t.Fatalf("first load: %+v", r1["log"])
	}
	tip1, _, _ := e.st.Tip(context.Background())
	// 두 번째 실행: 발급은 멱등, 등급변경·폐기·관측은 건너뜀. 봉인만 1차 실행 뒤에
	// 쌓인 행(REGRADE·REVOKE)을 새로 봉인하므로 이벤트 1건까지 허용한다.
	r2 := load()
	if r2["failed"].(float64) != 0 || r2["events"].(float64) > 1 || r2["observations"].(float64) != 0 {
		t.Fatalf("second load must skip: %+v", r2["log"])
	}
	tip2, _, _ := e.st.Tip(context.Background())
	if tip1 != tip2 || tip1 != 4 { // ISSUE, DERIVE, REGRADE, REVOKE
		t.Fatalf("tip %d → %d", tip1, tip2)
	}
	// 이벤트 API에 분류 필드가 실린다
	resp, _ := http.Get(e.ts.URL + "/v1/ledger/events?limit=10")
	var ev struct {
		Events []map[string]interface{} `json:"events"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&ev)
	resp.Body.Close()
	if ev.Events[0]["brmPath"] != "총무/문서관리" || ev.Events[0]["basisClause"].(float64) != 5 {
		t.Fatalf("events must carry brmPath/basisClause: %+v", ev.Events[0])
	}
}
