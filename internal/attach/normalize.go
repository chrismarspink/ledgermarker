package attach

import (
	"bytes"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// NormalizeText 는 텍스트 정규화다 (작업지시서 §2.4 — 규칙 변경 금지,
// 골든 테스트로 잠금). 정규화 구현은 이 파일 한 곳에만 둔다.
//
//	UTF-8 변환 → BOM 제거 → CRLF를 LF로 → 유니코드 NFC → 파일 끝 개행 1개
//	후행 공백은 제거하지 않는다.
//
// PWA(JS) 미러 구현: verify-pwa/src/lib/attach.js — 규칙 변경 시 양쪽을
// 함께 고치고 골든 테스트를 갱신할 것.
func NormalizeText(data []byte) []byte {
	// BOM 제거 (UTF-8 BOM)
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	s := string(data) // 무효 바이트는 Go 문자열 변환 규칙대로 U+FFFD 처리
	// CRLF → LF (외따로 남은 CR도 LF로)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	// 유니코드 NFC
	s = norm.NFC.String(s)
	// 파일 끝 개행 정확히 1개 (후행 공백은 유지)
	s = strings.TrimRight(s, "\n") + "\n"
	return []byte(s)
}
