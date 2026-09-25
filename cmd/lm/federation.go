package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	gatesdk "github.com/innotium/ledgermarker/sdk/go"
)

// ── 기관 간 전달 (모델 A) ────────────────────────────────────
//
// lm send <파일> --to MOIS [--as KPOST] [--copy-to <디렉터리>]
//   보내는 기관 입장에서 검증해 귀속을 확인하고, 관측 로그에 SENT 를 남긴다.
//   --copy-to 가 있으면 파일과 사이드카(.lmsig)를 그 폴더로 복사한다(물리적 이동 흉내).
// lm receive <파일> --as MOIS [--from KPOST]
//   받는 기관 게이트 입장에서 검증한다: 원장 조회(L2) + 협정 번역(L3). 결과를 VERIFIED 로 남긴다.
//
// 원장 행은 늘지 않는다 — 전달·검증은 게이트가 보고한 사실(관측 로그)이지 발급 사실이 아니다.

func cmdSend() *cobra.Command {
	var to, as, copyTo string
	c := &cobra.Command{
		Use:   "send <파일>",
		Short: "타 기관으로 전달 — 보내는 기관 검증 후 관측 로그에 SENT 기록 (--copy-to: 파일·사이드카 복사)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if to == "" {
				return fmt.Errorf("--to <기관ID> 가 필요합니다 (예: --to MOIS)")
			}
			path := args[0]
			req, err := verifyRequestFor(path, as)
			if err != nil {
				return err
			}
			res, err := client().Verify(context.Background(), req)
			if err != nil {
				return fmt.Errorf("검증 %s: %w", path, err)
			}
			if res.Attribution.DocGUID == "" || res.Checks.Ledger != "registered" {
				return fmt.Errorf("%s 은(는) 원장에 등록되지 않은 문서라 전달 기록을 남길 수 없습니다 (ledger=%s)", path, res.Checks.Ledger)
			}
			from := as
			if from == "" {
				from = res.Attribution.IssuerOrg
			}
			err = client().Observe(context.Background(), gatesdk.Observation{
				Kind: "SENT", DocGUID: res.Attribution.DocGUID, ContentHash: req.ContentHash,
				FromOrg: from, ToOrg: to, Grade: res.Attribution.Grade,
				Note: "lm send " + filepath.Base(path),
			})
			if err != nil {
				return fmt.Errorf("SENT 기록: %w", err)
			}
			fmt.Printf("── %s\n   %s → %s 전달 기록 (SENT) · docGuid=%s 등급=%s 발급기관=%s\n",
				path, from, to, res.Attribution.DocGUID, res.Attribution.Grade, res.Attribution.IssuerOrg)
			if copyTo != "" {
				if err := os.MkdirAll(copyTo, 0o755); err != nil {
					return err
				}
				dst := filepath.Join(copyTo, filepath.Base(path))
				if err := copyFile(path, dst); err != nil {
					return err
				}
				fmt.Printf("   파일 복사: %s\n", dst)
				if _, err := os.Stat(path + sidecarExt); err == nil {
					if err := copyFile(path+sidecarExt, dst+sidecarExt); err == nil {
						fmt.Printf("   사이드카 복사: %s\n", dst+sidecarExt)
					}
				}
			}
			fmt.Printf("   받는 쪽: lm receive <파일> --as %s\n", to)
			return nil
		},
	}
	c.Flags().StringVar(&to, "to", "", "받는 기관 ID (필수)")
	c.Flags().StringVar(&as, "as", os.Getenv("LM_ORG"), "보내는 기관 ID (기본 LM_ORG, 없으면 발급 기관)")
	c.Flags().StringVar(&copyTo, "copy-to", "", "파일·사이드카를 복사할 폴더 (물리적 이동 흉내)")
	return c
}

func cmdReceive() *cobra.Command {
	var as, from string
	var jsonOut bool
	c := &cobra.Command{
		Use:   "receive <파일>",
		Short: "타 기관 문서 수신 검증 — 받는 기관 게이트로 검증(원장 조회+협정 번역) 후 VERIFIED 기록",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if as == "" {
				return fmt.Errorf("--as <기관ID> 가 필요합니다 (받는 기관, 기본 LM_ORG)")
			}
			path := args[0]
			req, err := verifyRequestFor(path, as)
			if err != nil {
				return err
			}
			res, err := client().Verify(context.Background(), req)
			if err != nil {
				return fmt.Errorf("검증 %s: %w", path, err)
			}
			printResult(path, res)
			if res.Attribution.DocGUID == "" {
				fmt.Println("   원장에 없는 문서 — 관측 로그에 남기지 않습니다")
				return nil
			}
			if from == "" {
				from = res.Attribution.IssuerOrg
			}
			err = client().Observe(context.Background(), gatesdk.Observation{
				Kind: "VERIFIED", DocGUID: res.Attribution.DocGUID, ContentHash: req.ContentHash,
				FromOrg: from, ToOrg: as, Grade: res.Attribution.Grade, TranslatedGrade: res.TranslatedGrade,
				Treaty: res.Checks.Treaty, VerdictHint: res.VerdictHint, Note: "lm receive " + filepath.Base(path),
			})
			if err != nil {
				return fmt.Errorf("VERIFIED 기록: %w", err)
			}
			fmt.Printf("   %s 게이트 검증 기록 (VERIFIED)\n", as)
			if jsonOut {
				fmt.Println(res.VerdictHint)
			}
			if res.VerdictHint == "deny" {
				os.Exit(2)
			}
			return nil
		},
	}
	c.Flags().StringVar(&as, "as", os.Getenv("LM_ORG"), "받는 기관 ID (기본 LM_ORG)")
	c.Flags().StringVar(&from, "from", "", "보낸 기관 ID (기본: 발급 기관)")
	c.Flags().BoolVar(&jsonOut, "json", false, "판정 힌트만 마지막 줄에 출력")
	return c
}

// verifyRequestFor 는 파일에서 검증 요청을 만든다(해시·텍스트 해시·내장 또는 사이드카 라벨).
func verifyRequestFor(path, verifierOrg string) (gatesdk.VerifyRequest, error) {
	data, attacher, _, err := resolveFile(path)
	if err != nil {
		return gatesdk.VerifyRequest{}, err
	}
	req := gatesdk.VerifyRequest{Level: 2, VerifierOrg: verifierOrg}
	req.ContentHash, err = hashTargetHex(attacher, data)
	if err != nil {
		return req, fmt.Errorf("해시 대상 계산 %s: %w", path, err)
	}
	req.TextHash = textHashHex(path, data)
	if der, err := attacher.Extract(bytes.NewReader(data), int64(len(data))); err == nil {
		req.LabelDER = base64.StdEncoding.EncodeToString(der)
	} else if der, err := os.ReadFile(path + sidecarExt); err == nil {
		req.LabelDER = base64.StdEncoding.EncodeToString(der)
	}
	return req, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
