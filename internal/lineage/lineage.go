// Package lineage 는 선언적 계보(족보) 조회를 구현한다 (Phase 1).
// 관찰적 계보(MinHash/LSH·TLSH 지문)는 Phase 2다.
package lineage

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/innotium/ledgermarker/internal/ledger"
)

// Reader 는 계보 조회가 필요로 하는 원장 접근 계약이다.
type Reader interface {
	LatestByDoc(ctx context.Context, docGUID uuid.UUID) (*ledger.Event, error)
	EventsByContentHash(ctx context.Context, hash []byte) ([]ledger.Event, error)
	ChildrenOf(ctx context.Context, contentHash []byte) ([]ledger.Event, error)
}

// Node 는 가계도의 문서 노드다.
type Node struct {
	DocGUID       string    `json:"docGuid"`
	ContentHash   string    `json:"contentHash"` // hex
	Grade         string    `json:"grade,omitempty"`
	ApprovalState string    `json:"approvalState,omitempty"`
	IssuerOrg     string    `json:"issuerOrg,omitempty"`
	Revoked       bool      `json:"revoked"`
	CreatedAt     time.Time `json:"createdAt"`
	Seq           int64     `json:"seq"`
}

// Edge 는 부모 → 자식 파생 관계다.
type Edge struct {
	From      string `json:"from"` // 부모 docGuid
	To        string `json:"to"`   // 자식 docGuid
	Transform string `json:"transform,omitempty"`
}

// Graph 는 계보 DAG 조회 결과다.
type Graph struct {
	Target string `json:"target"`
	Root   string `json:"rootDocId,omitempty"`
	Nodes  []Node `json:"nodes"`
	Edges  []Edge `json:"edges"`
}

// Query 는 docGUID를 중심으로 direction("up"|"down"|"both") 방향으로
// depth 세대까지 계보를 탐색한다.
func Query(ctx context.Context, r Reader, docGUID uuid.UUID, depth int, direction string) (*Graph, error) {
	if depth <= 0 {
		depth = 10
	}
	start, err := r.LatestByDoc(ctx, docGUID)
	if err != nil {
		return nil, fmt.Errorf("lineage: read target: %w", err)
	}
	if start == nil {
		return nil, fmt.Errorf("lineage: document %s not found", docGUID)
	}

	g := &Graph{Target: docGUID.String()}
	if start.RootDocID != uuid.Nil {
		g.Root = start.RootDocID.String()
	}
	seen := map[string]bool{}
	addNode(g, seen, start)

	if direction == "up" || direction == "both" || direction == "" {
		if err := walkUp(ctx, r, g, seen, start, depth); err != nil {
			return nil, err
		}
	}
	if direction == "down" || direction == "both" || direction == "" {
		if err := walkDown(ctx, r, g, seen, start, depth); err != nil {
			return nil, err
		}
	}
	return g, nil
}

func walkUp(ctx context.Context, r Reader, g *Graph, seen map[string]bool, e *ledger.Event, depth int) error {
	if depth == 0 || len(e.ParentHash) == 0 {
		return nil
	}
	parents, err := r.EventsByContentHash(ctx, e.ParentHash)
	if err != nil {
		return fmt.Errorf("lineage: walk up: %w", err)
	}
	var parent *ledger.Event
	for i := len(parents) - 1; i >= 0; i-- {
		if parents[i].Type != ledger.EventRevoke {
			parent = &parents[i]
			break
		}
	}
	if parent == nil {
		return nil
	}
	addNode(g, seen, parent)
	addEdge(g, parent.DocGUID.String(), e.DocGUID.String(), e.Transform)
	return walkUp(ctx, r, g, seen, parent, depth-1)
}

func walkDown(ctx context.Context, r Reader, g *Graph, seen map[string]bool, e *ledger.Event, depth int) error {
	if depth == 0 {
		return nil
	}
	children, err := r.ChildrenOf(ctx, e.ContentHash)
	if err != nil {
		return fmt.Errorf("lineage: walk down: %w", err)
	}
	for i := range children {
		c := &children[i]
		if c.Type == ledger.EventRevoke {
			continue
		}
		addNode(g, seen, c)
		addEdge(g, e.DocGUID.String(), c.DocGUID.String(), c.Transform)
		if err := walkDown(ctx, r, g, seen, c, depth-1); err != nil {
			return err
		}
	}
	return nil
}

func addNode(g *Graph, seen map[string]bool, e *ledger.Event) {
	id := e.DocGUID.String()
	if seen[id] {
		return
	}
	seen[id] = true
	g.Nodes = append(g.Nodes, Node{
		DocGUID:       id,
		ContentHash:   hex.EncodeToString(e.ContentHash),
		Grade:         e.Grade,
		ApprovalState: e.ApprovalState,
		IssuerOrg:     e.IssuerOrg,
		Revoked:       e.Type == ledger.EventRevoke,
		CreatedAt:     e.CreatedAt,
		Seq:           e.Seq,
	})
}

func addEdge(g *Graph, from, to, transform string) {
	for _, e := range g.Edges {
		if e.From == from && e.To == to {
			return
		}
	}
	g.Edges = append(g.Edges, Edge{From: from, To: to, Transform: transform})
}
