// lm 은 배치·소급 라벨링·운영 도구 CLI다 (DEV SPEC §7).
//
// CLI는 고유 로직을 갖지 않는다 — 전부 서버 API 래퍼(sdk 재사용)다.
// 예외: 파일 해시 계산은 클라이언트에서 수행한다(파일을 서버로 보내지 않는다).
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"

	"github.com/chrismarspink/ledgermarker/internal/attach"
	"github.com/chrismarspink/ledgermarker/internal/fingerprint"

	gatesdk "github.com/chrismarspink/ledgermarker/sdk/go"

	"github.com/chrismarspink/ledgermarker/internal/crypto/softhsm"
)

// sidecarExt: 사이드카 파일명 <원본파일명>.lmsig (DER).
// 부착·추출·해시 대상 계산은 전부 internal/attach(포맷 카탈로그 기반)가
// 담당한다 — 포맷 정보의 진실 원천은 formats.yaml 하나다.
const sidecarExt = attach.SidecarExt

// resolveFile 은 파일을 읽고 카탈로그로 Attacher를 해석한다.
func resolveFile(path string) ([]byte, attach.Attacher, attach.Resolution, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, attach.Resolution{}, fmt.Errorf("파일 읽기 %s: %w", path, err)
	}
	head := data
	if len(head) > 16 {
		head = head[:16]
	}
	a, res := attach.Resolve(path, head)
	return data, a, res, nil
}

// hashTargetHex 는 라벨을 제외한 본문 해시(hex)를 계산한다.
func hashTargetHex(a attach.Attacher, data []byte) (string, error) {
	h, err := a.HashTarget(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(h), nil
}

// fingerprintB64 는 텍스트 추출 가능한 형식의 지문(base64 MinHash)을
// 계산한다. 미지원 형식이면 "".
func fingerprintB64(path string, data []byte) string {
	text, ok := fingerprint.ExtractText(path, data)
	if !ok {
		return ""
	}
	return base64.StdEncoding.EncodeToString(fingerprint.Encode(fingerprint.FromText(text)))
}

// textHashHex 는 정규화 본문 텍스트 해시(hex) — 재저장본 재식별용 2차 색인.
func textHashHex(path string, data []byte) string {
	th, ok := fingerprint.TextHash(path, data)
	if !ok {
		return ""
	}
	return hex.EncodeToString(th)
}

// docsimDir 는 docsim 실행 작업 디렉터리다 (config.yaml·mu.npy 위치).
// LM_DOCSIM_DIR 이 없으면 .venv 경로에서 프로젝트 루트를 추정한다.
func docsimDir(bin string) string {
	if d := os.Getenv("LM_DOCSIM_DIR"); d != "" {
		return d
	}
	if i := strings.Index(bin, "/.venv/"); i > 0 {
		return bin[:i]
	}
	return ""
}

// docsimBin 은 docsim 실행 파일 경로다. LM_DOCSIM 이 있으면 그것을, 없으면
// 표준 설치 위치(~/docsim/.venv/bin/docsim)가 존재할 때 그것을 쓴다 — docsim은
// 기본 동작이며, 설치돼 있지 않을 때만 조용히 생략된다.
func docsimBin() string {
	if b := os.Getenv("LM_DOCSIM"); b != "" {
		return b
	}
	if home, err := os.UserHomeDir(); err == nil {
		std := filepath.Join(home, "docsim", ".venv", "bin", "docsim")
		if st, err := os.Stat(std); err == nil && !st.IsDir() {
			return std
		}
	}
	return ""
}

// docsimFingerprint 는 사내 docsim 모듈로 정밀 지문을 계산한다.
// docsim 실행 파일을 찾을 수 있을 때만 동작(docsimBin) —
// docsim 코드는 수정하지 않고 CLI 어댑터로만 결합한다.
func docsimFingerprint(path string) string {
	bin := docsimBin()
	if bin == "" {
		return ""
	}
	tmp, err := os.CreateTemp("", "lm-docsim-*.fp.json")
	if err != nil {
		return ""
	}
	tmp.Close()
	defer os.Remove(tmp.Name())
	abs, _ := filepath.Abs(path)
	cmd := exec.Command(bin, "fingerprint", abs, "-o", tmp.Name())
	cmd.Env = os.Environ()
	cmd.Dir = docsimDir(bin)
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "(docsim 지문 생략: %v)\n", err)
		return ""
	}
	b, err := os.ReadFile(tmp.Name())
	if err != nil {
		return ""
	}
	return string(b)
}

var (
	flagServer string
	flagAPIKey string
)

func client() *gatesdk.Client {
	return gatesdk.New(flagServer, flagAPIKey)
}

func main() {
	root := &cobra.Command{
		Use:           "lm",
		Short:         "LedgerMarker 운영 CLI — 서버 API 래퍼",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().StringVar(&flagServer, "server",
		envOr("LM_SERVER", "http://localhost:8080"), "LM Server 주소")
	root.PersistentFlags().StringVar(&flagAPIKey, "api-key",
		os.Getenv("LM_API_KEY"), "X-LM-Key API 키")

	root.AddCommand(cmdIssue(), cmdScan(), cmdVerify(), cmdIdentify(), cmdRestore(),
		cmdLineage(), cmdRevoke(), cmdRegrade(), cmdDestroy(), cmdLedger(), cmdTrust(), cmdPKI(),
		cmdSend(), cmdReceive())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "오류:", err)
		os.Exit(1)
	}
}

// ── lm issue 문서.hwp --grade S ────────────────────────────
// 단일 파일 라벨 발급. 파일은 수정하지 않고 <파일>.lmsig 사이드카를 만든다.

