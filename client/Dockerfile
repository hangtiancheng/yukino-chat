# syntax=docker/dockerfile:1


FROM node:24-alpine AS web-builder
WORKDIR /app

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_URL=http://localhost:8000
ARG VITE_WS_URL=
ENV VITE_API_URL=${VITE_API_URL} VITE_WS_URL=${VITE_WS_URL}
RUN pnpm build

FROM golang:1.26-alpine AS server-builder
WORKDIR /src

ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/yukino-chat-server ./cmd

FROM alpine:3.21 AS server
RUN apk add --no-cache bash git curl ca-certificates tzdata
WORKDIR /app

COPY --from=server-builder /out/yukino-chat-server /usr/local/bin/yukino-chat-server

EXPOSE 8000
CMD ["yukino-chat-server"]

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/dist /usr/share/nginx/html
EXPOSE 80
