# LM 라벨 프로파일 명세 (Label Profile v1)

> **이 파일은 타 제품과 공유하는 유일한 규격 문서다.**
> 변경은 하위 호환을 깨지 않아야 하며, 변경 시 `profileVersion`을 올린다.
>
> profileVersion **1** · 2026-09

## 1. 컨테이너 구조

라벨(문서 여권)은 **CMS SignedData (RFC 5652)** 를 외부 래퍼로 사용한다.

```
CMS SignedData
 ├─ encapContentInfo : detached (원문 = contentHash 32바이트)
 ├─ signedAttributes : LM 라벨 필드 (평문 · 서명 대상) ← 아래 §3
 ├─ certificates     : 라벨 서명자 인증서 (기관 CA 발급)
 ├─ signature        : ECDSA P-256 / SHA-256
 └─ [S등급 본문 암호화 시] 내부 EnvelopedData — ARIA-256-GCM
```

- 서명 대상 원문(detached content)은 **문서의 SHA-256 해시 32바이트**다.
  검증자는 문서를 직접 해시한 값을 content로 넣어 검증한다.
- **등급 필드는 평문이다.** 게이트는 복호화·서명검증 없이도 signedAttributes에서
  등급을 읽을 수 있어야 한다. 본문만 선택적으로 암호화한다.
- 등급이 `O`이면 EnvelopedData를 붙이지 않는다 (게이트 내용검사 가능해야 함).
- 등급 `C`는 이 체계의 범위 밖 — 라벨을 발급하지 않는다.
- 본문 암호화는 클라이언트 측 작업이다. LM Server는 문서 본문을 저장하지도,
  수신하지도 않는다.

## 2. 부착 방식 (Phase 1: 사이드카)

| 방식 | 규격 |
|---|---|
| 사이드카 파일 | `<원본파일명>.lmsig` — CMS DER 바이너리 |
| QR 사이드카 | `lm://verify?h=<contentHash hex>&d=<docGuid>` — 인쇄물 원장 조회용 |
| 포맷 내장 (PDF/OOXML/HWP) | Phase 2 |

## 3. signedAttributes 커스텀 속성

OID arc: `1.3.6.1.4.1.55555.53.1` — **✎ 임시 배정. 정식 OID arc 확정 시
profileVersion 2로 올리고 이 문서를 갱신한다** (DEV SPEC §13-1).

각 속성의 attrValues는 **단일 값**이다.

| # | 필드 | OID(.1.3.6.1.4.1.55555.53.1 하위) | ASN.1 타입 | 필수 | 설명 |
|---|---|---|---|---|---|
| 1 | profileVersion | .1 | INTEGER | ✔ | 현재 1 |
| 2 | grade | .2 | UTF8String | ✔ | `S` / `O` |
| 3 | basisClause | .3 | INTEGER | | 정보공개법 9조 호수 1~8 |
| 4 | basisKeywords | .4 | SEQUENCE OF UTF8String | | 판정 근거 키워드 |
| 5 | brmPath | .5 | UTF8String | | 업무 분류 경로 |
| 6 | issuerOrgId | .6 | UTF8String | ✔ | 발급 기관 식별자 |
| 7 | docGuid | .7 | OCTET STRING (16) | ✔ | UUID 빅엔디안 16바이트 |
| 8 | contentHash | .8 | OCTET STRING (32) | ✔ | SHA-256 |
| 9 | approverRank | .9 | UTF8String | | 결재권자 직급 |
| 10 | approvalState | .10 | ENUMERATED | ✔ | PROVISIONAL(0) / CONFIRMED(1) |
| 11 | disclosureCondition | .11 | GeneralizedTime | | 시한부 공개 전환일 |
| 12 | parentHash | .12 | OCTET STRING (32) | | 직전 버전 해시 (선언적 계보) |
| 13 | rootDocId | .13 | OCTET STRING (16) | | 최초 조상 UUID |
| 14 | transform | .14 | UTF8String | | edit / convert / merge / extract |
| 15 | issuedAt | .15 | GeneralizedTime | ✔ | UTC |
| 16 | notAfter | .16 | GeneralizedTime | ✔ | 라벨 유효기간 (인증서 유효기간과 별개) |
| 17 | exportApprover | .17 | UTF8String | | 반출 승인자 |

인코딩 규칙:

- 문자열은 항상 **UTF8String** 태그로 인코딩한다 (PrintableString 금지).
- 시각은 GeneralizedTime, UTC, 초 단위 절단.
- 알 수 없는 OID의 속성은 **무시하고 통과**시킨다 (전방 호환).
  단, 서명 검증은 전체 signedAttributes에 대해 수행되므로 변조는 탐지된다.

## 4. 검증 의미론 (요약)

- `approvalState=PROVISIONAL` 라벨은 기관 내부 통행까지만 유효하다.
  외부 반출 게이트는 verdictHint와 무관하게 거부하는 정책을 권고한다.
- **라벨 폐기(원장 REVOKE 이벤트)와 인증서 폐기(CRL)는 별개다.**
- 키 유출 규칙: 서명 인증서가 폐기되어도, **원장 등록 시점이 인증서
  유효기간 내이면 해당 라벨은 유효**로 판정한다. 원장에 없는 서명은
  위조로 판정한다.
- 원장 `unavailable`(접속 불가)은 판단 보류이며, `unregistered`(미등록)와
  절대 혼동하지 않는다.

## 5. 변경 이력

| profileVersion | 일자 | 내용 |
|---|---|---|
| 1 | 2026-09 | 최초 규격 (Phase 1, 임시 OID arc) |
