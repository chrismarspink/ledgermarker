"""엔진 A 비교 — MinHash 자카드 추정 + 포함도(containment)."""

from __future__ import annotations

import math

from docsim.core.config import Config
from docsim.core.errors import VersionMismatchError
from docsim.core.schema import ShingleFingerprint, ShingleResult

NOISE_FLOOR_WARNING = "jaccard below noise floor"
DF_NOT_APPLIED_WARNING = "DF 테이블 미적용 — 공문 서식으로 인한 과대 유사도 가능"


def jaccard(mh_a: list[int], mh_b: list[int]) -> float:
    """일치하는 위치 수 / perms"""
    if len(mh_a) != len(mh_b) or not mh_a:
        raise VersionMismatchError(f"minhash 길이 불일치: {len(mh_a)} vs {len(mh_b)}")
    matches = sum(1 for x, y in zip(mh_a, mh_b) if x == y)
    return matches / len(mh_a)


def containment(j: float, count_a: int, count_b: int) -> tuple[float, float, int]:
    """★ R3 의 존재 이유. I = j*(|A|+|B|)/(1+j) → (I/|A|, I/|B|, I)

    I 는 min(|A|,|B|) 로, 포함도는 [0,1] 로 클램프한다.
    """
    if count_a <= 0 or count_b <= 0:
        return 0.0, 0.0, 0
    inter = j * (count_a + count_b) / (1.0 + j)
    inter = min(inter, float(min(count_a, count_b)))
    inter = max(inter, 0.0)
    ca = min(max(inter / count_a, 0.0), 1.0)
    cb = min(max(inter / count_b, 0.0), 1.0)
    return ca, cb, int(round(inter))


def compare(a: ShingleFingerprint, b: ShingleFingerprint, cfg: Config, warnings: list[str]) -> ShingleResult:
    """두 ShingleFingerprint 비교. 버전 불일치는 호출 전 schema.check_compatible 로 걸러진다."""
    if a.k != b.k or a.seed != b.seed or a.key_id != b.key_id or a.df_version != b.df_version:
        raise VersionMismatchError("shingle 지문 파라미터 불일치 (k/seed/key_id/df_version)")
    perms = len(a.minhash)
    j = jaccard(a.minhash, b.minhash)
    stderr = 1.0 / math.sqrt(perms)
    ca, cb, inter = containment(j, a.shingle_count, b.shingle_count)
    mult = float(cfg.get("compare.noise_floor_multiplier"))
    if j < mult * stderr:
        warnings.append(f"{NOISE_FLOOR_WARNING} (jaccard={j:.3f} < {mult:g}×stderr={mult * stderr:.3f}) — 포함도 신뢰 불가")
    if a.df_version is None:
        warnings.append(DF_NOT_APPLIED_WARNING)
    return ShingleResult(
        jaccard=j,
        jaccard_stderr=stderr,
        containment_a_in_b=ca,
        containment_b_in_a=cb,
        estimated_intersection=inter,
    )
