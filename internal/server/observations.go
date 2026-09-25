package server

import (
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chrismarspink/ledgermarker/internal/store"
)

// 게이트 관측 로그 API — 기관 간 문서 이동(보냄·수신)과 타 기관 게이트의
// 검증 결과를 기록·조회한다. 원장이 아니라 별도의 추가 전용 로그다:
// 원장은 발급 측 진실, 관측 로그는 게이트가 보고한 사실. 여권 스탬프·기관 간
// 흐름 시각화의 원천이 된다.

type observeRequest struct {
	Kind            string    `json:"kind"` // SENT | RECEIVED | VERIFIED
	DocGUID         string    `json:"docGuid"`
	ContentHash     string    `json:"contentHash,omitempty"`
	FromOrg         string    `json:"fromOrg"`
	ToOrg           string    `json:"toOrg"`
	Grade           string    `json:"grade,omitempty"`
	TranslatedGrade string    `json:"translatedGrade,omitempty"`
	Treaty          string    `json:"treaty,omitempty"`
	VerdictHint     string    `json:"verdictHint,omitempty"`
	Note            string    `json:"note,omitempty"`
	ObservedAt      time.Time `json:"observedAt,omitempty"` // 비면 서버 시각
	Actor           string    `json:"actor,omitempty"`
}

func (s *Server) handleObserve(w http.ResponseWriter, r *http.Request) {
	var req observeRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	o, err := observationFrom(&req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if o.Actor == "" {
		o.Actor = "api"
	}
	if err := s.cfg.Store.InsertObservation(r.Context(), o); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, observationJSON(o))
}

func observationFrom(req *observeRequest) (*store.Observation, error) {
	kind := strings.ToUpper(strings.TrimSpace(req.Kind))
	if kind != "SENT" && kind != "RECEIVED" && kind != "VERIFIED" {
		return nil, errBad("kind must be SENT|RECEIVED|VERIFIED")
	}
	docGUID, err := uuid.Parse(req.DocGUID)
	if err != nil {
		return nil, errBad("invalid docGuid")
	}
	if req.FromOrg == "" || req.ToOrg == "" {
		return nil, errBad("fromOrg and toOrg are required")
	}
	var ch []byte
	if req.ContentHash != "" {
		ch, err = hex.DecodeString(req.ContentHash)
		if err != nil || len(ch) != 32 {
			return nil, errBad("contentHash must be 64 hex chars")
		}
	}
	return &store.Observation{
		Kind: kind, DocGUID: docGUID, ContentHash: ch,
		FromOrg: strings.ToUpper(req.FromOrg), ToOrg: strings.ToUpper(req.ToOrg),
		Grade: req.Grade, TranslatedGrade: req.TranslatedGrade, Treaty: req.Treaty,
		VerdictHint: req.VerdictHint, Note: req.Note, ObservedAt: req.ObservedAt, Actor: req.Actor,
	}, nil
}

type errBad string

func (e errBad) Error() string { return string(e) }

func (s *Server) handleObservations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.ObservationFilter{
		FromOrg: strings.ToUpper(q.Get("fromOrg")),
		ToOrg:   strings.ToUpper(q.Get("toOrg")),
		Kind:    strings.ToUpper(q.Get("kind")),
	}
	f.Limit, _ = strconv.Atoi(q.Get("limit"))
	if f.Limit <= 0 || f.Limit > 5000 {
		f.Limit = 1000
	}
	if d := q.Get("docGuid"); d != "" {
		id, err := uuid.Parse(d)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid docGuid")
			return
		}
		f.DocGUID = &id
	}
	list, err := s.cfg.Store.Observations(r.Context(), f)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "ledger unavailable")
		return
	}
	out := make([]map[string]interface{}, 0, len(list))
	for i := range list {
		out = append(out, observationJSON(&list[i]))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"observations": out})
}

func observationJSON(o *store.Observation) map[string]interface{} {
	m := map[string]interface{}{
		"id": o.ID, "kind": o.Kind, "docGuid": o.DocGUID.String(),
		"fromOrg": o.FromOrg, "toOrg": o.ToOrg, "observedAt": o.ObservedAt, "createdAt": o.CreatedAt,
	}
	if len(o.ContentHash) > 0 {
		m["contentHash"] = hex.EncodeToString(o.ContentHash)
	}
	for k, v := range map[string]string{"grade": o.Grade, "translatedGrade": o.TranslatedGrade,
		"treaty": o.Treaty, "verdictHint": o.VerdictHint, "actor": o.Actor, "note": o.Note} {
		if v != "" {
			m[k] = v
		}
	}
	return m
}