func cmdIssue() *cobra.Command {
	var req gatesdk.IssueRequest
	var parent, approval string
	var force bool
	var embed bool
	var noSign bool
	c := &cobra.Command{
		Use:   "issue <파일>",
		Short: "단일 파일 라벨 발급 (기본: .lmsig 사이드카, --embed: 파일에 트레일러 내장)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := args[0]
			data, attacher, res, err := resolveFile(path)
			if err != nil {
				return err
			}
			// 재부착 방지: 이미 라벨이 있는가.
			// --force 는 파일을 바꾸지 않고 원장에만 재등록한다 —
			// 인메모리 데모 모드에서 서버 재시작으로 원장이 초기화됐을 때 사용.
			alreadyLabeled := false
			if _, err := attacher.Extract(bytes.NewReader(data), int64(len(data))); err == nil {
				if !force {
					return fmt.Errorf("%s 에는 이미 라벨이 부착되어 있습니다. 원장 재등록은 --force (파일은 변경하지 않음)", path)
				}
				alreadyLabeled = true
			}
			hash, err := hashTargetHex(attacher, data)
			if err != nil {
				return fmt.Errorf("해시 대상 계산: %w", err)
			}
			req.ContentHash = hash
			req.Filename = filepath.Base(path) // 확인용 메타(정체성 무관)
			if noSign {
				no := false
				req.Sign = &no
			}
			// 지문 제출 — 수정본·변환본 재식별(identify)의 색인이 된다
			if fp := fingerprintB64(path, data); fp != "" {
				req.Fingerprint = &gatesdk.FingerprintDecl{MinHash: fp}
			}
			// 텍스트 해시 — 재저장·재압축 후에도 유지되는 2차 식별 색인
			req.TextHash = textHashHex(path, data)
			// docsim 정밀 지문 (LM_DOCSIM 설정 시)
			req.DocsimFp = docsimFingerprint(path)
			if approval != "" {
				req.ApprovalState = strings.ToUpper(approval)
			}
			// --parent: 부모 파일 경로 또는 64자 hex 해시 → 선언적 계보.
			// 부모의 해시도 라벨 제외 본문 기준(HashTarget)으로 계산한다.
			if parent != "" {
				ph := parent
				if len(parent) != 64 {
					pdata, pa, _, err := resolveFile(parent)
					if err != nil {
						return err
					}
					if ph, err = hashTargetHex(pa, pdata); err != nil {
						return fmt.Errorf("부모 해시: %w", err)
					}
				}
				if req.Lineage == nil {
					req.Lineage = &gatesdk.LineageDecl{}
				}
				req.Lineage.ParentHash = ph
			}

			// ── 부착 방식 결정 (발급 전에 확정해 원장에 기록) ──
			method := res.Method
			reason := res.FallbackReason
			var preflight bytes.Buffer // 내장 사전 검사 결과 (본문 보관)
			embedOK := false
			switch {
			case alreadyLabeled:
				// 재등록: 라벨은 이미 파일 안에 있다
				method, reason = attach.MethodEmbedded, ""
			case !embed:
				// 사용자가 내장을 요청하지 않음 → 사이드카 (폴백 아님)
				if method != attach.MethodLedgerOnly {
					method, reason = attach.MethodSidecar, ""
				}
			case res.Method == attach.MethodSidecar:
				// 정책상 사이드카 고정 (예: 코드 서명 실행 파일)
				if res.Format.Warning != "" {
					fmt.Printf("주의: %s\n", res.Format.Warning)
				}
				if res.FallbackReason == "" {
					fmt.Printf("이 형식(%s)은 사이드카 방식만 지원합니다\n", res.Format.Name)
				} else {
					fmt.Printf("이 형식(%s)의 내장은 준비 중 — 사이드카로 폴백합니다\n", res.Format.Name)
				}
			default:
				// 내장 사전 검사(더미 라벨) — 실패해도 발급은 사이드카로 계속 (§2.2-3)
				if err := attacher.Attach(bytes.NewReader(data), &preflight, []byte{0x30}); err != nil {
					fmt.Printf("내장 시도 실패(%v) — 사이드카로 폴백합니다\n", err)
					attacher, res = attach.FallbackToSidecar(res)
					method, reason = res.Method, res.FallbackReason
				} else {
					embedOK = true
				}
			}
			req.Attach = &gatesdk.AttachDecl{
				Method: string(method), FormatID: res.Format.ID, FallbackReason: reason,
			}

			resp, err := client().IssueLabel(context.Background(), req, "issue:"+hash)
			if err != nil {
				return err
			}
			der, err := base64.StdEncoding.DecodeString(resp.LabelDER)
			if err != nil {
				return fmt.Errorf("labelDer 디코드: %w", err)
			}
			switch {
			case noSign:
				// 서명 없이 원장 등록만 — 파일에 붙일 라벨이 없다
				fmt.Printf("원장 등록 완료 (서명 없음 — 검증 시 signature=absent): %s\n", path)
			case alreadyLabeled:
				_ = der
				fmt.Printf("원장 재등록 완료 (기존 라벨 유지): %s\n", path)
			case embedOK:
				var out bytes.Buffer
				if err := attacher.Attach(bytes.NewReader(data), &out, der); err != nil {
					return fmt.Errorf("내장: %w", err)
				}
				if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
					return fmt.Errorf("파일 쓰기: %w", err)
				}
				fmt.Printf("발급 완료 (파일에 내장 — %s): %s\n", res.Format.Location, path)
			default:
				if _, err := os.Stat(path + sidecarExt); err == nil && !force {
					return fmt.Errorf("%s%s 가 이미 있습니다. 재발급하려면 --force", path, sidecarExt)
				}
				if err := writeSidecar(path, resp.LabelDER); err != nil {
					return fmt.Errorf("사이드카 쓰기: %w", err)
				}
				fmt.Printf("발급 완료: %s%s\n", path, sidecarExt)
			}
			fmt.Printf("  docGuid=%s seq=%d 등급=%s 유효기간=%s 형식=%s(%s)\n",
				resp.DocGUID, resp.LedgerSeq, req.Grade,
				resp.NotAfter.Format("2006-01-02"), res.Format.ID, method)
			if reason != "" {
				fmt.Printf("  폴백 사유=%s (원장에 기록됨)\n", reason)
			}
			if resp.RootDocID != "" && resp.RootDocID != resp.DocGUID {
				fmt.Printf("  최초 조상=%s\n", resp.RootDocID)
			}
			return nil
		},
	}
	c.Flags().StringVar(&req.Grade, "grade", "O", "등급 (C|S|O — N2SF, C가 최상위 비밀)")
	c.Flags().IntVar(&req.BasisClause, "basis-clause", 0, "정보공개법 9조 호수 (1~8)")
	c.Flags().StringSliceVar(&req.BasisKeywords, "keyword", nil, "판정 근거 키워드 (반복 지정 가능)")
	c.Flags().StringVar(&req.BRMPath, "brm", "", "업무 분류 경로")
	c.Flags().StringVar(&approval, "approval", "", "승인 상태 (CONFIRMED|PROVISIONAL, 기본 CONFIRMED)")
	c.Flags().StringVar(&req.ApproverRank, "approver-rank", "", "결재권자 직급")
	c.Flags().StringVar(&parent, "parent", "", "부모 문서 (파일 경로 또는 SHA-256 hex) — 선언적 계보")
	c.Flags().StringVar(&req.DocGUID, "doc-guid", "", "docGuid 직접 지정 (기본: 서버 생성)")
	c.Flags().IntVar(&req.NotAfterDays, "not-after-days", 365, "라벨 유효기간(일)")
	c.Flags().BoolVar(&force, "force", false, "기존 사이드카 덮어쓰기(재발급)")
	c.Flags().BoolVar(&embed, "embed", false, "사이드카 대신 파일 끝에 라벨 트레일러 내장 (원본 내용 불변, 검증 시 자동 인식)")
	c.Flags().StringVar(&req.IssuerOrg, "issuer", "", "발급기관 선택 (예: KPOST, INNOTIUM). 기본: 서버 기본 기관")
	c.Flags().BoolVar(&noSign, "no-sign", false, "서명 없이 원장 등록만 (검증 시 signature=absent)")
	transformFlag := c.Flags().String("transform", "edit", "--parent 지정 시 변환 종류 (edit|convert|merge|extract)")
	c.PreRun = func(_ *cobra.Command, _ []string) {
		if parent != "" {
			req.Lineage = &gatesdk.LineageDecl{Transform: *transformFlag}
		}
	}
	return c
}

