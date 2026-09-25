"""모델 적재 + SBERT 검증 게이트 (R4) + max_seq_length 실측 (R5).

이 모듈은 다른 엔진을 참조하지 않는다 (R2).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from docsim.core.errors import ModelNotSBERTError

log = logging.getLogger("docsim.embed")

# (문장1, 문장2, 유사한가)
PROBE_PAIRS: list[tuple[str, str, bool]] = [
    ("직원 명단입니다", "임직원 리스트입니다", True),
    ("직원 명단입니다", "예산 집행 내역입니다", False),
    ("계약 금액은 3억원입니다", "낙찰가는 3억원으로 결정되었습니다", True),
    ("계약 금액은 3억원입니다", "오늘 회의는 3시에 시작합니다", False),
]


@dataclass
class SbertProbe:
    pos_mean: float
    neg_mean: float
    margin: float
    sims: list[float]


@dataclass
class LoadedModel:
    model: Any                  # sentence_transformers.SentenceTransformer
    model_id: str
    dim: int
    max_seq_length: int         # ★ 실측값 (R5)
    probe: SbertProbe
    device: str = "cpu"

    @property
    def tokenizer(self):
        return self.model.tokenizer

    def encode(self, texts: list[str], batch_size: int = 32) -> np.ndarray:
        """L2 정규화된 float32 임베딩 (n, dim). 입력은 이미 청킹된 텍스트여야 한다."""
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        vecs = self.model.encode(
            texts, batch_size=batch_size, convert_to_numpy=True,
            normalize_embeddings=True, show_progress_bar=False,
        )
        return np.asarray(vecs, dtype=np.float32)

    def count_tokens(self, text: str) -> int:
        """특수 토큰([CLS]/[SEP]) 포함 토큰 수 — 모델에 실제로 들어가는 길이."""
        return len(self.tokenizer(text, add_special_tokens=True, truncation=False)["input_ids"])

    def count_tokens_batch(self, texts: list[str]) -> list[int]:
        """여러 문장을 한 번의 토크나이저 호출로 센다 (청킹 속도용). 결과는 count_tokens 와 동일하다."""
        if not texts:
            return []
        enc = self.tokenizer(texts, add_special_tokens=True, truncation=False)["input_ids"]
        return [len(ids) for ids in enc]


def probe_sbert(model: Any) -> SbertProbe:
    sents: list[str] = []
    for a, b, _ in PROBE_PAIRS:
        sents.extend([a, b])
    vecs = model.encode(sents, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)
    sims = [float(np.dot(vecs[2 * i], vecs[2 * i + 1])) for i in range(len(PROBE_PAIRS))]
    pos = [s for s, (_, _, lab) in zip(sims, PROBE_PAIRS) if lab]
    neg = [s for s, (_, _, lab) in zip(sims, PROBE_PAIRS) if not lab]
    pos_mean = float(np.mean(pos))
    neg_mean = float(np.mean(neg))
    return SbertProbe(pos_mean=pos_mean, neg_mean=neg_mean, margin=pos_mean - neg_mean, sims=sims)


def verify_sbert(model: Any, min_margin: float) -> SbertProbe:
    """생 BERT 인코더를 걸러낸다 (R4).

    생 BERT: 유사쌍/무관쌍 코사인이 모두 0.7~0.9로 뭉쳐 분리가 안 된다.
    SBERT:   유사쌍 높고 무관쌍 낮아 뚜렷이 분리된다.
    """
    probe = probe_sbert(model)
    if probe.margin < min_margin:
        raise ModelNotSBERTError(
            f"pos={probe.pos_mean:.3f} neg={probe.neg_mean:.3f} margin={probe.margin:.3f} < {min_margin}. "
            f"문장 임베딩용으로 훈련된 모델이 아닙니다. ko-sroberta-multitask 등을 사용하십시오."
        )
    return probe


def resolve_device(device: str) -> str:
    import torch
    d = (device or "auto").lower()
    if d == "auto":
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"
    if d == "mps" and not torch.backends.mps.is_available():
        raise ModelNotSBERTError("embed.device=mps 이지만 MPS 를 사용할 수 없습니다")
    if d == "cuda" and not torch.cuda.is_available():
        raise ModelNotSBERTError("embed.device=cuda 이지만 CUDA 를 사용할 수 없습니다")
    return d


def load_model(model_id: str, min_margin: float, verify: bool = True, torch_threads: int = 0, device: str = "cpu") -> LoadedModel:
    """모델 적재 → SBERT 검증 → max_seq_length 실측. 검증 실패 시 예외로 기동 거부."""
    from sentence_transformers import SentenceTransformer  # 지연 import (doctor 가 없는 환경 진단 가능)

    if torch_threads and torch_threads > 0:
        import torch
        torch.set_num_threads(int(torch_threads))
    dev = resolve_device(device)
    model = SentenceTransformer(model_id, device=dev)
    log.info("device=%s", dev)
    max_seq = model.max_seq_length
    if max_seq is None:
        raise ModelNotSBERTError(f"모델 {model_id} 에서 max_seq_length 를 읽을 수 없습니다 (R5).")
    dim = model.get_embedding_dimension() if hasattr(model, "get_embedding_dimension") else model.get_sentence_embedding_dimension()
    if dim is None:
        raise ModelNotSBERTError(f"모델 {model_id} 에서 임베딩 차원을 읽을 수 없습니다.")
    log.info("model=%s dim=%d max_seq_length=%d (실측)", model_id, dim, max_seq)
    if verify:
        probe = verify_sbert(model, min_margin)
    else:
        probe = probe_sbert(model)
    return LoadedModel(model=model, model_id=model_id, dim=int(dim), max_seq_length=int(max_seq), probe=probe, device=dev)
