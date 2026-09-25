package server

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// deepVerdict 는 docsim 정밀 비교 결과의 요약이다(웹 표시용).
type deepVerdict struct {
	Relation string  `json:"relation,omitempty"` // identical|revision|excerpt|rewrite|unrelated ...
	Label    string  `json:"label,omitempty"`    // 한글 판정 문구
	Shingle  float64 `json:"shingle,omitempty"`  // 문자 유사도(자카드)
	Semantic float64 `json:"semantic,omitempty"` // 의미 유사도(max cosine)
	// 아래는 시각화용 세부(유사도 테스트 메뉴): 포함률·청크 연결·판정 요약.
	Summary    string      `json:"summary,omitempty"`
	Confidence string      `json:"confidence,omitempty"`
	ContainAB  float64     `json:"containAB,omitempty"` // A 내용 중 B에 있는 비율
	ContainBA  float64     `json:"containBA,omitempty"`
	ChunksA    int         `json:"chunksA,omitempty"` // 의미 청크 수(지문에서 셈)
	ChunksB    int         `json:"chunksB,omitempty"`
	TopPairs   []chunkPair `json:"topPairs,omitempty"` // 상위 청크쌍(docsim top_pairs)
}

type chunkPair struct {
	A      int     `json:"a"`
	B      int     `json:"b"`
	Cosine float64 `json:"cosine"`
}

// docsimChunkCount 는 docsim 지문 JSON의 의미 청크 수를 센다(실패 시 0).
func docsimChunkCount(fpJSON string) int {
	var fp struct {
		Embed struct {
			Chunks []json.RawMessage `json:"chunks"`
		} `json:"embed"`
	}
	if json.Unmarshal([]byte(fpJSON), &fp) != nil {
		return 0
	}
	return len(fp.Embed.Chunks)
}

// docsimFingerprintText 는 텍스트의 docsim 지문(JSON)을 만든다.
// docsim 코드는 수정하지 않고 CLI 서브프로세스로만 호출한다.
func docsimFingerprintText(bin, dir, text string) (string, error) {
	in, err := os.CreateTemp("", "lm-docsim-q-*.txt")
	if err != nil {
		return "", err
	}
	defer os.Remove(in.Name())
	if _, err := in.WriteString(text); err != nil {
		return "", err
	}
	in.Close()
	out, err := os.CreateTemp("", "lm-docsim-q-*.fp.json")
	if err != nil {
		return "", err
	}
	out.Close()
	defer os.Remove(out.Name())
	cmd := exec.Command(bin, "fingerprint", in.Name(), "-o", out.Name())
	cmd.Env = os.Environ()
	cmd.Dir = dir
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("docsim fingerprint: %v: %s", err, strings.TrimSpace(string(b)))
	}
	b, err := os.ReadFile(out.Name())
	return string(b), err
}

// docsimCompareFP 는 두 docsim 지문을 compare-fp로 비교해 요약을 반환한다.
func docsimCompareFP(bin, dir, aFP, bFP string) (*deepVerdict, error) {
	af, err := os.CreateTemp("", "lm-docsim-a-*.fp.json")
	if err != nil {
		return nil, err
	}
	defer os.Remove(af.Name())
	af.WriteString(aFP)
	af.Close()
	bf, err := os.CreateTemp("", "lm-docsim-b-*.fp.json")
	if err != nil {
		return nil, err
	}
	defer os.Remove(bf.Name())
	bf.WriteString(bFP)
	bf.Close()

	cmd := exec.Command(bin, "compare-fp", af.Name(), bf.Name(), "--json")
	cmd.Env = os.Environ()
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("docsim compare-fp: %w", err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(out, &m); err != nil {
		return nil, err
	}
	v := &deepVerdict{ChunksA: docsimChunkCount(aFP), ChunksB: docsimChunkCount(bFP)}
	if vd, ok := m["verdict"].(map[string]interface{}); ok {
		v.Relation, _ = vd["relation"].(string)
		v.Label, _ = vd["label"].(string)
		v.Summary, _ = vd["summary"].(string)
		v.Confidence, _ = vd["confidence"].(string)
	}
	if sh, ok := m["shingle"].(map[string]interface{}); ok {
		v.Shingle, _ = sh["jaccard"].(float64)
		v.ContainAB, _ = sh["containment_a_in_b"].(float64)
		v.ContainBA, _ = sh["containment_b_in_a"].(float64)
	}
	if em, ok := m["embed"].(map[string]interface{}); ok {
		v.Semantic, _ = em["max_cosine"].(float64)
		if pairs, ok := em["top_pairs"].([]interface{}); ok {
			for _, p := range pairs {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				ai, _ := pm["a_index"].(float64)
				bi, _ := pm["b_index"].(float64)
				cos, _ := pm["cosine"].(float64)
				v.TopPairs = append(v.TopPairs, chunkPair{A: int(ai), B: int(bi), Cosine: cos})
			}
		}
	}
	return v, nil
}