// ── lm identify 수정본.docx ─────────────────────────────────
// 관찰적 재식별: 해시로 못 찾는 파일(일부 수정본·형식 변환본)을 내용
// 유사도 지문으로 원장의 원본과 연관 짓는다. 결과는 추정 후보다 —
// 귀속 확정은 --parent 계보 선언 등 운영자 판단.

func cmdIdentify() *cobra.Command {
	var limit int
	var deep bool
	c := &cobra.Command{
		Use:   "identify <파일>",
		Short: "유사 문서 재식별 — 수정·변환된 파일의 원본 후보를 지문으로 탐색 + docsim(讀心) 정밀·의미 비교 (--deep=false 로 생략)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := args[0]
			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("파일 읽기: %w", err)
			}
			text, ok := fingerprint.ExtractText(path, data)
			if !ok {
				return fmt.Errorf("이 형식은 텍스트 추출을 지원하지 않습니다 (지원: txt·md·csv·log·docx·pptx·xlsx·hwpx·odt·pdf)")
			}
			mh := base64.StdEncoding.EncodeToString(fingerprint.Encode(fingerprint.FromText(text)))
			cands, err := client().Identify(context.Background(), mh, limit)
			if err != nil {
				return err
			}
			if len(cands) == 0 {
				fmt.Println("유사한 등록 문서를 찾지 못했습니다 (유사도 0.3 미만)")
				return nil
			}
			fmt.Printf("%s 의 원본 후보 %d건 (LSH 후보 → 내용 유사도 순):\n", path, len(cands))
			for i, cd := range cands {
				mark := ""
				if cd.Revoked {
					mark = " [폐기/파기됨]"
				}
				name := cd.Filename
				if name == "" {
					name = "(파일명 없음)"
				}
				fmt.Printf("  %d. 유사도 %.0f%%  %s  등급=%s  docGuid=%s %s%s\n",
					i+1, cd.Similarity*100, name, cd.Grade, cd.DocGUID, cd.IssuerOrg, mark)
			}
			if deep {
				if err := deepCompare(path, cands); err != nil {
					fmt.Fprintf(os.Stderr, "정밀 비교 생략: %v\n", err)
				}
			}
			top := cands[0]
			if top.Similarity >= 0.5 && top.ContentHash != "" {
				fmt.Printf("\n계보로 확정하려면 (파생본 발급):\n  lm issue %s --grade %s --parent %s --transform edit\n",
					path, top.Grade, top.ContentHash)
			}
			return nil
		},
	}
	c.Flags().IntVar(&limit, "limit", 5, "후보 수")
	c.Flags().BoolVar(&deep, "deep", true, "사내 docsim으로 정밀·의미 비교 (기본 켬, docsim 미설치 시 자동 생략; 경로는 LM_DOCSIM)")
	return c
}

