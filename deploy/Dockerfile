# LM Server — 멀티스테이지 빌드
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/lmserver ./cmd/lmserver \
 && CGO_ENABLED=0 go build -trimpath -o /out/lm ./cmd/lm

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/lmserver /usr/bin/lmserver
COPY --from=build /out/lm /usr/bin/lm
# 키스토어는 볼륨으로 주입한다. 컨테이너 내 생성 시 재시작마다 CA가 바뀐다.
VOLUME /keystore
ENV LM_KEYSTORE=/keystore LM_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/usr/bin/lmserver"]
