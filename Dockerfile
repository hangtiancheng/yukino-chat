# syntax=docker/dockerfile:1
#
# Backend image: builds the Hono server and its two Prisma clients. The
# frontend is NOT baked in — it is served by the Nginx edge image
# (docker/nginx.Dockerfile), which reverse-proxies /api/* to this service.

FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY client/package.json client/
COPY server/package.json server/
# The frontend is built in the separate edge image, so only the server
# workspace is installed here.
RUN pnpm install --frozen-lockfile --filter server

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
# prisma is a runtime dependency (the entrypoint runs `prisma migrate
# deploy`, and prisma.config.ts imports `prisma/config`), so it ships inside
# the copied node_modules — no separate global install is needed.
RUN apk add --no-cache tzdata
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/server/node_modules ./node_modules
COPY --from=prod-deps /app/server/package.json ./package.json
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/prisma ./prisma
COPY --from=server-builder /app/server/prisma-sqlite ./prisma-sqlite
COPY --from=server-builder /app/server/prisma.config.ts ./prisma.config.ts
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
