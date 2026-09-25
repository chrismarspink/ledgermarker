# docsim — 두 엔진 나란히 문서 유사도 비교

두 문서의 유사도를 **서로 독립된 두 방식**으로 각각 계산해 나란히 보여준다. 종합 점수는 만들지 않는다.

> 알고리즘·비교 방식·판정 규칙·성능(MPS/스레드/캐시)·배포까지 개발자용 상세는 [docs/DEVELOPER.md](docs/DEVELOPER.md) 에 있다. 웹 UI 의 "도움말" 탭에서도 같은 내용을 본다.

| 엔진 | 방식 | 잡는 것 |
|---|---|---|
| **A · `shingle`** | 문자 9-gram → HMAC → MinHash(128) → 자카드 / 포함도 | 복사·붙여넣기, 개정판, 발췌 |
| **B · `embed`** | 문장 청크(≤120 토큰) → ko-sroberta → 코퍼스 평균 중심화 → 이진화 → 해밍 → int8 재정렬 → **max** 집계 | 다르게 쓴 같은 내용 |

원문은 어디에도 저장하지 않는다. 지문(`*.fp.json`)만 남는다.

## 설치 / 기동

```bash
python3.12 -m venv .venv && .venv/bin/pip install -e ".[formats,dev]"
export DOCSIM_HMAC_KEY='실제-비밀키'          # 슁글 HMAC 키 (없으면 shingle 엔진 기동 불가)
export HF_HUB_OFFLINE=1                       # 폐쇄망: 모델은 ./models/ 또는 HF 캐시에 미리 둔다

docsim doctor                                 # 환경 검증 — max_seq_length 실측, SBERT 게이트
python scripts/make_corpus.py corpus 1200     # (검증용) 합성 코퍼스. 실무에서는 실제 코퍼스를 쓴다
docsim build-mu corpus -o mu.npy              # ★ 중심화 벡터. 없으면 embed 엔진은 기동 거부
docsim check-mu mu.npy --corpus corpus        # 비트 균형 검사
```

`embed.model_id` 에 로컬 경로(`./models/ko-sroberta-multitask`)를 넣으면 인터넷 없이 동작한다.

## 사용

```bash
docsim compare A.txt B.txt [--engine shingle|embed|both] [--json]
docsim fingerprint A.txt -o A.fp.json
docsim compare-fp A.fp.json B.fp.json         # 원문 없이 비교

docsim registry add docs/ --registry ./reg    # 1:N — 지문만 쌓인다
docsim registry query new.txt --registry ./reg --top 10
docsim registry stats --registry ./reg

docsim search new.txt ~/Documents/공문 --sort sim|date   # 폴더에서 유사 문서 찾기 (지문 캐시, 유사도순/날짜순)
docsim build-df corpus -o df.bin --cutoff 0.4 # (선택) 공문 서식 슁글 억제 테이블 → config shingle.df
docsim eval pairs.jsonl -o eval_report/ --seed 42   # ★ 평가 하니스: 엔진별 고유 검출
docsim serve --port 8765                      # 웹 UI: 파일 선택(txt/docx/pdf/hwpx/hwp) → 판정 + 원형 게이지(문자 유사도/의미 비교/포함도) + 엔진별 상세
                                              # API: POST /compare (multipart file_a,file_b 또는 JSON a,b), POST /fingerprint, GET /health
```

지원 포맷: txt / md / docx / pdf / hwpx / hwp(5.0, 비암호). 추출 실패는 빈 문자열이 아니라 에러다.

**스캔 PDF(텍스트 레이어 없음)**: `pip install -e ".[ocr]"` 후 `config.extract.ocr` 로 OCR 폴백이 켜진다.
텍스트가 `min_chars_per_page` 미만인 페이지만 `dpi` 로 렌더링해 OCR 한다. 백엔드는 macOS Vision(오프라인, 한국어 지원) 또는
tesseract(`kor` traineddata 필요). 둘 다 없으면 어떤 페이지가 스캔인지 알려주는 명시적 에러를 낸다. `docsim doctor` 의 `[추출]` 절에서 상태를 확인한다.

### 관계 판정 (`verdict`)

`compare` / `compare-fp` / 웹 UI / `POST /compare` 결과 끝에 두 엔진 수치를 **규칙으로 해석**한 결론이 붙는다.
점수를 합치지 않고 관계 유형만 고르며, 임계값은 `config.yaml`의 `verdict` 섹션에서 읽는다 (`enabled: false` 로 끌 수 있다).

