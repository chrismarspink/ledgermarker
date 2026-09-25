"""docsim 예외 계층. 원문 조각을 메시지에 넣지 않는다 (R10)."""


class DocsimError(Exception):
    """모든 docsim 예외의 기반."""


class ConfigError(DocsimError):
    """config.yaml 누락/불일치 (R8) 또는 모델 제약 위반 (R5)."""


class ExtractError(DocsimError):
    """파일에서 텍스트를 추출할 수 없음. 빈 문자열로 조용히 넘어가지 않는다."""


class SchemaError(DocsimError):
    """지문 파일이 스키마를 만족하지 않음 (필수 필드 누락 등, R3)."""


class VersionMismatchError(DocsimError):
    """지문 간 버전(schema/norm/model/mu/df/key) 불일치. 추정 계산하지 않는다 (R9)."""


class ModelNotSBERTError(DocsimError):
    """문장 임베딩용으로 훈련되지 않은 모델 (R4). 기동 거부."""


class MuMissingError(DocsimError):
    """중심화 벡터 mu 가 없음 (R6). 기동 거부."""


class ChunkTooLongError(DocsimError):
    """청크 토큰 수가 모델 max_seq_length 초과 (R5). 조용한 절단 금지."""


class KeyMissingError(DocsimError):
    """HMAC 키를 찾을 수 없음."""
