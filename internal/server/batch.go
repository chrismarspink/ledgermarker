package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

// 배치 소급 라벨링 (POST /v1/batch/scan) — 비동기, jobId 반환.
// Phase 1은 인메모리 작업 큐다. ✎ 소급 라벨링 대상 규모 확정 후
// 영속 큐 필요 여부를 재검토한다 (DEV SPEC §13-7).

type batchItemResult struct {
	ContentHash string `json:"contentHash"`
	DocGUID     string `json:"docGuid,omitempty"`
	LabelDER    string `json:"labelData,omitempty"`
	LedgerSeq   int64  `json:"ledgerSeq,omitempty"`
	Error       string `json:"error,omitempty"`
}

type batchJob struct {
	ID        string            `json:"jobId"`
	State     string            `json:"state"` // running | done
	Total     int               `json:"total"`
	Done      int               `json:"done"`
	Failed    int               `json:"failed"`
	StartedAt time.Time         `json:"startedAt"`
	Results   []batchItemResult `json:"results,omitempty"`
}

type jobRegistry struct {
	mu   sync.RWMutex
	jobs map[string]*batchJob
}

func newJobRegistry() *jobRegistry {
	return &jobRegistry{jobs: map[string]*batchJob{}}
}

func (r *jobRegistry) put(j *batchJob) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.jobs[j.ID] = j
}

func (r *jobRegistry) get(id string) *batchJob {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.jobs[id]
}

func (s *Server) handleBatchScan(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []IssueRequest `json:"items"`
	}
	if err := readJSON(r, &req); err != nil || len(req.Items) == 0 {
		writeErr(w, http.StatusBadRequest, "items is required")
		return
	}
	job := &batchJob{
		ID:        uuid.NewString(),
		State:     "running",
		Total:     len(req.Items),
		StartedAt: time.Now().UTC(),
	}
	s.jobs.put(job)

	items := req.Items
	go func() {
		ctx := context.Background()
		for i := range items {
			res := batchItemResult{ContentHash: items[i].ContentHash}
			resp, _, err := s.issueLabel(ctx, &items[i], "batch:"+job.ID)
			s.jobs.mu.Lock()
			if err != nil {
				job.Failed++
				res.Error = err.Error()
			} else {
				res.DocGUID = resp.DocGUID
				res.LabelDER = resp.LabelDER
				res.LedgerSeq = resp.LedgerSeq
			}
			job.Done++
			job.Results = append(job.Results, res)
			if job.Done == job.Total {
				job.State = "done"
			}
			s.jobs.mu.Unlock()
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": job.ID})
}

func (s *Server) handleBatchStatus(w http.ResponseWriter, r *http.Request) {
	job := s.jobs.get(r.PathValue("jobId"))
	if job == nil {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	s.jobs.mu.RLock()
	defer s.jobs.mu.RUnlock()
	writeJSON(w, http.StatusOK, job)
}
