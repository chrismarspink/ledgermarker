"""관계 판정 — 두 엔진의 개별 수치를 규칙으로 해석해 A↔B 관계를 말로 풀어준다.

★ 종합 점수를 만들지 않는다. 각 엔진 수치는 그대로 두고, config.verdict 의 임계값으로 관계 유형만 고른다.
임계값은 `docsim eval` 리포트 (c) 표의 목표 FPR 임계값을 보고 config 에서 조정한다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from docsim.core.config import Config
from docsim.core.schema import CompareResult, Fingerprint
from docsim.engines.shingle.compare import NOISE_FLOOR_WARNING


@dataclass
class Verdict:
    relation: str               # identical | revision | added | excerpt | rewrite | partial | unrelated | insufficient
    label: str                  # 한글 관계명
    direction: str | None       # "A→B" (B가 A에서 파생), "B→A", None(방향 없음/불명)
    summary: str                # 한 문장 결론 (수치 포함)
    confidence: str             # 높음 | 중간 | 낮음
    evidence: dict[str, float] = field(default_factory=dict)
    basis: list[str] = field(default_factory=list)   # 어떤 규칙이 적용됐는지

    def as_dict(self) -> dict:
        return asdict(self)


def _pct(x: float) -> str:
    return f"{max(0.0, min(1.0, x)) * 100:.0f}%"


def judge(r: CompareResult, fp_a: Fingerprint | None, fp_b: Fingerprint | None, cfg: Config) -> Verdict | None:
    if not bool(cfg.get("verdict.enabled")):
        return None
    t_near = float(cfg.get("verdict.jaccard_near_dup"))
    t_rel = float(cfg.get("verdict.jaccard_related"))
    t_cont = float(cfg.get("verdict.containment_excerpt"))
    t_asym = float(cfg.get("verdict.containment_asym"))
    t_rw = float(cfg.get("verdict.cosine_rewrite"))
    t_part = float(cfg.get("verdict.cosine_partial"))

    s, e = r.shingle, r.embed
    ev: dict[str, float] = {}
    if s is not None:
        ev.update(jaccard=round(s.jaccard, 4), containment_a_in_b=round(s.containment_a_in_b, 4),
                  containment_b_in_a=round(s.containment_b_in_a, 4))
    if e is not None:
        ev["max_cosine"] = round(e.max_cosine, 4)
    if fp_a is not None and fp_b is not None:
        ev["norm_len_a"] = fp_a.norm_len
        ev["norm_len_b"] = fp_b.norm_len
    noisy = any(NOISE_FLOOR_WARNING in w for w in r.warnings)

    if r.identical:
        return Verdict("identical", "동일 문서", None, "A와 B는 정규화 후 완전히 동일한 문서입니다 (hash_norm 일치, 일치율 100%).",
                       "높음", ev, ["hash_norm 일치"])

    if s is None and e is None:
        return Verdict("insufficient", "판정 불가", None, "두 엔진 결과가 모두 없어 판정할 수 없습니다.", "낮음", ev, [])

    j = s.jaccard if s else 0.0
    ca = s.containment_a_in_b if s else 0.0      # A 의 조각 중 B 에도 있는 비율
    cb = s.containment_b_in_a if s else 0.0      # B 의 조각 중 A 에도 있는 비율
    cos = e.max_cosine if e else 0.0
    len_a = fp_a.norm_len if fp_a else None
    len_b = fp_b.norm_len if fp_b else None
    b_longer = (len_b > len_a) if (len_a is not None and len_b is not None) else (cb < ca)

    # 1) 개정판 / 추가 (문자 조각이 대부분 겹침)
    if s is not None and j >= t_near:
        conf = "높음" if j >= (t_near + 1.0) / 2 else "중간"
        if ca - cb >= t_asym and b_longer:
            return Verdict("added", "추가·확장 (A→B)", "A→B",
                           f"B는 A에 내용을 덧붙인 문서입니다. A 내용의 {_pct(ca)}가 B에 있고, B 내용 중 약 {_pct(1 - cb)}가 새로 추가된 부분입니다 "
                           f"(자카드 {j:.3f}, 의미 유사도 {cos:.3f}).", conf, ev, [f"jaccard≥{t_near}", f"A⊆B - B⊆A ≥ {t_asym}", "B가 더 김"])
        if cb - ca >= t_asym and not b_longer:
            return Verdict("added", "추가·확장 (B→A)", "B→A",
                           f"A는 B에 내용을 덧붙인 문서입니다. B 내용의 {_pct(cb)}가 A에 있고, A 내용 중 약 {_pct(1 - ca)}가 새로 추가된 부분입니다 "
                           f"(자카드 {j:.3f}, 의미 유사도 {cos:.3f}).", conf, ev, [f"jaccard≥{t_near}", f"B⊆A - A⊆B ≥ {t_asym}", "A가 더 김"])
        return Verdict("revision", "개정판·파생", None,
                       f"A와 B는 같은 문서의 개정판(파생본)입니다. 문자 조각 {_pct(j)}가 일치하고 (자카드 {j:.3f}), "
                       f"A 내용의 {_pct(ca)} / B 내용의 {_pct(cb)}가 서로에게 존재합니다. 의미 유사도 {cos:.3f}.",
                       conf, ev, [f"jaccard≥{t_near}"])

    # 2) 발췌 / 부분 포함 (한 방향 포함도만 높음)
    if s is not None and max(ca, cb) >= t_cont and abs(ca - cb) >= t_asym:
        conf = "중간" if noisy else "높음"
        if cb > ca:
            return Verdict("excerpt", "발췌 (A→B)", "A→B",
                           f"B는 A의 일부를 발췌한 문서입니다. B 내용의 {_pct(cb)}가 A에 존재하며, 이는 A 전체의 약 {_pct(ca)}에 해당합니다 "
                           f"(자카드 {j:.3f}, 의미 유사도 {cos:.3f}).", conf, ev,
                           [f"B⊆A≥{t_cont}", f"비대칭≥{t_asym}"] + (["노이즈 플로어 경고 → 신뢰도 하향"] if noisy else []))
        return Verdict("excerpt", "발췌 (B→A)", "B→A",
                       f"A는 B의 일부를 발췌한 문서입니다. A 내용의 {_pct(ca)}가 B에 존재하며, 이는 B 전체의 약 {_pct(cb)}에 해당합니다 "
                       f"(자카드 {j:.3f}, 의미 유사도 {cos:.3f}).", conf, ev,
                       [f"A⊆B≥{t_cont}", f"비대칭≥{t_asym}"] + (["노이즈 플로어 경고 → 신뢰도 하향"] if noisy else []))

    # 3) 재작성 (문자 조각은 안 겹치는데 뜻이 같음)
    if e is not None and cos >= t_rw:
        conf = "높음" if cos >= (t_rw + 1.0) / 2 else "중간"
        top = e.top_pairs[0] if e.top_pairs else None
        where = f" (A청크{top.a_index} ↔ B청크{top.b_index})" if top else ""
        return Verdict("rewrite", "재작성 (같은 내용, 다른 표현)", None,
                       f"A와 B는 같은 내용을 다르게 쓴 문서입니다. 문자 조각 일치는 {_pct(j)}에 그치지만 (자카드 {j:.3f}) "
                       f"의미 유사도는 {cos:.3f}입니다{where}.", conf, ev, [f"cosine≥{t_rw}", f"jaccard<{t_near}"])

    # 4) 부분 유사
    if (s is not None and j >= t_rel) or (e is not None and cos >= t_part):
        parts = []
        if s is not None and j >= t_rel:
            parts.append(f"문자 조각 {_pct(j)} 일치 (자카드 {j:.3f})")
        if e is not None and cos >= t_part:
            parts.append(f"의미 유사도 {cos:.3f}")
        return Verdict("partial", "일부 유사", None,
                       f"A와 B는 일부 내용이 유사합니다: {', '.join(parts)}. 서식만 같은 문서일 수 있으니 DF/서식 제외 설정을 확인하십시오.",
                       "낮음", ev, [f"jaccard≥{t_rel} 또는 cosine≥{t_part}"])

    # 5) 무관
    return Verdict("unrelated", "무관", None,
                   f"A와 B는 서로 무관한 문서입니다 (자카드 {j:.3f}, 최대 포함도 {max(ca, cb):.3f}, 의미 유사도 {cos:.3f}).",
                   "높음" if (cos < t_part - 0.1 and j < t_rel / 2) else "중간", ev, ["모든 임계값 미달"])


def render_verdict(v: Verdict) -> str:
    arrow = f"  방향 {v.direction}" if v.direction else ""
    lines = [
        "┌─ 판정 (규칙 기반 해석 · 합산 점수 없음) ────────────────────┐",
        f"   관계            {v.label}{arrow}",
        f"   신뢰도          {v.confidence}",
        f"   결론            {v.summary}",
        f"   근거 규칙       {' / '.join(v.basis) if v.basis else '-'}",
        "└─────────────────────────────────────────────────────────┘",
    ]
    return "\n".join(lines)