// deepCompare 는 2단 구성의 2단계다: LSH로 좁힌 후보를 사내 docsim
// (슁글 + 의미 임베딩 2엔진)으로 정밀 비교한다. 발급 시 저장된 docsim
// 지문(compare-fp)을 쓰므로 후보의 원문이 없어도 된다.
func deepCompare(path string, cands []gatesdk.IdentifyCandidate) error {
	bin := docsimBin()
	if bin == "" {
		return fmt.Errorf("docsim 미설치 (~/docsim/.venv/bin/docsim 없음 — 다른 위치면 LM_DOCSIM=경로)")
	}
	mineFP := docsimFingerprint(path)
	if mineFP == "" {
		return fmt.Errorf("질의 파일의 docsim 지문 생성 실패")
	}
	mine, err := os.CreateTemp("", "lm-deep-mine-*.fp.json")
	if err != nil {
		return err
	}
	defer os.Remove(mine.Name())
	mine.WriteString(mineFP)
	mine.Close()

	fmt.Println("\ndocsim(讀心) 정밀 비교 (엔진A 슁글 / 엔진B 의미):")
	compared := 0
	for i, cd := range cands {
		if cd.DocsimFp == "" {
			continue
		}
		cf, err := os.CreateTemp("", "lm-deep-cand-*.fp.json")
		if err != nil {
			continue
		}
		cf.WriteString(cd.DocsimFp)
		cf.Close()
		cmd := exec.Command(bin, "compare-fp", mine.Name(), cf.Name(), "--json")
		cmd.Env = os.Environ()
		cmd.Dir = docsimDir(bin)
		out, err := cmd.Output()
		os.Remove(cf.Name())
		if err != nil {
			fmt.Printf("  %d. docGuid=%s — docsim 비교 실패: %v\n", i+1, cd.DocGUID, err)
			continue
		}
		fmt.Printf("  %d. docGuid=%s → %s\n", i+1, cd.DocGUID, summarizeDocsim(out))
		compared++
	}
	if compared == 0 {
		fmt.Println("  (docsim 지문이 저장된 후보가 없습니다 — LM_DOCSIM 설정 상태에서 발급된 문서만 정밀 비교 가능)")
	}
	return nil
}

// summarizeDocsim 은 docsim compare-fp JSON에서 핵심 수치만 추린다.
// 스키마 상세에 의존하지 않도록 알려진 키만 찾아보고, 없으면 원문 일부를 보여준다.
func summarizeDocsim(out []byte) string {
	var m map[string]interface{}
	if err := json.Unmarshal(out, &m); err != nil {
		s := strings.TrimSpace(string(out))
		if len(s) > 160 {
			s = s[:160] + "…"
		}
		return s
	}
	var parts []string
	if v, ok := m["verdict"].(map[string]interface{}); ok {
		if lbl, ok := v["label"].(string); ok && lbl != "" {
			parts = append(parts, "판정="+lbl)
		} else if rel, ok := v["relation"].(string); ok {
			parts = append(parts, "관계="+rel)
		}
	}
	for key, name := range map[string]string{"shingle": "슁글", "embed": "의미"} {
		if e, ok := m[key].(map[string]interface{}); ok {
			for _, k := range []string{"jaccard", "max_cosine", "similarity", "score"} {
				if f, ok := e[k].(float64); ok {
					parts = append(parts, fmt.Sprintf("%s=%.2f", name, f))
					break
				}
			}
		}
	}
	if len(parts) == 0 {
		s := strings.TrimSpace(string(out))
		if len(s) > 160 {
			s = s[:160] + "…"
		}
		return s
	}
	return strings.Join(parts, " · ")
}

// ── lm restore 문서.docx ────────────────────────────────────
// 라벨 복원(재적용): 이름표가 유실된 파일의 해시로 원장에서 라벨 원본을
// 회수해 다시 붙인다 — "식별된 파일에 기존 보안정책 재적용" 시나리오.

func cmdRestore() *cobra.Command {
	var embed bool
	var rehydrate bool
	c := &cobra.Command{
		Use:   "restore <파일>",
		Short: "라벨 복원 — 원장에서 라벨 원본을 회수해 재부착 (기본: .lmsig 사이드카)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := args[0]
			data, attacher, res, err := resolveFile(path)
			if err != nil {
				return err
			}
			if _, err := attacher.Extract(bytes.NewReader(data), int64(len(data))); err == nil {
				return fmt.Errorf("%s 에는 이미 라벨이 부착되어 있습니다 (lm verify로 확인)", path)
			}
			hash, err := hashTargetHex(attacher, data)
			if err != nil {
				return fmt.Errorf("해시 대상 계산: %w", err)
			}
			info, err := client().LabelByHash(context.Background(), hash)
			if err != nil {
				// 원시 해시 미등록 → 텍스트 해시로 재시도 (재저장본 복원)
				if th := textHashHex(path, data); th != "" {
					if tinfo, terr := client().LabelByTextHash(context.Background(), th); terr == nil {
						fmt.Println("원시 해시 미등록 — 텍스트 해시로 재식별했습니다 (재저장·재압축본)")
						info, err = tinfo, nil
					}
				}
				if err != nil {
					// 정확·텍스트 해시 모두 미등록 → 수정본이다.
					// --rehydrate: 지문으로 유사 원본을 식별해 귀속(File ID·등급·태그)을
					// 상속한 새 라벨을 발급·부착한다(재수화).
					if rehydrate {
						return runRehydrate(path, data, hash, attacher, res, embed)
					}
					return fmt.Errorf("원장에 정확·텍스트 해시 기록이 없습니다(수정본으로 보입니다) — 유사 원본 상속 복원은 lm restore %s --rehydrate, 후보 확인은 lm identify %s: %w", path, path, err)
				}
			}
			if info.Destroyed {
				return fmt.Errorf("이 문서는 파기되었습니다(docGuid=%s) — 라벨을 복원하지 않습니다. 사본이라면 회수 대상입니다", info.DocGUID)
			}
			if info.Revoked {
				fmt.Printf("주의: 폐기된 라벨입니다 — 복원해도 검증은 revoked/deny로 판정됩니다\n")
			}
			der, err := base64.StdEncoding.DecodeString(info.LabelDER)
			if err != nil {
				return fmt.Errorf("labelDer 디코드: %w", err)
			}
			if embed && (res.Method == attach.MethodEmbedded || res.Method == attach.MethodContainer) {
				var out bytes.Buffer
				if err := attacher.Attach(bytes.NewReader(data), &out, der); err != nil {
					fmt.Printf("내장 실패(%v) — 사이드카로 복원합니다\n", err)
				} else {
					if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
						return fmt.Errorf("파일 쓰기: %w", err)
					}
					fmt.Printf("라벨 복원 완료 (파일에 내장): %s\n", path)
					fmt.Printf("  docGuid=%s 등급=%s %s (원장 seq %d)\n",
						info.DocGUID, info.Grade, info.IssuerOrg, info.LedgerSeq)
					return nil
				}
			}
			if err := writeSidecar(path, info.LabelDER); err != nil {
				return fmt.Errorf("사이드카 쓰기: %w", err)
			}
			fmt.Printf("라벨 복원 완료: %s%s\n", path, sidecarExt)
			fmt.Printf("  docGuid=%s 등급=%s %s (원장 seq %d)\n",
				info.DocGUID, info.Grade, info.IssuerOrg, info.LedgerSeq)
			return nil
		},
	}
	c.Flags().BoolVar(&embed, "embed", false, "사이드카 대신 파일 안에 재내장 (형식이 지원할 때)")
	c.Flags().BoolVar(&rehydrate, "rehydrate", false, "정확·텍스트 해시가 없으면 지문으로 유사 원본을 찾아 귀속을 상속 복원(재수화)")
	return c
}

