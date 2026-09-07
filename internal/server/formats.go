package server

import (
	"encoding/hex"
	"net/http"
	"time"

	"github.com/innotium/ledgermarker/internal/attach"
)

// handleFormats 는 포맷 카탈로그를 노출한다 (작업지시서 §3.1).
// 인증 없이 접근 가능(공개 정보). PWA가 오프라인 캐시 대상으로 쓴다.
func (s *Server) handleFormats(w http.ResponseWriter, r *http.Request) {
	cat, err := attach.Load()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "format catalog unavailable")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("ETag", cat.ETag())
	if r.Header.Get("If-None-Match") == cat.ETag() {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"version":     cat.Version,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"formats":     cat.Formats,
	})
}

// handleFormatsResolve 는 단일 파일 판정이다 (작업지시서 §3.2 — 도움말
// "내 파일 확인" 기능용). 파일을 업로드하지 않는다 — 파일명과 앞부분
// 매직넘버(hex)만 받는다.
func (s *Server) handleFormatsResolve(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filename string `json:"filename"`
		MagicHex string `json:"magicHex,omitempty"`
	}
	if err := readJSON(r, &req); err != nil || req.Filename == "" {
		writeErr(w, http.StatusBadRequest, "filename is required")
		return
	}
	var head []byte
	if req.MagicHex != "" {
		if b, err := hex.DecodeString(req.MagicHex); err == nil {
			head = b
		}
	}
	_, res := attach.Resolve(req.Filename, head)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"formatId":       res.Format.ID,
		"name":           res.Format.Name,
		"method":         res.Method, // 폴백 반영 후 실제 적용 방식
		"declaredMethod": res.Format.Method,
		"location":       res.Format.Location,
		"survivability":  res.Format.Survivability,
		"status":         res.Format.Status,
		"phase":          res.Format.Phase,
		"normalize":      res.Format.Normalize,
		"warning":        res.Format.Warning,
		"notes":          res.Format.Notes,
		"fallbackReason": res.FallbackReason,
	})
}
