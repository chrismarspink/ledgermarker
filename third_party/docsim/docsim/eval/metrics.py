"""평가 지표 — ROC/PR, 목표 FPR 임계값, 엔진별 고유 검출. numpy 만 사용한다."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

POSITIVE_LABELS = ("revision", "excerpt", "rewrite")
NEGATIVE_LABELS = ("same_form_unrelated", "unrelated")
ALL_LABELS = POSITIVE_LABELS + NEGATIVE_LABELS


def is_positive(label: str) -> bool:
    return label in POSITIVE_LABELS


def percentiles(x: np.ndarray, ps=(50, 95)) -> dict[str, float]:
    if x.size == 0:
        return {f"p{p}": float("nan") for p in ps}
    return {f"p{p}": float(np.percentile(x, p)) for p in ps}


def roc_curve(scores: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """점수 내림차순 임계값별 (fpr, tpr, thr). y 는 bool. 음성/양성이 하나도 없으면 nan."""
    order = np.argsort(-scores, kind="stable")
    s, yy = scores[order], y[order].astype(np.int64)
    P, N = yy.sum(), (1 - yy).sum()
    tp = np.cumsum(yy)
    fp = np.cumsum(1 - yy)
    # 동일 점수는 한 임계값으로 묶는다
    distinct = np.r_[np.nonzero(np.diff(s))[0], s.size - 1]
    tpr = tp[distinct] / P if P else np.full(distinct.size, np.nan)
    fpr = fp[distinct] / N if N else np.full(distinct.size, np.nan)
    return np.r_[0.0, fpr], np.r_[0.0, tpr], np.r_[np.inf, s[distinct]]


def pr_curve(scores: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    order = np.argsort(-scores, kind="stable")
    s, yy = scores[order], y[order].astype(np.int64)
    P = yy.sum()
    tp = np.cumsum(yy)
    k = np.arange(1, s.size + 1)
    distinct = np.r_[np.nonzero(np.diff(s))[0], s.size - 1]
    precision = tp[distinct] / k[distinct]
    recall = tp[distinct] / P if P else np.full(distinct.size, np.nan)
    return precision, recall, s[distinct]


def auc(x: np.ndarray, y: np.ndarray) -> float:
    if x.size < 2 or np.isnan(x).any() or np.isnan(y).any():
        return float("nan")
    return float(np.trapezoid(y, x)) if hasattr(np, "trapezoid") else float(np.trapz(y, x))


@dataclass
class ThresholdRow:
    target_fpr: float
    threshold: float
    actual_fpr: float
    recall: float


def threshold_at_fpr(scores: np.ndarray, y: np.ndarray, target_fpr: float) -> ThresholdRow:
    """FPR ≤ target 을 만족하는 가장 낮은 임계값(= 최대 재현율). score ≥ threshold 를 '검출'로 본다."""
    neg = np.sort(scores[~y])
    pos = scores[y]
    if neg.size == 0:
        thr = float(pos.min()) if pos.size else float("nan")
        return ThresholdRow(target_fpr, thr, 0.0, 1.0 if pos.size else float("nan"))
    # 허용 오탐 수
    allowed = int(np.floor(target_fpr * neg.size))
    # 상위 allowed 개 음성만 넘도록: 임계값 = (allowed+1)번째로 큰 음성 점수보다 조금 위 → 그 점수 다음 값
    sorted_desc = neg[::-1]
    if allowed >= neg.size:
        thr = float(np.nextafter(neg.min(), -np.inf))
    else:
        thr = float(np.nextafter(sorted_desc[allowed], np.inf))   # 이 음성은 검출되지 않게
    actual_fpr = float((neg >= thr).mean())
    recall = float((pos >= thr).mean()) if pos.size else float("nan")
    return ThresholdRow(target_fpr, thr, actual_fpr, recall)


@dataclass
class UniqueDetection:
    a_only: int
    b_only: int
    both: int
    neither: int
    total_positive: int
    b_only_by_label: dict[str, int]
    a_only_by_label: dict[str, int]

    def as_dict(self) -> dict:
        t = max(self.total_positive, 1)
        return {
            "A만 검출 (B 놓침)": {"count": self.a_only, "ratio": self.a_only / t},
            "B만 검출 (A 놓침)": {"count": self.b_only, "ratio": self.b_only / t},
            "둘 다 검출": {"count": self.both, "ratio": self.both / t},
            "둘 다 놓침": {"count": self.neither, "ratio": self.neither / t},
            "B만 검출 라벨 분포": self.b_only_by_label,
            "A만 검출 라벨 분포": self.a_only_by_label,
        }


def unique_detection(det_a: np.ndarray, det_b: np.ndarray, y: np.ndarray, labels: list[str]) -> UniqueDetection:
    """양성 페어에 대해 엔진별 검출 여부를 교차 집계한다."""
    pos = np.nonzero(y)[0]
    a, b = det_a[pos], det_b[pos]
    lab = [labels[i] for i in pos]
    def by_label(mask):
        out: dict[str, int] = {}
        for i in np.nonzero(mask)[0]:
            out[lab[i]] = out.get(lab[i], 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))
    return UniqueDetection(
        a_only=int((a & ~b).sum()), b_only=int((b & ~a).sum()), both=int((a & b).sum()), neither=int((~a & ~b).sum()),
        total_positive=int(pos.size), b_only_by_label=by_label(b & ~a), a_only_by_label=by_label(a & ~b),
    )


def recall_by_label(det: np.ndarray, labels: list[str]) -> dict[str, float]:
    out = {}
    arr = np.array(labels)
    for lab in POSITIVE_LABELS:
        m = arr == lab
        out[lab] = float(det[m].mean()) if m.any() else float("nan")
    return out
