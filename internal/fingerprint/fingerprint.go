// Package fingerprint 는 관찰적 재식별(내용 유사도 지문)을 구현한다.
//
// 목적: 라벨·메타데이터가 유실되고 내용까지 일부 수정되거나 형식이
// 변환된 파일을, 원장에 등록된 원본과 "유사도"로 연관 짓는다 —
// 해시(정확 일치)가 답하지 못하는 질문("이 파일은 어느 문서에서 왔나")의
// 구현체다. 선언적 계보(parentHash)를 보완하는 이중 계보의 나머지 절반.
//
// 파이프라인: 텍스트 추출 → 정규화 → 문자 5-gram 슁글 → MinHash(128)
//   → LSH 밴드(16×8)로 후보 조회 → 시그니처 비교로 Jaccard 유사도 추정.
//
// 지문은 본문을 복원할 수 없는 단방향 요약이다(불변식 3과 정합) —
// 원장에는 지문만 저장되고 본문은 저장되지 않는다.
package fingerprint

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"hash/fnv"
	"strings"

	"golang.org/x/text/unicode/norm"
)

const (
	// SigSize 는 MinHash 시그니처 길이다. 변경하면 기존 지문과 비교 불가 —
	// 변경 시 지문 재생성 필요.
	SigSize   = 128
	shingleK  = 5  // 문자 n-gram 크기 (한국어는 조사 변화에도 안정적)
	// 32 밴드 × 4 행: 유사도 ~0.5 이상에서 버킷 충돌 확률을 높인다(재현율).
	// 8행(16밴드)은 짧은 문서·중간 유사도(≈0.7)에서 충돌을 놓치는 경우가
	// 있었다. 밴드가 많으면 후보 폭이 넓어지지만, 최종 유사도(≥0.3)로
	// 걸러내므로 정확도 손해 없이 재현율만 오른다.
	lshBands  = 32
	lshRows   = SigSize / lshBands
	seedBase  = 0x4c4d5f4650 // "LM_FP"
)

// NormalizeForFP 는 지문용 텍스트 정규화다: NFC → 소문자 → 공백 전부 제거.
// 공백을 전부 없애는 이유: 편집기·변환기(예: docx→PDF)마다 텍스트를 서로
// 다르게 분절해 글자 사이 공백이 달라진다("제1조" ↔ "제 1 조"). 공백을
// 남기면 문자 n-gram 슁글이 완전히 어긋나 같은 문서도 유사도가 0이 된다.
// 공백 제거로 docx·PDF·재저장본의 지문이 수렴한다.
func NormalizeForFP(text string) string {
	s := norm.NFC.String(text)
	s = strings.ToLower(s)
	return strings.Join(strings.Fields(s), "")
}

// Shingles 는 정규화 텍스트의 문자 k-gram 해시 집합을 만든다.
func Shingles(text string) map[uint64]struct{} {
	runes := []rune(text)
	out := make(map[uint64]struct{}, len(runes))
	if len(runes) < shingleK {
		if len(runes) > 0 {
			h := fnv.New64a()
			h.Write([]byte(string(runes)))
			out[h.Sum64()] = struct{}{}
		}
		return out
	}
	for i := 0; i+shingleK <= len(runes); i++ {
		h := fnv.New64a()
		h.Write([]byte(string(runes[i : i+shingleK])))
		out[h.Sum64()] = struct{}{}
	}
	return out
}

// splitmix64 finalizer — 시드별 독립 해시 함수를 흉내낸다.
func mix(x uint64) uint64 {
	x += 0x9e3779b97f4a7c15
	x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9
	x = (x ^ (x >> 27)) * 0x94d049bb133111eb
	return x ^ (x >> 31)
}

// MinHash 는 슁글 집합의 MinHash 시그니처를 계산한다.
func MinHash(shingles map[uint64]struct{}) []uint64 {
	sig := make([]uint64, SigSize)
	for i := range sig {
		sig[i] = ^uint64(0)
	}
	for sh := range shingles {
		for i := 0; i < SigSize; i++ {
			h := mix(sh ^ (uint64(seedBase) + uint64(i)*0x9e3779b97f4a7c15))
			if h < sig[i] {
				sig[i] = h
			}
		}
	}
	return sig
}

// FromText 는 텍스트에서 시그니처를 바로 만든다.
func FromText(text string) []uint64 {
	return MinHash(Shingles(NormalizeForFP(text)))
}

// TextHash 는 정규화 텍스트의 SHA-256 이다 — SigNET 실측 계획의 H-5
// ("본문 텍스트 해시는 서식 변경에도 안정적")를 흡수한 2차 식별자.
// 편집기 재저장·재압축으로 파일 바이트가 통째로 바뀌어도, 본문 텍스트가
// 같으면 같은 값이 나와 정확 재식별이 가능하다.
//
// 공백은 전부 제거하고 해시한다 — 편집기가 텍스트 run을 분절해
// 재저장하면 공백 삽입 위치가 달라지기 때문(Pages 실측으로 확인).
// 지문(NormalizeForFP)은 오탐 억제를 위해 공백 1개를 유지하므로 별도다.
// 텍스트 추출 불가 형식이면 (nil, false).
func TextHash(filename string, data []byte) ([]byte, bool) {
	text, ok := ExtractText(filename, data)
	if !ok {
		return nil, false
	}
	stripped := strings.Join(strings.Fields(NormalizeForFP(text)), "")
	sum := sha256.Sum256([]byte(stripped))
	return sum[:], true
}

// Similarity 는 두 시그니처의 Jaccard 유사도 추정치(0~1)다.
func Similarity(a, b []uint64) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	match := 0
	for i := range a {
		if a[i] == b[i] {
			match++
		}
	}
	return float64(match) / float64(len(a))
}

// Buckets 는 LSH 밴드 버킷 키를 만든다 — 같은 버킷을 공유하는 문서만
// 후보로 조회해 전수 비교를 피한다.
func Buckets(sig []uint64) []string {
	out := make([]string, 0, lshBands)
	for b := 0; b < lshBands; b++ {
		h := fnv.New64a()
		var buf [8]byte
		for r := 0; r < lshRows; r++ {
			binary.BigEndian.PutUint64(buf[:], sig[b*lshRows+r])
			h.Write(buf[:])
		}
		out = append(out, fmt.Sprintf("%d:%016x", b, h.Sum64()))
	}
	return out
}

// Encode / Decode — 시그니처의 저장 형식 (uint64 × 128, big-endian).
func Encode(sig []uint64) []byte {
	out := make([]byte, len(sig)*8)
	for i, v := range sig {
		binary.BigEndian.PutUint64(out[i*8:], v)
	}
	return out
}

func Decode(b []byte) ([]uint64, error) {
	if len(b) == 0 || len(b)%8 != 0 {
		return nil, fmt.Errorf("fingerprint: invalid signature length %d", len(b))
	}
	sig := make([]uint64, len(b)/8)
	for i := range sig {
		sig[i] = binary.BigEndian.Uint64(b[i*8:])
	}
	if len(sig) != SigSize {
		return nil, fmt.Errorf("fingerprint: signature size %d != %d", len(sig), SigSize)
	}
	return sig, nil
}
