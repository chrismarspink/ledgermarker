// Package softhsm 은 crypto 인터페이스의 Phase 1 기본 구현이다.
// 파일 키스토어 + Go 표준 라이브러리(ECDSA P-256 / SHA-256)를 쓴다.
// 납품 구현(crypto/kcmvp)은 모듈 선정 후 별도 착수한다 (DEV SPEC §5.2 ✎).
package softhsm

import (
	"context"
	stdcrypto "crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"

	lmcrypto "github.com/innotium/ledgermarker/internal/crypto"
)

// 인증서 계층 (DEV SPEC §5.1):
//   Org Root CA (10년) ── Label Signer (90일) / Checkpoint Signer (1년)
const (
	caValidity         = 10 * 365 * 24 * time.Hour
	labelValidity      = 90 * 24 * time.Hour
	checkpointValidity = 365 * 24 * time.Hour
)

// Keystore 는 파일 기반 키·인증서 저장소다.
type Keystore struct {
	dir string

	caCert *x509.Certificate
	caKey  *ecdsa.PrivateKey

	label      *fileSigner
	checkpoint *fileSigner

	revoked map[string]bool // 인증서 일련번호 → 폐기 여부 (CRL 대용)
}

type fileSigner struct {
	key  *ecdsa.PrivateKey
	cert *x509.Certificate
}

var _ lmcrypto.Signer = (*fileSigner)(nil)

func (s *fileSigner) Sign(_ context.Context, digest []byte) ([]byte, error) {
	sig, err := s.key.Sign(rand.Reader, digest, stdcrypto.SHA256)
	if err != nil {
		return nil, fmt.Errorf("softhsm: sign: %w", err)
	}
	return sig, nil
}

func (s *fileSigner) CertDER() []byte        { return s.cert.Raw }
func (s *fileSigner) SerialNumber() string   { return s.cert.SerialNumber.String() }
func (s *fileSigner) NotAfter() time.Time    { return s.cert.NotAfter }

// Open 은 dir의 키스토어를 연다. 비어 있으면 개발용 CA·서명자를 생성한다.
func Open(dir, orgName string) (*Keystore, error) {
	ks := &Keystore{dir: dir, revoked: map[string]bool{}}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("softhsm: mkdir keystore: %w", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "ca.crt")); os.IsNotExist(err) {
		if err := ks.generate(orgName); err != nil {
			return nil, fmt.Errorf("softhsm: generate dev PKI: %w", err)
		}
	}
	if err := ks.load(); err != nil {
		return nil, fmt.Errorf("softhsm: load keystore: %w", err)
	}
	return ks, nil
}

// LabelSigner 는 라벨 서명자(90일)를 반환한다.
func (ks *Keystore) LabelSigner() lmcrypto.Signer { return ks.label }

// CheckpointSigner 는 원장 봉인 전용 서명자(1년)를 반환한다.
func (ks *Keystore) CheckpointSigner() lmcrypto.Signer { return ks.checkpoint }

// CACertPEM 은 기관 CA 인증서 PEM을 반환한다(신뢰목록 배포용).
func (ks *Keystore) CACertPEM() []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ks.caCert.Raw})
}

// CACert 는 기관 CA 인증서를 반환한다.
func (ks *Keystore) CACert() *x509.Certificate { return ks.caCert }

// RevokeSerial 은 서명 인증서를 폐기 목록에 올린다.
// 라벨 폐기(원장 이벤트)와는 별개다 (DEV SPEC §5.3).
func (ks *Keystore) RevokeSerial(serial string) error {
	ks.revoked[serial] = true
	return ks.saveRevoked()
}

// RevokedSerials 는 폐기된 일련번호 집합을 반환한다.
func (ks *Keystore) RevokedSerials() map[string]bool {
	out := make(map[string]bool, len(ks.revoked))
	for k, v := range ks.revoked {
		out[k] = v
	}
	return out
}

// RotateLabelSigner 는 라벨 서명자를 새로 발급한다(90일 자동 교체용).
func (ks *Keystore) RotateLabelSigner(orgName string) error {
	s, err := ks.newLeaf(orgName+" Label Signer", labelValidity)
	if err != nil {
		return fmt.Errorf("softhsm: rotate label signer: %w", err)
	}
	if err := writeSigner(ks.dir, "label", s); err != nil {
		return err
	}
	ks.label = s
	return nil
}

