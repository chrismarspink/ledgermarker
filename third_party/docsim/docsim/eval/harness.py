"""페어 데이터셋 평가 하니스 — ★ 이 작업의 최종 목적: 엔진별 고유 검출을 숫자로 낸다.

입력: pairs.jsonl  {"a": path, "b": path, "label": revision|excerpt|rewrite|same_form_unrelated|unrelated}
출력: report.md / report.json / roc_*.csv / pr_*.csv / scores.jsonl  (원문 없음)
"""

from __future__ import annotations

import json
import logging
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

from docsim.core.config import Config
from docsim.core.errors import ConfigError
from docsim.eval import metrics as M
from docsim.pipeline import Pipeline, compare_fingerprints

log = logging.getLogger("docsim.eval")

SAME_FORM_WARNING = "same_form_unrelated 비율이 낮습니다 — 임계값이 잘못 잡힐 수 있습니다"


@dataclass
class Pair:
    a: str
    b: str
    label: str


@dataclass
class ScoreRow:
    a: str
    b: str
    label: str
    positive: bool
    identical: bool
    jaccard: float | None
    containment_max: float | None
    cosine: float | None


def load_pairs(path: str | Path, base_dir: Path | None = None) -> list[Pair]:
    p = Path(path)
    base = base_dir or p.parent
    pairs: list[Pair] = []
    with open(p, "r", encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            for k in ("a", "b", "label"):
                if k not in d:
                    raise ConfigError(f"{p}:{ln} 에 '{k}' 가 없습니다")
            if d["label"] not in M.ALL_LABELS:
                raise ConfigError(f"{p}:{ln} 알 수 없는 라벨 '{d['label']}' (허용: {M.ALL_LABELS})")
            a, b = Path(d["a"]), Path(d["b"])
            pairs.append(Pair(str(a if a.is_absolute() else base / a), str(b if b.is_absolute() else base / b), d["label"]))
    if not pairs:
        raise ConfigError(f"페어가 비어 있습니다: {p}")
    return pairs


def validate_pairs(pairs: list[Pair], cfg: Config, warnings: list[str]) -> dict[str, int]:
    counts = {lab: 0 for lab in M.ALL_LABELS}
    for pr in pairs:
        counts[pr.label] += 1
    missing = [lab for lab, c in counts.items() if c == 0]
    if missing:
        warnings.append(f"라벨 누락: {missing} — 리포트 일부가 비게 됩니다")
    ratio = counts["same_form_unrelated"] / len(pairs)
    if ratio < float(cfg.get("eval.min_same_form_ratio")):
        warnings.append(f"{SAME_FORM_WARNING} (현재 {ratio:.1%} < {float(cfg.get('eval.min_same_form_ratio')):.0%})")
    return counts


def _seed_all(seed: int | None) -> None:
    if seed is None:
        return
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
    except Exception:  # noqa: BLE001
        pass


def score_pairs(pairs: list[Pair], cfg: Config, pipe: Pipeline, engine: str = "both") -> list[ScoreRow]:
    cache: dict[str, Any] = {}

    def fp_of(path: str):
        if path not in cache:
            cache[path] = pipe.fingerprint_file(path)
        return cache[path]

    rows: list[ScoreRow] = []
    for i, pr in enumerate(pairs):
        r = compare_fingerprints(fp_of(pr.a), fp_of(pr.b), cfg, engine)
        rows.append(ScoreRow(
            a=Path(pr.a).name, b=Path(pr.b).name, label=pr.label, positive=M.is_positive(pr.label), identical=r.identical,
            jaccard=(r.shingle.jaccard if r.shingle else None),
            containment_max=(max(r.shingle.containment_a_in_b, r.shingle.containment_b_in_a) if r.shingle else None),
            cosine=(r.embed.max_cosine if r.embed else None),
        ))
        if (i + 1) % 50 == 0:
            log.info("%d/%d 페어 평가", i + 1, len(pairs))
    return rows


def build_report(rows: list[ScoreRow], cfg: Config, warnings: list[str], seed: int | None) -> dict[str, Any]:
    labels = [r.label for r in rows]
    y = np.array([r.positive for r in rows], dtype=bool)
    engines: dict[str, np.ndarray] = {}
    if all(r.jaccard is not None for r in rows):
        engines["A_jaccard"] = np.array([r.jaccard for r in rows], dtype=np.float64)
        engines["A_containment"] = np.array([r.containment_max for r in rows], dtype=np.float64)
    if all(r.cosine is not None for r in rows):
        engines["B_cosine"] = np.array([r.cosine for r in rows], dtype=np.float64)
    if not engines:
        raise ConfigError("두 엔진 모두 점수가 없어 리포트를 만들 수 없습니다")

    # (a) 라벨별 분포
    dist: dict[str, dict[str, dict[str, float]]] = {}
    arr = np.array(labels)
    for lab in M.ALL_LABELS:
        m = arr == lab
        dist[lab] = {"n": int(m.sum())}
        for name, s in engines.items():
            dist[lab][name] = M.percentiles(s[m])

    # (b) ROC / PR
    curves: dict[str, Any] = {}
    for name, s in engines.items():
        fpr, tpr, thr = M.roc_curve(s, y)
        prec, rec, pthr = M.pr_curve(s, y)
        curves[name] = {
            "roc_auc": M.auc(fpr, tpr), "pr_auc": M.auc(rec, prec) if rec.size > 1 else float("nan"),
            "roc": {"fpr": fpr.tolist(), "tpr": tpr.tolist(), "threshold": [None if np.isinf(t) else float(t) for t in thr]},
            "pr": {"precision": prec.tolist(), "recall": rec.tolist(), "threshold": pthr.tolist()},
        }

    # (c) 목표 FPR 임계값
    targets = [float(t) for t in cfg.get("eval.target_fprs")]
    thresholds: dict[str, list[dict[str, float]]] = {
        name: [asdict(M.threshold_at_fpr(s, y, t)) for t in targets] for name, s in engines.items()
    }

    # (d) 고유 검출 — 결정 FPR 에서의 임계값으로 검출 판정
    decision_fpr = float(cfg.get("eval.decision_fpr"))
    unique = None
    judgement: list[str] = []
    recall_lab: dict[str, dict[str, float]] = {}
    det: dict[str, np.ndarray] = {}
    for name, s in engines.items():
        thr = M.threshold_at_fpr(s, y, decision_fpr).threshold
        det[name] = s >= thr
        recall_lab[name] = M.recall_by_label(det[name], labels)
    if "A_jaccard" in det and "B_cosine" in det:
        unique = M.unique_detection(det["A_jaccard"], det["B_cosine"], y, labels)
        n = len(rows)
        ra, rb = recall_lab["A_jaccard"], recall_lab["B_cosine"]
        rw_n = labels.count("rewrite")
        judgement.append(f"결정 임계값: 목표 FPR {decision_fpr:.0%} (엔진A 자카드 ≥ {M.threshold_at_fpr(engines['A_jaccard'], y, decision_fpr).threshold:.3f}, "
                         f"엔진B 코사인 ≥ {M.threshold_at_fpr(engines['B_cosine'], y, decision_fpr).threshold:.3f})")
        if rw_n:
            judgement.append(f"rewrite 라벨에서 엔진A 재현율 {ra['rewrite']:.2f}, 엔진B 재현율 {rb['rewrite']:.2f}")
            if rb["rewrite"] - ra["rewrite"] >= 0.3:
                judgement.append("→ 엔진 B는 엔진 A가 원리적으로 못 하는 영역을 담당함. 도입 근거 있음.")
            elif rb["rewrite"] > ra["rewrite"]:
                judgement.append("→ 엔진 B가 재작성에서 우세하나 차이가 크지 않음. 페어 수를 늘려 재측정 권장.")
            else:
                judgement.append("→ 재작성에서 엔진 B 우위가 확인되지 않음. 도입 근거 부족.")
            judgement.append(f"단, rewrite 라벨이 전체 페어의 {rw_n / n:.1%}.")
            judgement.append("→ 실무에서 재작성 문서 비중이 낮다면 엔진 B 비용 대비 이득 재검토 필요.")
        sf = dist["same_form_unrelated"]
        if sf["n"]:
            a_sf, b_sf = sf["A_jaccard"]["p95"], sf["B_cosine"]["p95"]
            a_pos = float(np.percentile(engines["A_jaccard"][y], 50)) if y.any() else float("nan")
            b_pos = float(np.percentile(engines["B_cosine"][y], 50)) if y.any() else float("nan")
            if a_sf >= a_pos:
                judgement.append(f"⚠ 엔진A: same_form_unrelated p95({a_sf:.2f}) ≥ 유사 라벨 p50({a_pos:.2f}) — DF 컷오프 강화 필요")
            if b_sf >= b_pos:
                judgement.append(f"⚠ 엔진B: same_form_unrelated p95({b_sf:.2f}) ≥ 유사 라벨 p50({b_pos:.2f}) — 서식 청크 제외 강화 필요")
        judgement.append(f"B만 검출 {unique.b_only}건 / A만 검출 {unique.a_only}건 / 둘 다 {unique.both}건 / 둘 다 놓침 {unique.neither}건 (양성 {unique.total_positive}건)")

    return {
        "n_pairs": len(rows),
        "seed": seed,
        "label_counts": {lab: int((arr == lab).sum()) for lab in M.ALL_LABELS},
        "warnings": warnings,
        "judgement": judgement,
        "distribution": dist,
        "curves": curves,
        "thresholds": thresholds,
        "decision_fpr": decision_fpr,
        "recall_by_label": recall_lab,
        "unique_detection": unique.as_dict() if unique else None,
        "config_snapshot": {k: cfg.get(k) for k in ("shingle.k", "shingle.minhash.perms", "shingle.df.enabled",
                                                      "embed.model_id", "embed.chunk_tokens", "embed.overlap_ratio",
                                                      "embed.boilerplate.enabled", "embed.rerank.enabled")},
    }


def _fmt(x) -> str:
    return "  -  " if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.2f}"


