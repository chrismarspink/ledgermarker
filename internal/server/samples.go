package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chrismarspink/ledgermarker/internal/attach"
	"github.com/chrismarspink/ledgermarker/internal/fingerprint"
	"github.com/chrismarspink/ledgermarker/internal/ledger"
	"github.com/chrismarspink/ledgermarker/internal/store"
)

// 샘플 일괄 발급(기능 테스트) — POST /v1/admin/load-samples.
//
// SampleDir/manifest.json 의 steps 를 순서대로 실행해 원장을 채운다. 각 단계는
// 서버 자신의 HTTP 핸들러를 프로세스 안에서 되부른다(loopback) — 발급·등급변경·
// 폐기·파기·봉인의 검증 규칙과 원장 기록 경로를 그대로 타기 위해서다.
// 발급의 멱등키는 샘플 id+해시로 고정하므로 버튼을 여러 번 눌러도 행이 중복되지
// 않고, 이미 적용된 등급변경·폐기·파기·봉인·관측은 건너뛴다.
//
// manifest 예:
//
//	{"steps":[
//	  {"type":"issue","id":"reg","file":"총무/문서관리규정.docx","grade":"S","issuerOrg":"KPOST",
//	   "brmPath":"총무/문서관리","basisClause":5,"keywords":["내부규정"],"semantic":true},
//	  {"type":"issue","id":"reg2","file":"총무/문서관리규정_개정안.docx","grade":"S","parent":"reg","transform":"edit"},
//	  {"type":"regrade","doc":"reg2","grade":"O","reason":"공개 심의 통과"},
//	  {"type":"revoke","doc":"weekly","reason":"오기재"},
//	  {"type":"destroy","doc":"contract","reason":"보존기간 만료"},
//	  {"type":"checkpoint"},
//	  {"type":"observe","kind":"SENT","doc":"reg2","from":"KPOST","to":"MOIS","at":"2026-10-08T09:00:00Z"},
//	  {"type":"observe","kind":"VERIFIED","doc":"reg2","from":"KPOST","to":"MOIS","translatedGrade":"S",
//	   "treaty":"translated","verdictHint":"allow","at":"2026-10-08T09:05:00Z"}
//	]}
type sampleStep struct {
	Type string `json:"type"` // issue | regrade | revoke | destroy | checkpoint | observe

	// issue
	ID            string   `json:"id,omitempty"`
	File          string   `json:"file,omitempty"`
	Grade         string   `json:"grade,omitempty"`
	IssuerOrg     string   `json:"issuerOrg,omitempty"`
	BRMPath       string   `json:"brmPath,omitempty"`
	BasisClause   int      `json:"basisClause,omitempty"`
	Keywords      []string `json:"keywords,omitempty"`
	ApprovalState string   `json:"approvalState,omitempty"`
	Parent        string   `json:"parent,omitempty"`
	Transform     string   `json:"transform,omitempty"`
	Semantic      bool     `json:"semantic,omitempty"`
	NotAfterDays  int      `json:"notAfterDays,omitempty"`

	// regrade / revoke / destroy / observe
	Doc    string `json:"doc,omitempty"`
	Reason string `json:"reason,omitempty"`

	// observe
	Kind            string    `json:"kind,omitempty"`
	From            string    `json:"from,omitempty"`
	To              string    `json:"to,omitempty"`
	TranslatedGrade string    `json:"translatedGrade,omitempty"`
	Treaty          string    `json:"treaty,omitempty"`
	VerdictHint     string    `json:"verdictHint,omitempty"`
	Note            string    `json:"note,omitempty"`
	At              time.Time `json:"at,omitempty"`
}

type sampleDoc struct {
	DocGUID     uuid.UUID
	ContentHash string
	Grade       string
	IssuerOrg   string
	Path        string // 샘플 파일 경로(사이드카 갱신용)
}

