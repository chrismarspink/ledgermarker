// Package crypto 는 LM의 암호모듈 추상화 계층이다.
//
// 개발 단계는 softhsm(파일 키스토어 + Go 표준 라이브러리) 구현을 쓰고,
// 납품 시 KCMVP 검증필 모듈 구현으로 코드 변경 없이 교체한다 (DEV SPEC §5.2).
// 이 패키지 외부에서 키 바이트를 직접 다루지 않는다 (DEV SPEC §12).
package crypto

import (
	"context"
	stdcrypto "crypto"
	"crypto/x509"
	"fmt"
	"io"
	"time"
)

// Signer 는 SHA-256 digest에 대한 서명을 생성한다.
type Signer interface {
	Sign(ctx context.Context, digest []byte) (sig []byte, err error)
	CertDER() []byte
	SerialNumber() string
	NotAfter() time.Time
}

// VerifyOpts 는 CMS 서명 검증 옵션이다.
type VerifyOpts struct {
	// Content 는 detached 서명의 원문(LM에서는 contentHash 32바이트)이다.
	Content []byte
	// Roots 는 신뢰 CA 풀이다. nil이면 체인 검증을 생략한다.
	Roots *x509.CertPool
	// At 은 인증서 유효성 판단 기준 시각이다. 키 유출 규칙(§5.4)에 따라
	// 원장 등록 시각을 넘긴다. 제로값이면 현재 시각.
	At time.Time
	// RevokedSerials 는 폐기된 서명 인증서 일련번호 목록(CRL 대용)이다.
	RevokedSerials map[string]bool
}

// VerifyResult 는 서명 검증 결과다.
type VerifyResult struct {
	// SignatureValid 는 암호학적 서명 검증 결과다(체인·폐기와 무관).
	SignatureValid bool
	// ChainValid 는 At 시점 기준 신뢰 체인 검증 결과다.
	ChainValid bool
	// CertRevoked 는 서명 인증서가 폐기 목록에 있는지다.
	CertRevoked bool
	// SignerCert 는 서명자 인증서다.
	SignerCert *x509.Certificate
	// SignerSerial 은 서명자 인증서 일련번호(10진수 문자열)다.
	SignerSerial string
}

// Verifier 는 CMS SignedData 서명을 검증한다.
type Verifier interface {
	Verify(ctx context.Context, cms []byte, opts VerifyOpts) (*VerifyResult, error)
}

// Cipher 는 본문 암호화용 대칭 AEAD다. 개발 구현은 AES-256-GCM,
// 납품 구현은 ARIA-256-GCM(KCMVP 모듈)으로 교체한다.
type Cipher interface {
	Seal(plaintext []byte, aad []byte) (ciphertext []byte, err error)
	Open(ciphertext []byte, aad []byte) (plaintext []byte, err error)
}

// StdSigner 는 LM Signer를 Go 표준 crypto.Signer로 감싼다.
// CMS 조립 라이브러리(pkcs7)가 표준 인터페이스를 요구하기 때문에 필요하다.
type StdSigner struct {
	S   Signer
	pub stdcrypto.PublicKey
}

// NewStdSigner 는 s의 인증서에서 공개키를 읽어 표준 서명자를 만든다.
func NewStdSigner(s Signer) (*StdSigner, error) {
	cert, err := x509.ParseCertificate(s.CertDER())
	if err != nil {
		return nil, fmt.Errorf("crypto: parse signer cert: %w", err)
	}
	return &StdSigner{S: s, pub: cert.PublicKey}, nil
}

func (a *StdSigner) Public() stdcrypto.PublicKey { return a.pub }

func (a *StdSigner) Sign(_ io.Reader, digest []byte, _ stdcrypto.SignerOpts) ([]byte, error) {
	return a.S.Sign(context.Background(), digest)
}
