// lm 은 배치·소급 라벨링·운영 도구 CLI다 (DEV SPEC §7).
//
// CLI는 고유 로직을 갖지 않는다 — 전부 서버 API 래퍼(sdk 재사용)다.
// 예외: 파일 해시 계산은 클라이언트에서 수행한다(파일을 서버로 보내지 않는다).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"

	gatesdk "github.com/innotium/ledgermarker/sdk/go"

	"github.com/innotium/ledgermarker/internal/crypto/softhsm"
)

const sidecarExt = ".lmsig" // 사이드카 파일명: <원본파일명>.lmsig (DER)

// 라벨 트레일러 내장 형식 (docs/label-profile.md 부록):
//
//	[원본][CMS DER][DER 길이 uint64 BE][매직 "LMLABEL1"]
//
// contentHash는 항상 원본 바이트 기준이다.
const embedMagic = "LMLABEL1"

// splitEmbedded 는 트레일러가 있으면 (원본, DER, true)를 반환한다.
func splitEmbedded(data []byte) (orig, der []byte, ok bool) {
	n := len(data)
	if n < 20 || string(data[n-8:]) != embedMagic {
		return nil, nil, false
	}
	derLen := binary.BigEndian.Uint64(data[n-16 : n-8])
	if derLen == 0 || derLen > uint64(n-16) {
		return nil, nil, false
	}
	cut := n - 16 - int(derLen)
	return data[:cut], data[cut : n-16], true
}

// appendTrailer 는 파일 끝에 라벨 트레일러를 덧붙인다 (원본 내용 불변).
func appendTrailer(path string, der []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	lenBuf := make([]byte, 8)
	binary.BigEndian.PutUint64(lenBuf, uint64(len(der)))
	for _, b := range [][]byte{der, lenBuf, []byte(embedMagic)} {
		if _, err := f.Write(b); err != nil {
			return err
		}
	}
	return nil
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

	root.AddCommand(cmdIssue(), cmdScan(), cmdVerify(), cmdLineage(), cmdRevoke(),
		cmdRegrade(), cmdDestroy(), cmdLedger(), cmdTrust(), cmdPKI())

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
	c := &cobra.Command{
		Use:   "issue <파일>",
		Short: "단일 파일 라벨 발급 (기본: .lmsig 사이드카, --embed: 파일에 트레일러 내장)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := args[0]
			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("파일 읽기: %w", err)
			}
			if _, _, ok := splitEmbedded(data); ok {
				return fmt.Errorf("%s 에는 이미 라벨이 내장되어 있습니다 (lm verify로 확인)", path)
			}
			if !embed {
				if _, err := os.Stat(path + sidecarExt); err == nil && !force {
					return fmt.Errorf("%s%s 가 이미 있습니다. 재발급하려면 --force", path, sidecarExt)
				}
			}
			sum := sha256.Sum256(data)
			hash := hex.EncodeToString(sum[:])
			req.ContentHash = hash
			if approval != "" {
				req.ApprovalState = strings.ToUpper(approval)
			}
			// --parent: 부모 파일 경로 또는 64자 hex 해시 → 선언적 계보
			if parent != "" {
				ph := parent
				if len(parent) != 64 {
					// 부모가 라벨 내장 파일이면 트레일러를 뗀 원본 기준으로
					// 해시한다 — 원장 등록 해시와 일치해야 계보가 이어진다.
					pdata, err := os.ReadFile(parent)
					if err != nil {
						return fmt.Errorf("부모 파일 읽기: %w", err)
					}
					if porig, _, ok := splitEmbedded(pdata); ok {
						pdata = porig
					}
					psum := sha256.Sum256(pdata)
					ph = hex.EncodeToString(psum[:])
				}
				if req.Lineage == nil {
					req.Lineage = &gatesdk.LineageDecl{}
				}
				req.Lineage.ParentHash = ph
			}
			resp, err := client().IssueLabel(context.Background(), req, "issue:"+hash)
			if err != nil {
				return err
			}
			if embed {
				der, err := base64.StdEncoding.DecodeString(resp.LabelDER)
				if err != nil {
					return fmt.Errorf("labelDer 디코드: %w", err)
				}
				if err := appendTrailer(path, der); err != nil {
					return fmt.Errorf("트레일러 내장: %w", err)
				}
				fmt.Printf("발급 완료 (파일에 내장): %s\n", path)
			} else {
				if err := writeSidecar(path, resp.LabelDER); err != nil {
					return fmt.Errorf("사이드카 쓰기: %w", err)
				}
				fmt.Printf("발급 완료: %s%s\n", path, sidecarExt)
			}
			fmt.Printf("  docGuid=%s seq=%d 등급=%s 유효기간=%s\n",
				resp.DocGUID, resp.LedgerSeq, req.Grade, resp.NotAfter.Format("2006-01-02"))
			if resp.RootDocID != "" && resp.RootDocID != resp.DocGUID {
				fmt.Printf("  최초 조상=%s\n", resp.RootDocID)
			}
			return nil
		},
	}
	c.Flags().StringVar(&req.Grade, "grade", "O", "등급 (S|O — C는 체계 범위 밖)")
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
	transformFlag := c.Flags().String("transform", "edit", "--parent 지정 시 변환 종류 (edit|convert|merge|extract)")
	c.PreRun = func(_ *cobra.Command, _ []string) {
		if parent != "" {
			req.Lineage = &gatesdk.LineageDecl{Transform: *transformFlag}
		}
	}
	return c
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
				hash, err := hashFile(path)
				if err != nil {
					fmt.Printf("SKIP %s: %v\n", path, err)
					continue
				}
				if !issueFlag {
					fmt.Printf("%s  %s\n", hash, path)
					continue
				}
				req := gatesdk.IssueRequest{ContentHash: hash, Grade: grade, NotAfterDays: notAfterDays}
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
	c := &cobra.Command{
		Use:   "verify <파일...>",
		Short: "배치 검증 (사이드카 자동 탐색, 없으면 폴백 검증)",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			exit := 0
			for _, path := range args {
				data, err := os.ReadFile(path)
				if err != nil {
					return fmt.Errorf("파일 읽기 %s: %w", path, err)
				}
				req := gatesdk.VerifyRequest{Level: level}
				if orig, embDer, ok := splitEmbedded(data); ok {
					// 라벨 내장 파일: 트레일러를 떼고 원본 부분만 해시
					sum := sha256.Sum256(orig)
					req.ContentHash = hex.EncodeToString(sum[:])
					req.LabelDER = base64.StdEncoding.EncodeToString(embDer)
				} else {
					sum := sha256.Sum256(data)
					req.ContentHash = hex.EncodeToString(sum[:])
					if der, err := os.ReadFile(path + sidecarExt); err == nil {
						req.LabelDER = base64.StdEncoding.EncodeToString(der)
					}
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
				hash, err := hashFile(args[0])
				if err != nil {
					return fmt.Errorf("docGuid도 파일도 아닙니다: %s", args[0])
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

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

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
