# syntax=docker/dockerfile:1
#
# Frontend edge image: builds the Vite SPA and serves it from Nginx, which
# also reverse-proxies every /api/* path to the backend (see nginx.conf.template).
# The backend never serves the frontend — separation of concerns.

FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY client/package.json client/
COPY server/package.json server/
# Only the client workspace is needed to build the SPA; --filter keeps server
# native deps (prisma engines, better-sqlite3) out of the frontend build.
RUN pnpm install --frozen-lockfile --filter client

FROM deps AS web-builder
COPY client/ client/
# Same-origin API prefix: the browser only talks to Nginx; /api/* is proxied
# to the backend. Override with an absolute origin if the API is elsewhere.
ARG VITE_API_URL=/api
ARG VITE_WS_URL=
ENV VITE_API_URL=${VITE_API_URL} VITE_WS_URL=${VITE_WS_URL}
RUN pnpm -C client build

FROM nginx:stable-alpine AS edge
# Backend upstream for the /api reverse proxy (compose service name by default).
ENV YUKINO_API_UPSTREAM=app:8000
# Rendered to /etc/nginx/conf.d/default.conf by the image's envsubst hook.
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-builder /app/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
