package treaty

import (
	"context"
	"strings"
	"time"
)

// Static 은 파일에서 로드한 협정 목록을 서빙하는 Service 구현이다.
// Phase 1.5: 협정 데이터 노출·정책 설계용. 협정문 서명(Treaty Signer)과
// 검증 L3 반영은 Phase 2다 — docs/treaty-policy.md 참조.
type Static struct {
	treaties []Treaty
}

var _ Service = (*Static)(nil)

func NewStatic(list []Treaty) *Static {
	return &Static{treaties: list}
}

func (s *Static) List(_ context.Context) ([]Treaty, error) {
	return append([]Treaty{}, s.treaties...), nil
}

// Translate 는 발급 기관 등급을 검증 기관 기준으로 번역한다.
// 협정은 쌍방향으로 적용한다(gradeMap은 PartyA→PartyB 기준, 역방향은 역매핑).
func (s *Static) Translate(_ context.Context, issuerOrg, verifierOrg, grade string) (string, bool, error) {
	now := time.Now()
	for _, t := range s.treaties {
		if now.After(t.NotAfter) || now.Before(t.SignedAt) {
			continue
		}
		a, b := strings.ToUpper(t.PartyA), strings.ToUpper(t.PartyB)
		iss, ver := strings.ToUpper(issuerOrg), strings.ToUpper(verifierOrg)
		switch {
		case iss == a && ver == b:
			if g, ok := t.GradeMap[grade]; ok {
				return g, true, nil
			}
		case iss == b && ver == a:
			for from, to := range t.GradeMap { // 역매핑
				if to == grade {
					return from, true, nil
				}
			}
		}
	}
	return "", false, nil
}
