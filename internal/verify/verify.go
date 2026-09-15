// Package verify 는 검증 L1(서명)·L2(원장)와 폴백 검증을 구현한다.
//
// 불변식 4 (귀속·판정 분리): 이 패키지는 "이 문서가 무엇인가"만 답한다.
// Result.VerdictHint는 참고값일 뿐이며, 통과 여부는 호출자(게이트) 정책이 정한다.
package verify

import (
	"bytes"
	"context"
	"crypto/x509"
	"fmt"
	"time"

	"github.com/google/uuid"

	lmcrypto "github.com/innotium/ledgermarker/internal/crypto"
	"github.com/innotium/ledgermarker/internal/issue"
	"github.com/innotium/ledgermarker/internal/ledger"
)

// 체크 항목 값 (DEV SPEC §6.3)
const (
	SigValid       = "valid"
	SigInvalid     = "invalid"
	SigAbsent      = "absent"
	SigUntrustedCA = "untrusted_ca"

	LedgerRegistered   = "registered"
	LedgerUnregistered = "unregistered" // 조회했으나 없음 → 미등록 판정
	LedgerUnavailable  = "unavailable"  // 접속 불가 → 판단 보류. 혼동 금지!

	RevNone       = "none"
	RevRevoked    = "revoked"
	RevSuperseded = "superseded"

	ValInWindow = "in_window"
	ValExpired  = "expired"
	ValNotYet   = "not_yet"

	TreatyNotApplicable = "not_applicable"

	HintAllow  = "allow"
	HintDeny   = "deny"
	HintReview = "review"
)

// LedgerReader 는 검증이 필요로 하는 원장 조회 계약이다.
type LedgerReader interface {
	// EventsByContentHash 는 해당 해시의 이벤트를 seq 오름차순으로 반환한다.
	// 원장 접속 불가 시 에러를 반환한다("없음"은 빈 슬라이스 + nil 에러).
	EventsByContentHash(ctx context.Context, hash []byte) ([]ledger.Event, error)
	// EventsByTextHash 는 텍스트 해시(2차 식별자)로 조회한다.
	EventsByTextHash(ctx context.Context, textHash []byte) ([]ledger.Event, error)
	// LatestByDoc 은 문서의 최신 이벤트를 반환한다. 없으면 (nil, nil).
	LatestByDoc(ctx context.Context, docGUID uuid.UUID) (*ledger.Event, error)
}

// Params 는 검증 입력이다 (POST /v1/verify).
type Params struct {
	LabelDER    []byte // 없으면 폴백 검증(해시만으로 조회)
	ContentHash []byte // 필수
	// TextHash 는 정규화 본문 텍스트 해시(선택) — 원시 해시가 미등록일 때
	// 재저장·재압축본을 정확 재식별하는 2차 색인 (SigNET H-5 흡수).
	TextHash []byte
	Level    int // 1=로컬, 2=원장, 3=상호(Phase 2)
}

// Deps 는 검증 의존성이다.
type Deps struct {
	Ledger         LedgerReader
	Roots          *x509.CertPool
	RevokedSerials map[string]bool
	CMS            lmcrypto.Verifier
	Now            func() time.Time // nil이면 time.Now
}

// Attribution 은 "이 문서가 무엇인가"에 대한 답이다.
type Attribution struct {
	DocGUID       string  `json:"docGuid,omitempty"`
	Grade         string  `json:"grade,omitempty"`
	ApprovalState string  `json:"approvalState,omitempty"`
	IssuerOrg     string  `json:"issuerOrg,omitempty"`
	RootDocID     string  `json:"rootDocId,omitempty"`
	Confidence    float64 `json:"confidence"` // 선언적=1.0, 지문추정=0~1 (Phase 2)
}

