-- PostgreSQL은 enum 값 제거를 지원하지 않는다. DESTROY 값은 남지만
-- 사용하지 않으면 무해하다 (down은 형식상 쌍으로 존재 — DEV SPEC §12).
SELECT 1;
