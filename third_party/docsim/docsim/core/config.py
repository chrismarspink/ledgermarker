"""config.yaml 적재. 모든 파라미터는 여기서만 읽는다 (R8).

코드 안에 기본값을 두지 않기 위해 `get()` 은 키가 없으면 ConfigError 를 낸다.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from docsim.core.errors import ConfigError

ENV_CONFIG = "DOCSIM_CONFIG"
DEFAULT_CONFIG_NAME = "config.yaml"


def find_config_path(explicit: str | None = None) -> Path:
    """우선순위: --config 인자 > DOCSIM_CONFIG 환경변수 > ./config.yaml > 패키지 상위 config.yaml"""
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    if os.environ.get(ENV_CONFIG):
        candidates.append(Path(os.environ[ENV_CONFIG]))
    candidates.append(Path.cwd() / DEFAULT_CONFIG_NAME)
    candidates.append(Path(__file__).resolve().parents[2] / DEFAULT_CONFIG_NAME)
    for c in candidates:
        if c.is_file():
            return c
    raise ConfigError(
        "config.yaml 을 찾을 수 없습니다. --config 로 지정하거나 DOCSIM_CONFIG 를 설정하십시오. "
        f"탐색 경로: {[str(c) for c in candidates]}"
    )


class Config:
    """dict 래퍼. 점 표기 경로로 접근하며 누락 시 ConfigError."""

    def __init__(self, data: dict[str, Any], path: Path | None):
        self._data = data
        self.path = path

    @classmethod
    def load(cls, explicit: str | None = None) -> "Config":
        path = find_config_path(explicit)
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict):
            raise ConfigError(f"config 최상위는 매핑이어야 합니다: {path}")
        return cls(data, path)

    def get(self, dotted: str) -> Any:
        cur: Any = self._data
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                raise ConfigError(f"config 에 '{dotted}' 가 없습니다 ({self.path}). 기본값은 코드에 두지 않습니다 (R8).")
            cur = cur[part]
        return cur

    def resolve_path(self, dotted: str) -> Path | None:
        """config 파일 위치 기준 상대경로 해석. 값이 null 이면 None."""
        v = self.get(dotted)
        if v is None:
            return None
        p = Path(str(v)).expanduser()
        if not p.is_absolute() and self.path is not None:
            p = (self.path.parent / p).resolve()
        return p

    def as_dict(self) -> dict[str, Any]:
        return self._data
