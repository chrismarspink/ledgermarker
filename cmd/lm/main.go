// lm 은 배치·소급 라벨링·운영 도구 CLI다 (DEV SPEC §7).
//
// CLI는 고유 로직을 갖지 않는다 — 전부 서버 API 래퍼(sdk 재사용)다.
// 예외: 파일 해시 계산은 클라이언트에서 수행한다(파일을 서버로 보내지 않는다).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
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
)

const sidecarExt = ".lmsig" // 사이드카 파일명: <원본파일명>.lmsig (DER)

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

	root.AddCommand(cmdScan(), cmdVerify(), cmdLineage(), cmdRevoke(),
		cmdLedger(), cmdTrust())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "오류:", err)
		os.Exit(1)
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
				hash, err := hashFile(path)
				if err != nil {
					return fmt.Errorf("해시 계산 %s: %w", path, err)
				}
				req := gatesdk.VerifyRequest{ContentHash: hash, Level: level}
				if der, err := os.ReadFile(path + sidecarExt); err == nil {
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

	c.AddCommand(verifyCmd, ckptCmd)
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