// runRehydrate 는 수정본의 정체성을 되살린다: 지문으로 유사 원본을 식별해
// File ID 계보·등급·태그를 상속한 새 서명 라벨을 발급받아(서버 /restore)
// 파일에 부착한다. 원본 라벨을 그대로 재부착하면 해시 불일치로 서명이
// 깨지므로, 수정본 자신의 해시에 결속된 새 라벨이 필요하다.
func runRehydrate(path string, data []byte, hash string, attacher attach.Attacher, res attach.Resolution, embed bool) error {
	mh := fingerprintB64(path, data)
	if mh == "" {
		return fmt.Errorf("이 형식은 지문 추출을 지원하지 않아 재수화할 수 없습니다 (지원: txt·md·docx·pdf 등)")
	}
	rr, err := client().Restore(context.Background(), gatesdk.RestoreRequest{
		ContentHash: hash, TextHash: textHashHex(path, data), MinHash: mh, Apply: true,
	})
	if err != nil {
		return err
	}
	switch rr.Mode {
	case "inherited":
		der, err := base64.StdEncoding.DecodeString(rr.LabelDER)
		if err != nil {
			return fmt.Errorf("라벨 디코드: %w", err)
		}
		fmt.Printf("재수화(상속 복원) 완료 — 유사도 %.0f%%\n", rr.Similarity*100)
		fmt.Printf("  원본 File ID docGuid=%s → 상속 등급=%s\n", rr.ParentDocGUID, rr.Grade)
		fmt.Printf("  새 파생 File ID docGuid=%s rootDocId=%s (원장 seq %d)\n", rr.DocGUID, rr.RootDocID, rr.LedgerSeq)
		if embed && (res.Method == attach.MethodEmbedded || res.Method == attach.MethodContainer) {
			var out bytes.Buffer
			if err := attacher.Attach(bytes.NewReader(data), &out, der); err == nil {
				if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
					return fmt.Errorf("파일 쓰기: %w", err)
				}
				fmt.Printf("  라벨 파일에 내장: %s\n", path)
				return nil
			}
			fmt.Println("  내장 실패 — 사이드카로 복원합니다")
		}
		if err := writeSidecar(path, rr.LabelDER); err != nil {
			return fmt.Errorf("사이드카 쓰기: %w", err)
		}
		fmt.Printf("  라벨 사이드카 복원: %s%s\n", path, sidecarExt)
		return nil
	case "review":
		fmt.Printf("유사 후보를 찾았으나 자동 복원 임계치 미만입니다 (최고 유사도 %.0f%%)\n", rr.Similarity*100)
		for i, c := range rr.Candidates {
			fmt.Printf("  %d. 유사도 %.0f%%  docGuid=%s  등급=%s\n", i+1, c.Similarity*100, c.DocGUID, c.Grade)
		}
		return fmt.Errorf("운영자 확인 후 계보 확정: lm issue %s --grade <등급> --parent <원본해시> --transform edit", path)
	default:
		return fmt.Errorf("유사 원본을 찾지 못했습니다 (재수화 불가)")
	}
}

// ── lm scan ./문서고 --issue --recursive --grade O ─────────

func cmdScan() *cobra.Command {
	var issueFlag, recursive bool
	var grade, gradeFrom string
	var notAfterDays int
	c := &cobra.Command{
		Use:   "scan <디렉터리>",
		Short: "문서고 스캔·소급 라벨링 (사이드카 .lmsig 생성)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if gradeFrom == "api" {
				// ✎ 등급분류 API 인터페이스 규격 확정 필요 (DEV SPEC §13-6)
				return fmt.Errorf("--grade-from=api 는 등급분류 API 규격 확정 후 지원 예정입니다. --grade 를 사용하세요")
			}
			files, err := listFiles(args[0], recursive)
			if err != nil {
				return err
			}
			issued, failed := 0, 0
			for _, path := range files {
				data, attacher, res, err := resolveFile(path)
				if err != nil {
					fmt.Printf("SKIP %s: %v\n", path, err)
					continue
				}
				hash, err := hashTargetHex(attacher, data)
				if err != nil {
					fmt.Printf("SKIP %s: %v\n", path, err)
					continue
				}
				if !issueFlag {
					fmt.Printf("%s  %s  [%s]\n", hash, path, res.Format.ID)
					continue
				}
				req := gatesdk.IssueRequest{
					ContentHash: hash, Grade: grade, NotAfterDays: notAfterDays,
					Filename: filepath.Base(path),
					// scan은 사이드카 일괄 부착 — 폴백 아님
					Attach: &gatesdk.AttachDecl{Method: string(attach.MethodSidecar), FormatID: res.Format.ID},
				}
				if fp := fingerprintB64(path, data); fp != "" {
					req.Fingerprint = &gatesdk.FingerprintDecl{MinHash: fp}
				}
				req.TextHash = textHashHex(path, data)
				// 해시를 멱등키로 써서 재실행해도 원장 행이 중복되지 않게 한다
				resp, err := client().IssueLabel(context.Background(), req, "scan:"+hash)
				if err != nil {
					fmt.Printf("FAIL %s: %v\n", path, err)
					failed++
					continue
				}
				if err := writeSidecar(path, resp.LabelDER); err != nil {
					return fmt.Errorf("사이드카 쓰기 %s: %w", path, err)
				}
				fmt.Printf("OK   %s  docGuid=%s seq=%d\n", path, resp.DocGUID, resp.LedgerSeq)
				issued++
			}
			fmt.Printf("완료: 발급 %d건, 실패 %d건, 대상 %d건\n", issued, failed, len(files))
			return nil
		},
	}
	c.Flags().BoolVar(&issueFlag, "issue", false, "라벨 발급까지 수행")
	c.Flags().BoolVar(&recursive, "recursive", false, "하위 디렉터리 포함")
	c.Flags().StringVar(&grade, "grade", "O", "등급 (S|O)")
	c.Flags().StringVar(&gradeFrom, "grade-from", "", "등급 공급원 (api = 등급분류 API, Phase 1 미지원)")
	c.Flags().IntVar(&notAfterDays, "not-after-days", 365, "라벨 유효기간(일)")
	return c
}

