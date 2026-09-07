// Package attach 는 포맷별 라벨 부착·추출(Attacher) 프레임워크다.
//
// 설계 원칙 (작업지시서 §0): 포맷 정보의 진실 원천은 formats.yaml 하나다.
// Attacher 등록·API 응답·도움말 화면이 전부 이 파일에서 파생된다.
// 미지원 포맷은 자동으로 사이드카로 폴백되어 "지원하지 않는 파일"이
// 존재하지 않는다.
package attach

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

//go:embed formats.yaml
var formatsYAML []byte // 폐쇄망 배포: 런타임 외부 파일 의존 금지 (§1.4)

// Method 는 부착 방식이다.
type Method string

const (
	MethodEmbedded   Method = "embedded"
	MethodContainer  Method = "container"
	MethodSidecar    Method = "sidecar"
	MethodLedgerOnly Method = "ledger_only"
)

// Format 은 formats.yaml 의 한 항목이다.
type Format struct {
	ID            string   `yaml:"id" json:"id"`
	Name          string   `yaml:"name" json:"name"`
	Extensions    []string `yaml:"extensions" json:"extensions"`
	MIME          []string `yaml:"mime" json:"mime,omitempty"`
	Magic         string   `yaml:"magic" json:"magic,omitempty"` // hex 접두
	Method        Method   `yaml:"method" json:"method"`
	Location      string   `yaml:"location" json:"location,omitempty"`
	Survivability string   `yaml:"survivability" json:"survivability"` // A|B|C
	Status        string   `yaml:"status" json:"status"`               // supported|planned|unsupported
	Phase         string   `yaml:"phase" json:"phase,omitempty"`
	Normalize     bool     `yaml:"normalize" json:"normalize"`
	Notes         string   `yaml:"notes" json:"notes,omitempty"`
	Warning       string   `yaml:"warning" json:"warning,omitempty"`
}

// Catalog 는 로드·검증된 포맷 카탈로그다.
type Catalog struct {
	Version int      `yaml:"version" json:"version"`
	Formats []Format `yaml:"formats" json:"formats"`

	byExt map[string]*Format
	etag  string
}

// UnknownFormat 은 카탈로그에 없는 포맷의 합성 항목이다 (§2.2 폴백 규칙 1).
var UnknownFormat = Format{
	ID: "unknown", Name: "미등재 형식", Method: MethodSidecar,
	Survivability: "B", Status: "supported", Phase: "1-a",
	Notes: "카탈로그에 없는 형식 — 사이드카로 부착",
}

// ParseCatalog 는 YAML을 파싱·검증한다. 검증 실패는 서버 기동 실패로
// 이어져야 한다 (§1.4, 수용 기준 A6·A7).
func ParseCatalog(data []byte) (*Catalog, error) {
	var c Catalog
	if err := yaml.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("attach: parse formats.yaml: %w", err)
	}
	c.byExt = map[string]*Format{}
	seenID := map[string]bool{}
	for i := range c.Formats {
		f := &c.Formats[i]
		if f.ID == "" {
			return nil, fmt.Errorf("attach: format #%d: id is empty", i)
		}
		if seenID[f.ID] {
			return nil, fmt.Errorf("attach: duplicate format id %q", f.ID)
		}
		seenID[f.ID] = true
		switch f.Method {
		case MethodEmbedded, MethodContainer:
			if strings.TrimSpace(f.Location) == "" {
				return nil, fmt.Errorf("attach: format %q: method %s requires location", f.ID, f.Method)
			}
		case MethodSidecar, MethodLedgerOnly:
		default:
			return nil, fmt.Errorf("attach: format %q: invalid method %q", f.ID, f.Method)
		}
		switch f.Survivability {
		case "A", "B", "C":
		default:
			return nil, fmt.Errorf("attach: format %q: invalid survivability %q", f.ID, f.Survivability)
		}
		switch f.Status {
		case "supported", "planned", "unsupported":
		default:
			return nil, fmt.Errorf("attach: format %q: invalid status %q", f.ID, f.Status)
		}
		for _, ext := range f.Extensions {
			e := strings.ToLower(ext)
			if !strings.HasPrefix(e, ".") {
				return nil, fmt.Errorf("attach: format %q: extension %q must start with '.'", f.ID, ext)
			}
			if prev, dup := c.byExt[e]; dup {
				return nil, fmt.Errorf("attach: extension %q registered twice (%s, %s)", e, prev.ID, f.ID)
			}
			c.byExt[e] = f
		}
	}
	sum := sha256.Sum256(data)
	c.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
	return &c, nil
}

var (
	loadOnce sync.Once
	loaded   *Catalog
	loadErr  error
)

// Load 는 내장 카탈로그를 1회 파싱·검증해 반환한다.
func Load() (*Catalog, error) {
	loadOnce.Do(func() {
		loaded, loadErr = ParseCatalog(formatsYAML)
	})
	return loaded, loadErr
}

// ETag 는 캐시 검증용 태그다 (GET /v1/formats).
func (c *Catalog) ETag() string { return c.etag }

// ByID 는 id로 포맷을 찾는다. 없으면 nil.
func (c *Catalog) ByID(id string) *Format {
	for i := range c.Formats {
		if c.Formats[i].ID == id {
			return &c.Formats[i]
		}
	}
	return nil
}

// Lookup 은 파일명(확장자)과 파일 앞부분(head)으로 포맷을 찾는다.
// 확장자 우선, 없으면 매직넘버. 못 찾으면 (UnknownFormat 복사본, false).
func (c *Catalog) Lookup(filename string, head []byte) (Format, bool) {
	name := strings.ToLower(filename)
	if i := strings.LastIndex(name, "."); i >= 0 {
		if f, ok := c.byExt[name[i:]]; ok {
			return *f, true
		}
	}
	if len(head) > 0 {
		headHex := strings.ToUpper(hex.EncodeToString(head))
		for i := range c.Formats {
			m := c.Formats[i].Magic
			if m != "" && strings.HasPrefix(headHex, strings.ToUpper(m)) {
				return c.Formats[i], true
			}
		}
	}
	return UnknownFormat, false
}