def render_markdown(rep: dict[str, Any]) -> str:
    L: list[str] = ["# docsim 평가 리포트", ""]
    L.append(f"페어 {rep['n_pairs']}건 · seed={rep['seed']} · 라벨 분포 {rep['label_counts']}")
    L.append("")
    if rep["warnings"]:
        L.append("## 경고")
        L += [f"- {w}" for w in rep["warnings"]]
        L.append("")
    L.append("## [판정 보조]")
    L += [f"  {j}" for j in rep["judgement"]] or ["  (두 엔진 점수가 모두 있어야 산출)"]
    L.append("")
    names = [n for n in ("A_jaccard", "A_containment", "B_cosine") if n in next(iter(rep["distribution"].values()))]
    L.append("## (a) 엔진별 라벨별 점수 분포")
    L.append("```")
    head = f"{'라벨':<22}{'n':>5}" + "".join(f"{n + ' p50':>20}{'p95':>7}" for n in names)
    L.append(head)
    for lab, d in rep["distribution"].items():
        star = "  ← ★" if lab == "same_form_unrelated" else ""
        L.append(f"{lab:<22}{d['n']:>5}" + "".join(f"{_fmt(d[n]['p50']):>20}{_fmt(d[n]['p95']):>7}" for n in names) + star)
    L.append("```")
    L.append("")
    L.append("## (b) ROC / PR")
    L.append("```")
    for n in names:
        c = rep["curves"][n]
        L.append(f"{n:<16} ROC AUC {_fmt(c['roc_auc'])}   PR AUC {_fmt(c['pr_auc'])}   (곡선 좌표: roc_{n}.csv, pr_{n}.csv)")
    L.append("```")
    L.append("")
    L.append("## (c) 목표 FPR별 임계값")
    L.append("```")
    L.append(f"{'목표 FPR':<10}" + "".join(f"{n + ' 임계값':>20}{'재현율':>8}" for n in names))
    for i, t in enumerate(rep["thresholds"][names[0]]):
        L.append(f"{t['target_fpr']:<10.0%}" + "".join(f"{rep['thresholds'][n][i]['threshold']:>20.3f}{rep['thresholds'][n][i]['recall']:>8.2f}" for n in names))
    L.append("```")
    L.append("")
    L.append(f"## (d) ★ 엔진별 고유 검출 (결정 FPR {rep['decision_fpr']:.0%})")
    u = rep["unique_detection"]
    if u is None:
        L.append("(두 엔진 점수가 모두 있어야 산출)")
    else:
        L.append("```")
        L.append(f"{'':<30}{'건수':>6}{'비율':>9}")
        for k in ("A만 검출 (B 놓침)", "B만 검출 (A 놓침)", "둘 다 검출", "둘 다 놓침"):
            tag = "   ← 엔진B 도입 근거" if k.startswith("B만") else ""
            L.append(f"{k:<30}{u[k]['count']:>6}{u[k]['ratio']:>9.1%}{tag}")
        L.append("")
        L.append(f"\"B만 검출\" {u['B만 검출 (A 놓침)']['count']}건의 라벨 분포:")
        for lab, c in u["B만 검출 라벨 분포"].items():
            L.append(f"  {lab:<22}{c:>4} 건")
        L.append(f"\"A만 검출\" {u['A만 검출 (B 놓침)']['count']}건의 라벨 분포:")
        for lab, c in u["A만 검출 라벨 분포"].items():
            L.append(f"  {lab:<22}{c:>4} 건")
        L.append("```")
    L.append("")
    L.append("## 라벨별 재현율 (결정 임계값 기준)")
    L.append("```")
    for n, d in rep["recall_by_label"].items():
        L.append(f"{n:<16}" + "  ".join(f"{lab}={_fmt(v)}" for lab, v in d.items()))
    L.append("```")
    L.append("")
    L.append(f"설정 스냅샷: {rep['config_snapshot']}")
    return "\n".join(L) + "\n"