// ── lm verify *.pdf --level 2 --json ───────────────────────

func cmdVerify() *cobra.Command {
	var level int
	var jsonOut bool
	var as string // 검증 기관 페르소나 — 발급 기관과 다르면 협정 번역(L3)
	c := &cobra.Command{
		Use:   "verify <파일...>",
		Short: "배치 검증 (사이드카 자동 탐색, 없으면 폴백 검증)",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			exit := 0
			for _, path := range args {
				data, attacher, _, err := resolveFile(path)
				if err != nil {
					return err
				}
				req := gatesdk.VerifyRequest{Level: level, VerifierOrg: as}
				// 해시 대상은 항상 "라벨 제외 본문" (포맷별 정규화 포함)
				req.ContentHash, err = hashTargetHex(attacher, data)
				if err != nil {
					return fmt.Errorf("해시 대상 계산 %s: %w", path, err)
				}
				// 재저장·재압축본 재식별용 2차 색인
				req.TextHash = textHashHex(path, data)
				// 내장 라벨 우선, 없으면 사이드카
				if der, err := attacher.Extract(bytes.NewReader(data), int64(len(data))); err == nil {
					req.LabelDER = base64.StdEncoding.EncodeToString(der)
				} else if der, err := os.ReadFile(path + sidecarExt); err == nil {
					req.LabelDER = base64.StdEncoding.EncodeToString(der)
				}
				res, err := client().Verify(context.Background(), req)
				if err != nil {
					return fmt.Errorf("검증 %s: %w", path, err)
				}
				if jsonOut {
					out, _ := json.Marshal(map[string]interface{}{"file": path, "result": res})
					fmt.Println(string(out))
				} else {
					printResult(path, res)
				}
				if res.VerdictHint == "deny" {
					exit = 2
				}
			}
			if exit != 0 {
				os.Exit(exit)
			}
			return nil
		},
	}
	c.Flags().IntVar(&level, "level", 2, "검증 레벨 (1=로컬, 2=원장)")
	c.Flags().BoolVar(&jsonOut, "json", false, "JSON 출력")
	c.Flags().StringVar(&as, "as", os.Getenv("LM_ORG"), "검증 기관 페르소나(예: MOIS) — 발급 기관과 다르면 협정으로 등급 번역 (기본 LM_ORG)")
	return c
}

// printResult 는 5개 체크 항목을 각각 표시한다 — 단순 O/X 금지 (DEV SPEC §8.3).
func printResult(path string, r *gatesdk.VerifyResponse) {
	fmt.Printf("── %s\n", path)
	fmt.Printf("   귀속: docGuid=%s 등급=%s 상태=%s 발급기관=%s (confidence %.1f)\n",
		r.Attribution.DocGUID, r.Attribution.Grade, r.Attribution.ApprovalState,
		r.Attribution.IssuerOrg, r.Attribution.Confidence)
	fmt.Printf("   서명=%s  원장=%s  폐기=%s  유효기간=%s  협정=%s\n",
		r.Checks.Signature, r.Checks.Ledger, r.Checks.Revocation,
		r.Checks.Validity, r.Checks.Treaty)
	if r.Checks.Treaty != "not_applicable" {
		fmt.Printf("   기관 간: 발급 %s 등급 %s → 검증 기관 기준 %s\n", r.Attribution.IssuerOrg, r.Attribution.Grade, r.TranslatedGrade)
	}
	fmt.Printf("   참고 판정(verdictHint): %s  [%s]\n", r.VerdictHint, strings.Join(r.Reasons, ", "))
}

// ── lm lineage a_v3.hwp --tree ─────────────────────────────

func cmdLineage() *cobra.Command {
	var tree bool
	var depth int
	c := &cobra.Command{
		Use:   "lineage <파일 | docGuid>",
		Short: "문서 계보(족보) 조회",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			docGUID := args[0]
			if _, err := uuid.Parse(docGUID); err != nil {
				// 파일이면 해시 → 폴백 검증으로 docGuid 귀속
				data, attacher, _, err := resolveFile(args[0])
				if err != nil {
					return fmt.Errorf("docGuid도 파일도 아닙니다: %s", args[0])
				}
				hash, err := hashTargetHex(attacher, data)
				if err != nil {
					return err
				}
				res, err := client().Verify(context.Background(), gatesdk.VerifyRequest{ContentHash: hash, Level: 2})
				if err != nil {
					return err
				}
				if res.Attribution.DocGUID == "" {
					return fmt.Errorf("원장에서 문서를 찾지 못했습니다 (ledger=%s)", res.Checks.Ledger)
				}
				docGUID = res.Attribution.DocGUID
			}
			g, err := client().Lineage(context.Background(), docGUID, depth, "both")
			if err != nil {
				return err
			}
			if tree {
				printTree(g)
				return nil
			}
			out, _ := json.MarshalIndent(g, "", "  ")
			fmt.Println(string(out))
			return nil
		},
	}
	c.Flags().BoolVar(&tree, "tree", false, "ASCII 트리 출력")
	c.Flags().IntVar(&depth, "depth", 10, "탐색 세대 수")
	return c
}