// Checks 는 5개 검증 항목이다. 단순 O/X로 합치지 말 것 (§8.3).
type Checks struct {
	Signature  string `json:"signature"`
	Ledger     string `json:"ledger"`
	Revocation string `json:"revocation"`
	Validity   string `json:"validity"`
	Treaty     string `json:"treaty"`
}

// Result 는 검증 응답이다.
type Result struct {
	Attribution     Attribution `json:"attribution"`
	Checks          Checks      `json:"checks"`
	TranslatedGrade string      `json:"translatedGrade,omitempty"`
	// VerdictHint는 참고값이다. 호출자가 무시할 수 있어야 하며,
	// LM은 차단을 강제하지 않는다. 판정처럼 쓰지 말 것.
	VerdictHint string   `json:"verdictHint"`
	Reasons     []string `json:"reasons"`
}

// Run 은 검증을 수행한다.
func Run(ctx context.Context, deps Deps, p Params) (*Result, error) {
	if len(p.ContentHash) != 32 {
		return nil, fmt.Errorf("verify: contentHash must be 32 bytes")
	}
	if p.Level == 0 {
		p.Level = 2
	}
	now := time.Now
	if deps.Now != nil {
		now = deps.Now
	}

	res := &Result{
		Checks: Checks{
			Signature:  SigAbsent,
			Ledger:     LedgerUnavailable,
			Revocation: RevNone,
			Validity:   ValInWindow,
			Treaty:     TreatyNotApplicable, // 협정은 Phase 2
		},
	}

	// ── 라벨 파싱 (평문 signedAttributes — 복호화 불필요) ──
	var lbl *issue.Label
	if len(p.LabelDER) > 0 {
		l, err := issue.Parse(p.LabelDER)
		if err != nil {
			res.Checks.Signature = SigInvalid
			res.Reasons = append(res.Reasons, "label_parse_failed")
		} else if !bytes.Equal(l.ContentHash, p.ContentHash) {
			// 라벨이 다른 문서의 것 — 바꿔치기
			res.Checks.Signature = SigInvalid
			res.Reasons = append(res.Reasons, "label_content_hash_mismatch")
		} else {
			lbl = l
		}
	}

	// ── L2: 원장 조회 ──
	var matched *ledger.Event // 제시된 해시에 대응하는 원장 이벤트
	var latest *ledger.Event  // 해당 문서의 최신 이벤트
	if p.Level >= 2 && deps.Ledger != nil {
		events, err := deps.Ledger.EventsByContentHash(ctx, p.ContentHash)
		if err != nil {
			// 접속 불가: 판단 보류. "미등록"과 절대 혼동하지 말 것.
			res.Checks.Ledger = LedgerUnavailable
			res.Reasons = append(res.Reasons, "ledger_unavailable")
		} else if len(events) == 0 && len(p.TextHash) == 32 {
			// 원시 해시 미등록 → 텍스트 해시 2차 조회: 재저장·재압축으로
			// 바이트가 바뀐 파일을 정확 재식별한다 (본문 텍스트 동일).
			tevents, terr := deps.Ledger.EventsByTextHash(ctx, p.TextHash)
			if terr == nil && len(tevents) > 0 {
				events = tevents
				res.Reasons = append(res.Reasons, "reidentified_by_text_hash")
			} else {
				res.Checks.Ledger = LedgerUnregistered
				res.Reasons = append(res.Reasons, "ledger_unregistered")
			}
		} else if len(events) == 0 {
			res.Checks.Ledger = LedgerUnregistered
			res.Reasons = append(res.Reasons, "ledger_unregistered")
		}
		if len(events) > 0 {
			res.Checks.Ledger = LedgerRegistered
			res.Reasons = append(res.Reasons, "ledger_registered")
			// 제시된 라벨과 정확히 일치하는 발급 이벤트를 우선 매칭한다 —
			// 구 라벨 제시 시 superseded 판정이 가능해야 한다 (T10).
			if len(p.LabelDER) > 0 {
				for i := len(events) - 1; i >= 0; i-- {
					if bytes.Equal(events[i].LabelDER, p.LabelDER) {
						matched = &events[i]
						break
					}
				}
			}
			// 폴백: 이 해시의 가장 최근 발급성 이벤트(ISSUE/REGRADE/DERIVE)
			if matched == nil {
				for i := len(events) - 1; i >= 0; i-- {
					if events[i].Type.IsIssuance() {
						matched = &events[i]
						break
					}
				}
			}
			if matched == nil {
				matched = &events[len(events)-1]
			}
			l, err := deps.Ledger.LatestByDoc(ctx, matched.DocGUID)
			if err == nil && l != nil {
				latest = l
			}
		}
	} else {
		// L1: 원장을 조회하지 않음 — unavailable로 표기 (검증 실패가 아님)
		res.Reasons = append(res.Reasons, "ledger_not_checked_level1")
	}

	// ── 폐기·대체 판정 (원장 이벤트 기준 — 라벨 폐기는 인증서 폐기와 별개) ──
	if matched != nil && latest != nil {
		switch {
		case latest.Type == ledger.EventDestroy:
			// 파기됨: 사본이 유통 중이라는 뜻 — 원장 증적이 차단 근거다.
			res.Checks.Revocation = RevRevoked
			res.Reasons = append(res.Reasons, "destroyed")
		case latest.Type == ledger.EventRevoke:
			res.Checks.Revocation = RevRevoked
			res.Reasons = append(res.Reasons, "label_revoked")
		case latest.Seq > matched.Seq:
			// 같은 문서에 더 새로운 발급(REGRADE/재발급)이 있다
			res.Checks.Revocation = RevSuperseded
			res.Reasons = append(res.Reasons, "label_superseded")
		}
	}

	// ── L1: 서명 검증 ──
	if lbl != nil && res.Checks.Signature != SigInvalid {
		cms := deps.CMS
		if cms == nil {
			cms = &CMSVerifier{}
		}
		// 키 유출 규칙 (§5.4): 기준 시각은 원장 등록 시점.
		// 원장에 없으면 라벨이 주장하는 발급 시각으로 검증하되,
		// 인증서 폐기 시 위조로 판정한다.
		at := lbl.IssuedAt
		if matched != nil {
			at = matched.CreatedAt
		}
		vr, err := cms.Verify(ctx, p.LabelDER, lmcrypto.VerifyOpts{
			Content:        p.ContentHash,
			Roots:          deps.Roots,
			At:             at,
			RevokedSerials: deps.RevokedSerials,
		})
		switch {
		case err != nil || !vr.SignatureValid:
			res.Checks.Signature = SigInvalid
			res.Reasons = append(res.Reasons, "signature_invalid")
		case deps.Roots != nil && !vr.ChainValid:
			res.Checks.Signature = SigUntrustedCA
			res.Reasons = append(res.Reasons, "signer_ca_untrusted")
		case vr.CertRevoked && matched == nil:
			// 폐기된 키로 만든, 원장에 없는 서명 → 위조 판정 (T8)
			res.Checks.Signature = SigInvalid
			res.Reasons = append(res.Reasons, "signer_cert_revoked_unregistered_forgery")
		case vr.CertRevoked && matched != nil:
			// 원장 등록 시점이 인증서 유효기간 내이면 유효 (T7)
			if matched.CreatedAt.After(vr.SignerCert.NotBefore) && matched.CreatedAt.Before(vr.SignerCert.NotAfter) {
				res.Checks.Signature = SigValid
				res.Reasons = append(res.Reasons, "signature_valid_at_registration_despite_cert_revocation")
			} else {
				res.Checks.Signature = SigInvalid
				res.Reasons = append(res.Reasons, "signer_cert_revoked_outside_validity")
			}
		default:
			res.Checks.Signature = SigValid
			res.Reasons = append(res.Reasons, "signature_valid")
		}
	} else if lbl == nil && len(p.LabelDER) == 0 {
		res.Reasons = append(res.Reasons, "label_absent_fallback")
	}

	// ── 유효기간 ──
	effective := lbl
	if effective == nil && matched != nil && len(matched.LabelDER) > 0 {
		if l, err := issue.Parse(matched.LabelDER); err == nil {
			effective = l
		}
	}
	nowT := now()
	if effective != nil {
		switch {
		case !effective.IssuedAt.IsZero() && nowT.Before(effective.IssuedAt):
			res.Checks.Validity = ValNotYet
			res.Reasons = append(res.Reasons, "label_not_yet_valid")
		case !effective.NotAfter.IsZero() && nowT.After(effective.NotAfter):
			res.Checks.Validity = ValExpired
			res.Reasons = append(res.Reasons, "label_expired")
		}
	}

	// ── 귀속: 원장 우선, 없으면 라벨 (선언적 = confidence 1.0) ──
	switch {
	case matched != nil:
		res.Attribution = Attribution{
			DocGUID:       matched.DocGUID.String(),
			Grade:         matched.Grade,
			ApprovalState: matched.ApprovalState,
			IssuerOrg:     matched.IssuerOrg,
			Confidence:    1.0,
		}
		if matched.RootDocID != uuid.Nil {
			res.Attribution.RootDocID = matched.RootDocID.String()
		}
		if latest != nil && latest.Type == ledger.EventRegrade && latest.Seq > matched.Seq {
			// 대체된 경우에도 현재 유효 등급을 알려준다
			res.Attribution.Grade = latest.Grade
			res.Attribution.ApprovalState = latest.ApprovalState
		}
	case lbl != nil:
		res.Attribution = Attribution{
			DocGUID:       lbl.DocGUID.String(),
			Grade:         lbl.Grade,
			ApprovalState: lbl.ApprovalStateString(),
			IssuerOrg:     lbl.IssuerOrgID,
			Confidence:    1.0,
		}
		if !isZero(lbl.RootDocID) {
			res.Attribution.RootDocID = lbl.RootDocID.String()
		}
	}
	res.TranslatedGrade = res.Attribution.Grade // 협정 번역은 Phase 2

	// ── 시한부 공개 전환 신호 (lifecycle-policy.md §2) ──
	// disclosureCondition 도래는 자동 공개가 아니라 "재분류 절차 개시" 신호다.
	if effective != nil && !effective.DisclosureCondition.IsZero() &&
		nowT.After(effective.DisclosureCondition) && res.Attribution.Grade == "S" {
		res.Reasons = append(res.Reasons, "disclosure_condition_reached_reclassify")
	}

	// ── verdictHint (참고값 — 게이트 정책이 최종 판정) ──
	res.VerdictHint = hint(res)
	for _, r := range res.Reasons {
		if r == "disclosure_condition_reached_reclassify" && res.VerdictHint == HintAllow {
			res.VerdictHint = HintReview
		}
	}
	if res.Attribution.ApprovalState == "PROVISIONAL" {
		// PROVISIONAL은 기관 내부 통행까지만 유효 (§4.2)
		res.Reasons = append(res.Reasons, "approval_provisional_internal_only")
		if res.VerdictHint == HintAllow {
			res.VerdictHint = HintReview
		}
	}
	return res, nil
}

func hint(r *Result) string {
	switch {
	case r.Checks.Signature == SigInvalid,
		r.Checks.Revocation == RevRevoked,
		r.Checks.Ledger == LedgerUnregistered:
		return HintDeny
	case r.Checks.Signature == SigUntrustedCA,
		r.Checks.Signature == SigAbsent,
		r.Checks.Ledger == LedgerUnavailable,
		r.Checks.Revocation == RevSuperseded,
		r.Checks.Validity != ValInWindow:
		return HintReview
	default:
		return HintAllow
	}
}

func isZero(u uuid.UUID) bool { return u == uuid.Nil }
