-- 텍스트 해시 2차 식별 (SigNET 부착보존성 실측 H-5 흡수):
-- 편집기 재저장·재압축으로 파일 바이트가 바뀌어도 본문 텍스트가 같으면
-- 동일 문서로 정확 재식별한다. 원시 해시(content_hash)와 별개의 색인 —
-- 라벨 서명 의미는 바꾸지 않는다.
ALTER TABLE ledger_event ADD COLUMN text_hash BYTEA;
CREATE INDEX ON ledger_event (text_hash) WHERE text_hash IS NOT NULL;

-- docsim 정밀 지문 (사내 docsim 모듈 결합용 — 선택 제출).
-- 원문 복원이 불가능한 지문만 저장한다 (본문 미저장 원칙 유지).
ALTER TABLE ledger_event ADD COLUMN docsim_fp TEXT;
