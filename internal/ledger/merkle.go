package ledger

import "crypto/sha256"

// MerkleRoot 는 row_hash 목록의 머클 루트를 계산한다.
// RFC 6962 방식(리프 0x00, 내부 0x01 프리픽스, 불균형은 승격)을 쓴다 —
// Phase 2 tlog-tiles(Tessera) 전환을 염두에 둔 선택이다.
func MerkleRoot(leaves [][]byte) []byte {
	if len(leaves) == 0 {
		s := sha256.Sum256(nil)
		return s[:]
	}
	level := make([][]byte, len(leaves))
	for i, l := range leaves {
		h := sha256.New()
		h.Write([]byte{0x00})
		h.Write(l)
		level[i] = h.Sum(nil)
	}
	for len(level) > 1 {
		next := make([][]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			if i+1 == len(level) { // 홀수: 승격
				next = append(next, level[i])
				continue
			}
			h := sha256.New()
			h.Write([]byte{0x01})
			h.Write(level[i])
			h.Write(level[i+1])
			next = append(next, h.Sum(nil))
		}
		level = next
	}
	return level[0]
}