def write_report(rep: dict[str, Any], rows: list[ScoreRow], out_dir: str | Path) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.md").write_text(render_markdown(rep), encoding="utf-8")
    (out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2, allow_nan=True), encoding="utf-8")
    with open(out / "scores.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")
    for name, c in rep["curves"].items():
        with open(out / f"roc_{name}.csv", "w", encoding="utf-8") as f:
            f.write("fpr,tpr,threshold\n")
            for a, b, t in zip(c["roc"]["fpr"], c["roc"]["tpr"], c["roc"]["threshold"]):
                f.write(f"{a},{b},{'' if t is None else t}\n")
        with open(out / f"pr_{name}.csv", "w", encoding="utf-8") as f:
            f.write("precision,recall,threshold\n")
            for a, b, t in zip(c["pr"]["precision"], c["pr"]["recall"], c["pr"]["threshold"]):
                f.write(f"{a},{b},{t}\n")
    return out / "report.md"


def run(pairs_path: str | Path, out_dir: str | Path, cfg: Config, engine: str = "both", seed: int | None = None) -> dict[str, Any]:
    _seed_all(seed)
    pairs = load_pairs(pairs_path)
    warnings: list[str] = []
    validate_pairs(pairs, cfg, warnings)
    for w in warnings:
        log.warning(w)
    pipe = Pipeline.start(cfg, engine)
    rows = score_pairs(pairs, cfg, pipe, engine)
    rep = build_report(rows, cfg, warnings, seed)
    write_report(rep, rows, out_dir)
    return rep
