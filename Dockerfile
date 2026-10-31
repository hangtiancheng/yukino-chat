# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

FROM deps AS web-builder
COPY client/ client/
ARG VITE_API_URL=http://localhost:8000
ARG VITE_WS_URL=
ENV VITE_API_URL=${VITE_API_URL} VITE_WS_URL=${VITE_WS_URL}
RUN pnpm -C client build

FROM deps AS server-builder
COPY server/ server/
RUN pnpm -C server build

FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --prod --filter server...

FROM node:24-alpine AS app
WORKDIR /app/server
RUN apk add --no-cache tzdata && npm install -g prisma@7
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/server/node_modules ./node_modules
COPY --from=prod-deps /app/server/package.json ./package.json
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/prisma ./prisma
COPY --from=server-builder /app/server/prisma-sqlite ./prisma-sqlite
COPY --from=server-builder /app/server/prisma.config.ts ./prisma.config.ts
COPY --from=web-builder /app/client/dist ./web
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
