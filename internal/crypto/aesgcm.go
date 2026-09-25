package crypto

import (
	stdaes "crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
)

// AESGCM 은 Cipher의 개발용 구현(AES-256-GCM)이다.
// 납품 시 ARIA-256-GCM KCMVP 모듈 구현으로 교체한다.
type AESGCM struct {
	aead cipher.AEAD
}

// NewAESGCM 은 32바이트 키로 AEAD를 만든다.
func NewAESGCM(key []byte) (*AESGCM, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("crypto: AES-256-GCM key must be 32 bytes, got %d", len(key))
	}
	block, err := stdaes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: new AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: new GCM: %w", err)
	}
	return &AESGCM{aead: aead}, nil
}

// Seal 은 nonce(12바이트)를 앞에 붙인 암호문을 반환한다.
func (c *AESGCM) Seal(plaintext, aad []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("crypto: nonce: %w", err)
	}
	return c.aead.Seal(nonce, nonce, plaintext, aad), nil
}

func (c *AESGCM) Open(ciphertext, aad []byte) ([]byte, error) {
	ns := c.aead.NonceSize()
	if len(ciphertext) < ns {
		return nil, fmt.Errorf("crypto: ciphertext too short")
	}
	pt, err := c.aead.Open(nil, ciphertext[:ns], ciphertext[ns:], aad)
	if err != nil {
		return nil, fmt.Errorf("crypto: open: %w", err)
	}
	return pt, nil
}