type sampleReport struct {
	Issued       int      `json:"issued"`
	Events       int      `json:"events"`
	Observations int      `json:"observations"`
	Skipped      int      `json:"skipped"`
	Failed       int      `json:"failed"`
	Log          []string `json:"log"`
}

func (s *Server) handleLoadSamples(w http.ResponseWriter, r *http.Request) {
	if s.cfg.SampleDir == "" {
		writeErr(w, http.StatusBadRequest, "샘플 폴더가 구성되지 않았습니다 (LM_SAMPLE_DIR)")
		return
	}
	raw, err := os.ReadFile(filepath.Join(s.cfg.SampleDir, "manifest.json"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "manifest.json 읽기 실패: "+err.Error())
		return
	}
	var m struct {
		Steps []sampleStep `json:"steps"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		writeErr(w, http.StatusBadRequest, "manifest.json 파싱 실패: "+err.Error())
		return
	}

	rep := &sampleReport{}
	docs := map[string]*sampleDoc{}
	ctx := r.Context()
	for i, st := range m.Steps {
		var line string
		var ok bool
		switch st.Type {
		case "issue":
			line, ok = s.sampleIssue(ctx, &st, docs, rep)
		case "regrade", "revoke", "destroy":
			line, ok = s.sampleEvent(ctx, &st, docs, rep)
		case "checkpoint":
			line, ok = s.sampleCheckpoint(ctx, rep)
		case "observe":
			line, ok = s.sampleObserve(ctx, &st, docs, rep)
		default:
			line, ok = fmt.Sprintf("알 수 없는 단계 type=%q", st.Type), false
		}
		if !ok {
			rep.Failed++
		}
		rep.Log = append(rep.Log, fmt.Sprintf("[%02d] %s", i+1, line))
	}
	writeJSON(w, http.StatusOK, rep)
}

// loopback 은 서버 자신의 핸들러를 프로세스 안에서 호출한다.
func (s *Server) loopback(method, path string, body interface{}, headers map[string]string) (int, []byte) {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if len(s.cfg.APIKeys) > 0 {
		req.Header.Set("X-LM-Key", s.cfg.APIKeys[0])
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func errMsg(b []byte) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(b, &e) == nil && e.Error != "" {
		return e.Error
	}
	return strings.TrimSpace(string(b))
}

func (s *Server) sampleIssue(ctx context.Context, st *sampleStep, docs map[string]*sampleDoc, rep *sampleReport) (string, bool) {
	if st.ID == "" || st.File == "" {
		return "issue: id·file 필수", false
	}
	path := filepath.Join(s.cfg.SampleDir, filepath.FromSlash(st.File))
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Sprintf("issue %s: 파일 읽기 실패 %v", st.ID, err), false
	}
	head := data
	if len(head) > 16 {
		head = head[:16]
	}
	attacher, res := attach.Resolve(path, head)
	hash, err := attacher.HashTarget(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Sprintf("issue %s: 해시 계산 실패 %v", st.ID, err), false
	}
	hashHex := hex.EncodeToString(hash)

	req := IssueRequest{
		ContentHash:   hashHex,
		Grade:         st.Grade,
		BasisClause:   st.BasisClause,
		BasisKeywords: st.Keywords,
		BRMPath:       st.BRMPath,
		ApprovalState: st.ApprovalState,
		NotAfterDays:  st.NotAfterDays,
		IssuerOrg:     st.IssuerOrg,
		Filename:      filepath.Base(path),
		Attach:        &AttachDecl{Method: string(attach.MethodLedgerOnly), FormatID: res.Format.ID},
	}
	if text, ok := fingerprint.ExtractText(path, data); ok {
		req.Fingerprint = &FingerprintDecl{MinHash: base64.StdEncoding.EncodeToString(fingerprint.Encode(fingerprint.FromText(text)))}
		if th, ok := fingerprint.TextHash(path, data); ok {
			req.TextHash = hex.EncodeToString(th)
		}
		if st.Semantic && s.cfg.DocsimBin != "" {
			if fp, err := docsimFingerprintText(s.cfg.DocsimBin, s.cfg.DocsimDir, text); err == nil {
				req.DocsimFp = fp
			} else {
				s.log.Warn("sample docsim fingerprint failed", "id", st.ID, "err", err)
			}
		}
	}
	if st.Parent != "" {
		p, ok := docs[st.Parent]
		if !ok {
			return fmt.Sprintf("issue %s: 부모 %q 미발급", st.ID, st.Parent), false
		}
		tr := st.Transform
		if tr == "" {
			tr = "edit"
		}
		req.Lineage = &LineageDecl{ParentHash: p.ContentHash, Transform: tr}
		// 부모보다 낮은 등급의 파생은 승인 토큰이 필요하다(상속 규칙) — 샘플은 운영 토큰을 쓴다.
		req.ApprovalToken = s.cfg.RegradeApprovalToken
	}
	idem := "sample:" + st.ID + ":" + hashHex[:16]
	code, body := s.loopback(http.MethodPost, "/v1/labels", req, map[string]string{"Idempotency-Key": idem})
	if code != http.StatusCreated {
		return fmt.Sprintf("issue %s (%s): HTTP %d %s", st.ID, st.File, code, errMsg(body)), false
	}
	var resp IssueResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Sprintf("issue %s: 응답 파싱 실패", st.ID), false
	}
	docGUID, _ := uuid.Parse(resp.DocGUID)
	docs[st.ID] = &sampleDoc{DocGUID: docGUID, ContentHash: hashHex, Grade: st.Grade, IssuerOrg: st.IssuerOrg, Path: path}
	rep.Issued++
	// 사이드카(.lmsig)를 파일 옆에 남긴다 — 샘플 파일은 건드리지 않고, 검증 데모에서
	// 파일+사이드카를 함께 쓰면 서명까지 valid 로 확인된다(없으면 signature=absent).
	if resp.LabelDER != "" {
		if der, err := base64.StdEncoding.DecodeString(resp.LabelDER); err == nil {
			if _, err := os.Stat(path + ".lmsig"); err != nil {
				_ = os.WriteFile(path+".lmsig", der, 0o644)
			}
		}
	}
	return fmt.Sprintf("issue %s: %s 등급 %s seq %d docGuid %s", st.ID, filepath.Base(path), st.Grade, resp.LedgerSeq, resp.DocGUID[:8]), true
}

func (s *Server) sampleEvent(ctx context.Context, st *sampleStep, docs map[string]*sampleDoc, rep *sampleReport) (string, bool) {
	d, ok := docs[st.Doc]
	if !ok {
		return fmt.Sprintf("%s: 문서 %q 미발급", st.Type, st.Doc), false
	}
	latest, err := s.cfg.Store.LatestByDoc(ctx, d.DocGUID)
	if err != nil || latest == nil {
		return fmt.Sprintf("%s %s: 원장 조회 실패", st.Type, st.Doc), false
	}
	var code int
	var body []byte
	switch st.Type {
	case "regrade":
		if latest.Type == ledger.EventRegrade && latest.Grade == st.Grade {
			rep.Skipped++
			return fmt.Sprintf("regrade %s: 이미 %s — 건너뜀", st.Doc, st.Grade), true
		}
		code, body = s.loopback(http.MethodPost, "/v1/labels/"+d.DocGUID.String()+"/regrade",
			map[string]string{"grade": st.Grade, "approvalToken": s.cfg.RegradeApprovalToken, "reason": st.Reason}, nil)
	case "revoke":
		if latest.Type == ledger.EventRevoke || latest.Type == ledger.EventDestroy {
			rep.Skipped++
			return fmt.Sprintf("revoke %s: 이미 폐기·파기 — 건너뜀", st.Doc), true
		}
		code, body = s.loopback(http.MethodPost, "/v1/labels/"+d.DocGUID.String()+"/revoke",
			map[string]string{"reason": st.Reason}, nil)
	case "destroy":
		if latest.Type == ledger.EventDestroy {
			rep.Skipped++
			return fmt.Sprintf("destroy %s: 이미 파기 — 건너뜀", st.Doc), true
		}
		code, body = s.loopback(http.MethodPost, "/v1/labels/"+d.DocGUID.String()+"/destroy",
			map[string]string{"reason": st.Reason, "approvalToken": s.cfg.DestroyApprovalToken}, nil)
	}
	if code < 200 || code >= 300 {
		return fmt.Sprintf("%s %s: HTTP %d %s", st.Type, st.Doc, code, errMsg(body)), false
	}
	if st.Type == "regrade" {
		d.Grade = st.Grade
		// 등급변경은 새 라벨 발급이다 — 사이드카를 최신 라벨로 바꿔 두어야 검증 시
		// "구 버전(superseded)"이 아니라 현재 등급으로 읽힌다.
		var resp IssueResponse
		if json.Unmarshal(body, &resp) == nil && resp.LabelDER != "" && d.Path != "" {
			if der, err := base64.StdEncoding.DecodeString(resp.LabelDER); err == nil {
				_ = os.WriteFile(d.Path+".lmsig", der, 0o644)
			}
		}
	}
	rep.Events++
	return fmt.Sprintf("%s %s: 기록", st.Type, st.Doc), true
}

func (s *Server) sampleCheckpoint(ctx context.Context, rep *sampleReport) (string, bool) {
	tip, _, err := s.cfg.Store.Tip(ctx)
	if err != nil {
		return "checkpoint: 원장 조회 실패", false
	}
	if last, err := s.cfg.Store.LatestCheckpoint(ctx); err == nil && last != nil && last.ToSeq >= tip {
		rep.Skipped++
		return fmt.Sprintf("checkpoint: seq %d 까지 이미 봉인 — 건너뜀", last.ToSeq), true
	}
	code, body := s.loopback(http.MethodPost, "/v1/checkpoints", map[string]int64{}, nil)
	if code != http.StatusCreated {
		return fmt.Sprintf("checkpoint: HTTP %d %s", code, errMsg(body)), false
	}
	rep.Events++
	return fmt.Sprintf("checkpoint: seq %d 까지 봉인", tip), true
}

func (s *Server) sampleObserve(ctx context.Context, st *sampleStep, docs map[string]*sampleDoc, rep *sampleReport) (string, bool) {
	d, ok := docs[st.Doc]
	if !ok {
		return fmt.Sprintf("observe: 문서 %q 미발급", st.Doc), false
	}
	kind := strings.ToUpper(st.Kind)
	from, to := strings.ToUpper(st.From), strings.ToUpper(st.To)
	existing, err := s.cfg.Store.Observations(ctx, store.ObservationFilter{DocGUID: &d.DocGUID, Kind: kind, FromOrg: from, ToOrg: to})
	if err != nil {
		return "observe: 조회 실패", false
	}
	for _, o := range existing {
		if o.ObservedAt.Equal(st.At) {
			rep.Skipped++
			return fmt.Sprintf("observe %s %s→%s %s: 이미 기록 — 건너뜀", kind, from, to, st.Doc), true
		}
	}
	ch, _ := hex.DecodeString(d.ContentHash)
	grade := st.Grade
	if grade == "" {
		grade = d.Grade
	}
	o := &store.Observation{
		Kind: kind, DocGUID: d.DocGUID, ContentHash: ch, FromOrg: from, ToOrg: to,
		Grade: grade, TranslatedGrade: st.TranslatedGrade, Treaty: st.Treaty, VerdictHint: st.VerdictHint,
		Actor: "sample-loader", Note: st.Note, ObservedAt: st.At,
	}
	if err := s.cfg.Store.InsertObservation(ctx, o); err != nil {
		return fmt.Sprintf("observe %s: 기록 실패 %v", st.Doc, err), false
	}
	rep.Observations++
	return fmt.Sprintf("observe %s %s→%s %s", kind, from, to, st.Doc), true
}
