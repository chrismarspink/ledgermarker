package verify

import (
	"context"
	"fmt"
	"time"

	"github.com/smallstep/pkcs7"

	lmcrypto "github.com/chrismarspink/ledgermarker/internal/crypto"
)

// CMSVerifier 는 crypto.Verifier의 pkcs7 기반 구현이다.
type CMSVerifier struct{}

var _ lmcrypto.Verifier = (*CMSVerifier)(nil)

// Verify 는 detached CMS 서명을 검증한다.
// 인증서 체인은 opts.At 시점 기준으로 판정한다 — 키 유출 규칙(§5.4)의
// 절반은 여기서(시점 검증), 나머지 절반은 verify.Run에서(원장 대조) 구현된다.
func (v *CMSVerifier) Verify(_ context.Context, cms []byte, opts lmcrypto.VerifyOpts) (*lmcrypto.VerifyResult, error) {
	p7, err := pkcs7.Parse(cms)
	if err != nil {
		return nil, fmt.Errorf("verify: parse CMS: %w", err)
	}
	p7.Content = opts.Content

	res := &lmcrypto.VerifyResult{}
	if cert := p7.GetOnlySigner(); cert != nil {
		res.SignerCert = cert
		res.SignerSerial = cert.SerialNumber.String()
		if opts.RevokedSerials[res.SignerSerial] {
			res.CertRevoked = true
		}
	}

	at := opts.At
	if at.IsZero() {
		at = time.Now()
	}

	// 1) 암호학적 서명 검증 (체인 무시)
	if err := p7.VerifyWithChainAtTime(nil, at); err == nil {
		res.SignatureValid = true
	}
	// 2) 신뢰 체인 검증 (At 시점)
	if res.SignatureValid && opts.Roots != nil {
		if err := p7.VerifyWithChainAtTime(opts.Roots, at); err == nil {
			res.ChainValid = true
		}
	}
	return res, nil
}
