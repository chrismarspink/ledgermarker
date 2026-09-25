# LedgerMarker 운영 매뉴얼

## 발급
`lm issue <파일> --grade S` 로 라벨을 발급한다. 사이드카(.lmsig)가 기본이며 `--embed` 로 내장한다.

## 검증
`lm verify <파일> --level 2` 로 서명·원장·폐기·유효기간·협정 다섯 항목을 확인한다.

## 원장
`lm ledger verify` 로 해시체인 무결성을 점검하고 `lm ledger checkpoint --sign` 으로 봉인한다.
