"""CompareResult → JSON dict / 사람용 표. 종합 점수는 만들지 않는다."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from docsim.core.schema import CompareResult, Fingerprint


def result_to_dict(r: CompareResult, verdict=None) -> dict[str, Any]:
    d = asdict(r)
    assert "overall_score" not in d
    d["verdict"] = verdict.as_dict() if verdict is not None else None   # 규칙 기반 해석, 종합 점수 아님
    return d


def doc_line(fp: Fingerprint, label: str) -> str:
    parts = [f"정규화 {fp.norm_len:,}자"]
    if fp.shingle is not None:
        parts.append(f"슁글 {fp.shingle.shingle_count:,}")
    if fp.embed is not None:
        parts.append(f"청크 {len(fp.embed.chunks)}")
    return f"  {label}: {fp.doc_id:<24} ({' / '.join(parts)})"


def render_text(r: CompareResult, fp_a: Fingerprint | None = None, fp_b: Fingerprint | None = None, verdict=None) -> str:
    from docsim.report.verdict import render_verdict

    lines = ["문서 비교 결과"]
    if fp_a is not None and fp_b is not None:
        lines += [doc_line(fp_a, "A"), doc_line(fp_b, "B")]
    else:
        lines += [f"  A: {r.doc_a}", f"  B: {r.doc_b}"]
    lines.append("")
    lines.append(f"  동일 여부   {'예 (hash_norm 일치)' if r.identical else '아니오 (hash_norm 불일치)'}")
    lines.append("")
    if r.shingle is not None:
        s = r.shingle
        lines += [
            "┌─ 엔진 A · 조각 맞추기 ──────────────────────────────────┐",
            f"   자카드          {s.jaccard:.3f}  (± {s.jaccard_stderr:.3f})",
            f"   포함도 A⊆B      {s.containment_a_in_b:.3f}",
            f"   포함도 B⊆A      {s.containment_b_in_a:.3f}",
            f"   추정 교집합     {s.estimated_intersection:,} 조각",
            "└─────────────────────────────────────────────────────────┘",
            "",
        ]
    if r.embed is not None:
        e = r.embed
        top = e.top_pairs[0] if e.top_pairs else None
        arrow = f"     ← A청크{top.a_index} ↔ B청크{top.b_index}" if top else ""
        pairs = " / ".join(f"{p.a_index}↔{p.b_index} {p.cosine:.3f}" for p in e.top_pairs)
        lines += [
            "┌─ 엔진 B · 뜻 비교 ──────────────────────────────────────┐",
            f"   최대 코사인     {e.max_cosine:.3f}{arrow}",
            f"   상위 {len(e.top_pairs)}쌍        {pairs}",
            f"   비교 청크       {e.chunks_compared:,} 쌍  (서식 제외 {e.boilerplate_excluded})",
            "└─────────────────────────────────────────────────────────┘",
            "",
        ]
    if verdict is not None:
        lines += [render_verdict(verdict), ""]
    if r.warnings:
        lines.append("경고")
        lines += [f"  · {w}" for w in r.warnings]
    return "\n".join(lines)
