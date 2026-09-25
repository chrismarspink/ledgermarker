"""Engine 추상 인터페이스. 두 엔진은 이 인터페이스만 공유하고 서로를 참조하지 않는다 (R2)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class Engine(ABC):
    name: str

    @abstractmethod
    def fingerprint(self, norm_text: str) -> Any:
        """정규화 텍스트(core.normalize 출력) → 엔진별 지문."""

    @abstractmethod
    def compare(self, fp_a: Any, fp_b: Any, warnings: list[str]) -> Any:
        """엔진별 지문 두 개 → 엔진별 결과. 경고는 warnings 리스트에 추가한다."""