func (ks *Keystore) generate(orgName string) error {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("gen ca key: %w", err)
	}
	now := time.Now()
	caTpl := &x509.Certificate{
		SerialNumber:          newSerial(),
		Subject:               pkix.Name{CommonName: orgName + " Org Root CA", Organization: []string{orgName}},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(caValidity),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	if err != nil {
		return fmt.Errorf("create ca cert: %w", err)
	}
	if err := writeKeyCert(ks.dir, "ca", caKey, caDER); err != nil {
		return err
	}
	ks.caKey = caKey
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return fmt.Errorf("parse ca cert: %w", err)
	}
	ks.caCert = caCert

	label, err := ks.newLeaf(orgName+" Label Signer", labelValidity)
	if err != nil {
		return err
	}
	if err := writeSigner(ks.dir, "label", label); err != nil {
		return err
	}
	ckpt, err := ks.newLeaf(orgName+" Checkpoint Signer", checkpointValidity)
	if err != nil {
		return err
	}
	if err := writeSigner(ks.dir, "checkpoint", ckpt); err != nil {
		return err
	}
	return ks.saveRevoked()
}

func (ks *Keystore) newLeaf(cn string, validity time.Duration) (*fileSigner, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("gen leaf key: %w", err)
	}
	now := time.Now()
	tpl := &x509.Certificate{
		SerialNumber: newSerial(),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(validity),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageCodeSigning},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, ks.caCert, &key.PublicKey, ks.caKey)
	if err != nil {
		return nil, fmt.Errorf("create leaf cert %q: %w", cn, err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fmt.Errorf("parse leaf cert: %w", err)
	}
	return &fileSigner{key: key, cert: cert}, nil
}

func (ks *Keystore) load() error {
	caKey, caCert, err := readKeyCert(ks.dir, "ca")
	if err != nil {
		return err
	}
	ks.caKey, ks.caCert = caKey, caCert

	lk, lc, err := readKeyCert(ks.dir, "label")
	if err != nil {
		return err
	}
	ks.label = &fileSigner{key: lk, cert: lc}

	ck, cc, err := readKeyCert(ks.dir, "checkpoint")
	if err != nil {
		return err
	}
	ks.checkpoint = &fileSigner{key: ck, cert: cc}

	b, err := os.ReadFile(filepath.Join(ks.dir, "revoked.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read revoked.json: %w", err)
	}
	if err := json.Unmarshal(b, &ks.revoked); err != nil {
		return fmt.Errorf("parse revoked.json: %w", err)
	}
	return nil
}

func (ks *Keystore) saveRevoked() error {
	b, err := json.MarshalIndent(ks.revoked, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal revoked: %w", err)
	}
	if err := os.WriteFile(filepath.Join(ks.dir, "revoked.json"), b, 0o600); err != nil {
		return fmt.Errorf("write revoked.json: %w", err)
	}
	return nil
}

func writeSigner(dir, name string, s *fileSigner) error {
	return writeKeyCert(dir, name, s.key, s.cert.Raw)
}

func writeKeyCert(dir, name string, key *ecdsa.PrivateKey, certDER []byte) error {
	kb, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return fmt.Errorf("marshal %s key: %w", name, err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})
	if err := os.WriteFile(filepath.Join(dir, name+".key"), keyPEM, 0o600); err != nil {
		return fmt.Errorf("write %s.key: %w", name, err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	if err := os.WriteFile(filepath.Join(dir, name+".crt"), certPEM, 0o644); err != nil {
		return fmt.Errorf("write %s.crt: %w", name, err)
	}
	return nil
}

func readKeyCert(dir, name string) (*ecdsa.PrivateKey, *x509.Certificate, error) {
	kb, err := os.ReadFile(filepath.Join(dir, name+".key"))
	if err != nil {
		return nil, nil, fmt.Errorf("read %s.key: %w", name, err)
	}
	blk, _ := pem.Decode(kb)
	if blk == nil {
		return nil, nil, fmt.Errorf("decode %s.key PEM", name)
	}
	key, err := x509.ParseECPrivateKey(blk.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parse %s.key: %w", name, err)
	}
	cb, err := os.ReadFile(filepath.Join(dir, name+".crt"))
	if err != nil {
		return nil, nil, fmt.Errorf("read %s.crt: %w", name, err)
	}
	blk, _ = pem.Decode(cb)
	if blk == nil {
		return nil, nil, fmt.Errorf("decode %s.crt PEM", name)
	}
	cert, err := x509.ParseCertificate(blk.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parse %s.crt: %w", name, err)
	}
	return key, cert, nil
}

func newSerial() *big.Int {
	max := new(big.Int).Lsh(big.NewInt(1), 128)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		panic(fmt.Sprintf("softhsm: serial: %v", err))
	}
	return n
}