func printTree(g *gatesdk.LineageGraph) {
	nodes := map[string]gatesdk.LineageNode{}
	children := map[string][]gatesdk.LineageEdge{}
	hasParent := map[string]bool{}
	for _, n := range g.Nodes {
		nodes[n.DocGUID] = n
	}
	for _, e := range g.Edges {
		children[e.From] = append(children[e.From], e)
		hasParent[e.To] = true
	}
	var print func(id, prefix, transform string)
	print = func(id, prefix, transform string) {
		n := nodes[id]
		mark := ""
		if transform != "" {
			mark = " ←" + transform
		}
		if n.Revoked {
			mark += " [폐기됨]"
		}
		star := "  "
		if id == g.Target {
			star = "▶ "
		}
		fmt.Printf("%s%s%s (%s)%s\n", prefix, star, id, n.Grade, mark)
		for _, e := range children[id] {
			print(e.To, prefix+"    ", e.Transform)
		}
	}
	for _, n := range g.Nodes {
		if !hasParent[n.DocGUID] {
			print(n.DocGUID, "", "")
		}
	}
}

// ── lm revoke <docGuid> --reason regrade ───────────────────

func cmdRevoke() *cobra.Command {
	var reason string
	c := &cobra.Command{
		Use:   "revoke <docGuid>",
		Short: "라벨 폐기 등록 (원장 REVOKE 이벤트 추가)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if err := client().Revoke(context.Background(), args[0], reason); err != nil {
				return err
			}
			fmt.Println("폐기 등록 완료:", args[0])
			return nil
		},
	}
	c.Flags().StringVar(&reason, "reason", "", "폐기 사유")
	return c
}

// ── lm ledger verify / checkpoint ──────────────────────────

func cmdLedger() *cobra.Command {
	c := &cobra.Command{Use: "ledger", Short: "원장 운영 도구"}

	var from, to int64
	verifyCmd := &cobra.Command{
		Use:   "verify",
		Short: "해시 체인 무결성 점검",
		RunE: func(_ *cobra.Command, _ []string) error {
			res, err := client().LedgerVerify(context.Background(), from, to)
			if err != nil {
				return err
			}
			if res.OK {
				fmt.Printf("무결: %d행 점검 완료\n", res.Checked)
				return nil
			}
			return fmt.Errorf("조작 감지: seq=%d (점검 %d행)", res.BadSeq, res.Checked)
		},
	}
	verifyCmd.Flags().Int64Var(&from, "from", 1, "시작 seq")
	verifyCmd.Flags().Int64Var(&to, "to", 0, "끝 seq (0=tip)")

	var sign bool
	ckptCmd := &cobra.Command{
		Use:   "checkpoint",
		Short: "체크포인트 발행(원장 봉인)",
		RunE: func(_ *cobra.Command, _ []string) error {
			if !sign {
				c, err := client().LatestCheckpoint(context.Background())
				if err != nil {
					return err
				}
				fmt.Printf("최신 체크포인트 #%d: seq %d~%d, root=%s, at=%s\n",
					c.CkptID, c.FromSeq, c.ToSeq, c.MerkleRoot, c.SignedAt.Format(time.RFC3339))
				return nil
			}
			c, err := client().SealCheckpoint(context.Background())
			if err != nil {
				return err
			}
			fmt.Printf("체크포인트 발행 #%d: seq %d~%d 봉인\n", c.CkptID, c.FromSeq, c.ToSeq)
			return nil
		},
	}
	ckptCmd.Flags().BoolVar(&sign, "sign", false, "새 체크포인트 서명·발행 (없으면 최신 조회)")

	var lFrom, lTo int64
	var lLimit int
	var lJSON bool
	listCmd := &cobra.Command{
		Use:   "list",
		Short: "원장 열람 (파일 해시가 기록된 레지스트리 — 기본: 최근 50행)",
		RunE: func(_ *cobra.Command, _ []string) error {
			page, err := client().LedgerEvents(context.Background(), lFrom, lTo, lLimit)
			if err != nil {
				return err
			}
			if lJSON {
				out, _ := json.MarshalIndent(page, "", "  ")
				fmt.Println(string(out))
				return nil
			}
			fmt.Printf("원장 tip=%d · 표시 구간 seq %d~%d\n", page.Tip, page.From, page.To)
			fmt.Printf("%-5s %-8s %-2s %-13s %-13s %-16s %s\n",
				"seq", "이벤트", "등급", "docGuid", "contentHash", "actor", "created(UTC)")
			for _, e := range page.Events {
				extra := ""
				if e.RevokedRef != 0 {
					extra = fmt.Sprintf(" →ref %d", e.RevokedRef)
				}
				if e.Transform != "" {
					extra += " ←" + e.Transform
				}
				actor := e.Actor
				if len(actor) > 16 {
					actor = actor[:15] + "…"
				}
				fmt.Printf("%-5d %-8s %-2s %-13s %-13s %-16s %s%s\n",
					e.Seq, e.EventType, e.Grade,
					e.DocGUID[:8]+"…", e.ContentHash[:12]+"…",
					actor, e.CreatedAt.Format("2006-01-02 15:04:05"), extra)
			}
			return nil
		},
	}
	listCmd.Flags().Int64Var(&lFrom, "from", 0, "시작 seq (0=자동)")
	listCmd.Flags().Int64Var(&lTo, "to", 0, "끝 seq (0=tip)")
	listCmd.Flags().IntVar(&lLimit, "limit", 50, "최대 행 수 (최대 500)")
	listCmd.Flags().BoolVar(&lJSON, "json", false, "JSON 출력 (전체 필드·해시 원문 포함)")

	c.AddCommand(verifyCmd, ckptCmd, listCmd)
	return c
}

// ── lm regrade <docGuid> --grade O --approval-token ... ────
// 등급 변경. 하향(S→O)이 곧 "공개 전환"이며 승인 토큰이 필수다.
// 폐기는 공개 전환이 아니다 — docs/lifecycle-policy.md.

