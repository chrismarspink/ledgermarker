-- 파기(DESTROY) 이벤트 타입 추가 (docs/lifecycle-policy.md §3).
-- 파기 = 보존기간 만료 + 심의 후 키 파기(crypto-shredding).
-- 원장 행은 영구 보존된다 — "무엇이 존재했고 언제 파기됐는지"의 증적.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'DESTROY';