| relation | 뜻 | 규칙 (기본값) |
|---|---|---|
| `identical` | 동일 문서 | hash_norm 일치 |
| `revision` | 개정판·파생 | 자카드 ≥ 0.70, 포함도 대칭 |
| `added` | 추가·확장 (방향 A→B / B→A) | 자카드 ≥ 0.70, 한쪽 포함도가 0.15 이상 크고 그쪽이 더 긺 → "B의 약 N%가 새 내용" |
| `excerpt` | 발췌 (방향) | 한 방향 포함도 ≥ 0.80, 비대칭 ≥ 0.15 → "B의 N%가 A에 존재, A 전체의 M%" |
| `rewrite` | 재작성 | 자카드 < 0.70, 코사인 ≥ 0.83 |
| `partial` | 일부 유사 | 자카드 ≥ 0.20 또는 코사인 ≥ 0.75 |
| `unrelated` | 무관 | 나머지 |

신뢰도(높음/중간/낮음)는 임계값과의 거리, 노이즈 플로어 경고 여부로 정한다. 임계값 0.20 / 0.83 은 합성 페어셋 `eval` 의 FPR 5% 값이며 실무 페어셋으로 다시 잡아야 한다.

## 절대 규칙 구현 위치

| 규칙 | 위치 |
|---|---|
| R1 단일 정규화 | `core/normalize.py` — `NORM_VERSION` 변경 시 이전 지문 전부 무효 |
| R2 엔진 상호 참조 금지 | `engines/shingle/`, `engines/embed/` 는 서로 import 하지 않음 (`gate_check.sh` grep) |
| R3 `shingle_count` 필수 | `core/schema.py` — 누락 시 `SchemaError` |
| R4 SBERT 게이트 | `engines/embed/model.py::verify_sbert` — 4개 탐침쌍 margin < `embed.sbert_gate_margin` 이면 기동 거부 |
| R5 `max_seq_length` 실측 | `model.max_seq_length` 를 읽어 지문에 기록. `chunk_tokens` 초과 시 `ConfigError`, 청크 초과 시 `ChunkTooLongError` |
| R6 mu 중심화 | `engines/embed/centering.py` — mu 없으면 `MuMissingError`, `sign(x)` 폴백 없음 |
| R7 max 집계 | `engines/embed/compare.py` — 문서 평균 벡터 없음 |
| R8 상수는 config | `core/config.py::Config.get` 은 키 누락 시 에러 (코드 기본값 없음) |
| R9 버전 고정 | `core/schema.py::check_compatible` — norm/schema/model/mu/df/seed/key_id 불일치 시 계산 전 에러 |
| R10 원문 비영속 | 지문·로그·에러에 원문 없음. `fingerprint --unsafe-dump-text` 만 예외 |

## 평가 (Phase 5)

```bash
python scripts/make_pairs.py evalset 20      # 라벨 5종 × 20 = 100 페어 (합성)
docsim eval evalset/pairs.jsonl -o eval_report --seed 42
```

리포트 4종: (a) 라벨별 p50/p95, (b) ROC/PR (csv), (c) 목표 FPR별 임계값·재현율, (d) ★ 엔진별 고유 검출 + 판정 보조.
`same_form_unrelated` 비율이 15% 미만이면 경고한다 — 이 라벨이 없으면 임계값이 반드시 잘못 잡힌다.

## 테스트 / 게이트

```bash
./scripts/gate_check.sh 0   # … 5   Phase 게이트 자동 검증
./scripts/smoke.sh          # 합성 문서쌍 → 지문 → 원본 삭제 → compare-fp → 범위 assert
.venv/bin/pytest -q -m "not slow"   # 실모델 없이 돌아가는 단위 테스트
```

## 알려진 한계 (사람이 결정할 것)

- **발췌 포함도 추정 (게이트 1 항목)**: 사양의 `I = j(|A|+|B|)/(1+j)` 는 j 의 상대오차를 그대로 물려받아,
  J≈0.05 발췌에서 `containment_b_in_a > 0.9` 는 128 순열에서 약 45% 만 만족한다 (정확 포함도는 100% 1.0).
  `jaccard below noise floor` 경고로 표시만 하고 있다. 필요하면 bottom-k 스케치 등 별도 포함도 추정기를 도입한다 (사양 변경).
- 정규화가 개행을 접기 때문에 청킹은 문단(`\n\n`)이 아니라 문장 경계로만 한다.
- `embed.max_cosine` 은 int8 재정렬 시 원 벡터 코사인, int8 미저장 시 중심화 비트의 해밍 추정치다 (경고로 구분).
- hwp 는 실제 파일로 검증하지 못했다 (생성 도구 부재). 레코드 파서만 합성 바이트로 검증.