func cmdRegrade() *cobra.Command {
	var grade, token, reason string
	c := &cobra.Command{
		Use:   "regrade <docGuid>",
		Short: "등급 변경 (하향 = 공개 전환, 승인 토큰 필수; 상향 즉시)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			resp, err := client().Regrade(context.Background(), args[0], grade, token, reason)
			if err != nil {
				return err
			}
			fmt.Printf("등급 변경 완료: %s → %s (seq %d) — 구 라벨은 superseded 처리\n",
				args[0], grade, resp.LedgerSeq)
			return nil
		},
	}
	c.Flags().StringVar(&grade, "grade", "", "새 등급 (S|O) — 필수")
	c.Flags().StringVar(&token, "approval-token", "", "하향(공개 전환) 승인 토큰")
	c.Flags().StringVar(&reason, "reason", "", "변경 사유")
	_ = c.MarkFlagRequired("grade")
	return c
}

// ── lm destroy <docGuid> --reason ... --approval-token ... ──
// 파기: 보존기간 만료 + 심의 후. 불가역. 키 파기(crypto-shredding)를
// 지시하고 원장에 DESTROY 이벤트를 남긴다 — 증적은 영구 보존.

func cmdDestroy() *cobra.Command {
	var token, reason string
	var yes bool
	c := &cobra.Command{
		Use:   "destroy <docGuid>",
		Short: "파기 (불가역 — 파기 심의 토큰·근거 필수)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if !yes {
				return fmt.Errorf("파기는 불가역입니다. 확인했으면 --yes 를 붙이세요")
			}
			if err := client().Destroy(context.Background(), args[0], reason, token); err != nil {
				return err
			}
			fmt.Printf("파기 완료: %s — 원장 증적은 영구 보존되며, 사본 검증은 destroyed/deny로 판정됩니다\n", args[0])
			return nil
		},
	}
	c.Flags().StringVar(&reason, "reason", "", "파기 심의 근거 — 필수")
	c.Flags().StringVar(&token, "approval-token", "", "파기 심의 승인 토큰 — 필수")
	c.Flags().BoolVar(&yes, "yes", false, "불가역 작업 확인")
	_ = c.MarkFlagRequired("reason")
	_ = c.MarkFlagRequired("approval-token")
	return c
}

// ── lm pki init-org --org NTS --dir ./nts-keystore ─────────
// 기관 키스토어 생성. 키 쌍은 반드시 각 기관 로컬에서 만든다 —
// 개인키는 네트워크로 이동하지 않으며, 상대 기관에는 CA 인증서(공개)만
// 전달해 신뢰목록(lm trust import)에 반입한다. CLI가 서버 API를 거치지
// 않는 예외 지점이다(해시 계산과 같은 이유 — 비밀은 로컬에 머문다).

func cmdPKI() *cobra.Command {
	c := &cobra.Command{Use: "pki", Short: "기관 PKI 도구 (키는 로컬 생성 — 반출 금지)"}
	var dir, org string
	initCmd := &cobra.Command{
		Use:   "init-org",
		Short: "기관 키스토어 생성 (Org Root CA + Label/Checkpoint Signer)",
		RunE: func(_ *cobra.Command, _ []string) error {
			if org == "" {
				return fmt.Errorf("--org 는 필수입니다 (기관 식별자, 예: NTS)")
			}
			if _, err := os.Stat(filepath.Join(dir, "ca.crt")); err == nil {
				return fmt.Errorf("%s 에 키스토어가 이미 있습니다", dir)
			}
			ks, err := softhsm.Open(dir, org)
			if err != nil {
				return fmt.Errorf("키스토어 생성: %w", err)
			}
			fmt.Printf("기관 %s 키스토어 생성 완료: %s\n", org, dir)
			fmt.Printf("  ca.key / ca.crt                 — Org Root CA (10년, 오프라인 보관 대상)\n")
			fmt.Printf("  label.key / label.crt           — Label Signer (90일)\n")
			fmt.Printf("  checkpoint.key / checkpoint.crt — Checkpoint Signer (1년)\n")
			fmt.Printf("연동 절차: 상대 기관에 %s 만 전달 →\n", filepath.Join(dir, "ca.crt"))
			fmt.Printf("  lm trust import %s --org %s\n", filepath.Join(dir, "ca.crt"), org)
			_ = ks
			return nil
		},
	}
	initCmd.Flags().StringVar(&dir, "dir", "./keystore", "키스토어 디렉터리")
	initCmd.Flags().StringVar(&org, "org", "", "기관 식별자 (필수)")
	c.AddCommand(initCmd)
	return c
}

// ── lm trust import partner-ca.pem ─────────────────────────

func cmdTrust() *cobra.Command {
	c := &cobra.Command{Use: "trust", Short: "신뢰목록 관리"}
	var org string
	imp := &cobra.Command{
		Use:   "import <ca.pem>",
		Short: "파트너 기관 CA 반입",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			pemBytes, err := os.ReadFile(args[0])
			if err != nil {
				return fmt.Errorf("PEM 읽기: %w", err)
			}
			if org == "" {
				org = strings.TrimSuffix(filepath.Base(args[0]), filepath.Ext(args[0]))
			}
			if err := client().TrustImport(context.Background(), org, string(pemBytes)); err != nil {
				return err
			}
			fmt.Println("신뢰목록 반입 완료:", org)
			return nil
		},
	}
	imp.Flags().StringVar(&org, "org", "", "기관 식별자 (기본: 파일명)")
	c.AddCommand(imp)
	return c
}

// ── 헬퍼 ───────────────────────────────────────────────────

func listFiles(dir string, recursive bool) ([]string, error) {
	var out []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != dir && !recursive {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(path, sidecarExt) {
			return nil
		}
		out = append(out, path)
		return nil
	})
	return out, err
}

func writeSidecar(path, labelB64 string) error {
	der, err := base64.StdEncoding.DecodeString(labelB64)
	if err != nil {
		return fmt.Errorf("labelDer 디코드: %w", err)
	}
	return os.WriteFile(path+sidecarExt, der, 0o644)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
