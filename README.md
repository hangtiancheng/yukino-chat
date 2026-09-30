<div align="center">

# Yukino Chat

**A self-hosted, real-time chat platform — direct & group messaging, audio/video
calls, resumable file transfer, and a private AI coding agent per user.**

Built on a React 19 + Vite frontend and a Node.js/TypeScript backend (Hono +
Prisma), with the Yukino agent embedded in-process via
[`@yukino.js/yukino`](https://github.com/hangtiancheng/yukino-code).

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-FF4438?logo=redis&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

</div>

---

## Overview

Yukino Chat is a full-stack instant-messaging server and web client, organised
as a pnpm workspace (`client/` + `server/`). It covers the core IM feature set
— accounts, contacts, groups, sessions, rich messages and WebRTC calls — and
goes one step further by hosting **Yukino**, an AI coding agent, as a
first-class chat participant. Every signed-in user gets their own isolated
agent workspace, streamed live into the conversation.

```
┌──────────────┐     HTTP + WS      ┌─────────────────────────┐     ┌────────────┐
│   Web (SPA)  │ ─────────────────> │   Chat Server (Node)    │ ──> │ PostgreSQL │
│  React 19    │                    │   Hono + Prisma + ws    │ ──> │ Redis      │
└──────┬───────┘                    └────────────┬────────────┘     └────────────┘
       │ /agent/ws                               │ embeds (in-process)
       V                               ┌─────────V─────────────┐
┌──────────────┐                       │     AgentManager      │
│  Agent UI    │ <───────────────────> │ 1 @yukino.js runtime  │
│  streaming   │      JSON-RPC 2.0     │      per user         │
└──────────────┘                       └───────────────────────┘
```

## Features

### Messaging

- **Direct & group conversations** with auto-created/restored sessions, unread
  counts, last-message previews and activity ordering.
- **Rich message types** — text, image, file, video, AV signaling and system
  notifications.
- **Rich composer** powered by TipTap, with streaming Markdown rendering
  (code, math, Mermaid diagrams) via Streamdown.
- **Contacts** with tags, custom note names, online presence, blacklists and
  keyword search across users and groups.

### Groups

- Create groups with initial members + a welcome message, invite/remove
  members, and a member list carrying join time and last-speak time.
- Configurable join modes (direct entry vs. approval), leave and dismiss flows.

### Calls & Files

- **Audio & video calls** — 1v1 and group mesh — signaled over the `/wss`
  channel; the server tracks call rooms and per-user busy state.
- **Chunked file uploads** with instant upload (dedup by hash) and resume:
  `/file/verify` → `/file/upload-chunk` → `/file/merge` (chunks ≤ 10 MiB).

### AI Agent (Yukino)

- **One private agent per user**, embedded in-process through the
  `@yukino.js/yukino` package and living in an isolated workspace under
  `.yukino/chat/<uid>`; runtimes are created lazily and evicted after 30
  minutes of idle time.
- Live streaming of token deltas, thinking, tool calls and permission prompts
  over a dedicated `/agent/ws` socket using JSON-RPC 2.0; finalized replies
  are written back into the chat transcript as ordinary messages so they
  survive reloads and show up in session previews.
- Conversation context (messages, active skills, permission mode) is persisted
  in PostgreSQL (`agent_sessions`) and rehydrated across server restarts.
- Slash-command menu, permission gating and interactive question prompts in the
  composer.

### Operations

- **Admin console** (`/manager`) for user/group management: enable/disable,
  set admin, batch delete and status control.
- **Live cache dashboard** (`/dashboard`, admin-only) streaming Redis cache
  snapshots over `/dashboard/ws`, with key eviction from the UI.
- **Installable PWA** — add-to-home-screen with an auto-updating service
  worker.

## Tech Stack

| Layer    | Technology                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, TypeScript 6, Tailwind CSS v4, shadcn/ui, Zustand, TanStack Query/Form/Virtual, TipTap 3, Streamdown, react-router v7, Zod      |
| Backend  | Node.js 24, TypeScript, [Hono](https://hono.dev) (HTTP + WebSocket via `@hono/node-server`/`@hono/node-ws` + `ws`), Zod validation, bcryptjs, JWT |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`)                                                                                                    |
| Cache    | Redis via ioredis — read-through cache for user info & session lists, degrades to the DB on Redis errors (in-memory store in tests)               |
| Agent    | [`@yukino.js/yukino`](https://github.com/hangtiancheng/yukino-code) embedded in the chat server (`AgentManager` / per-user `AgentRuntime`)        |
| Tooling  | pnpm workspaces, ESLint (client), Biome (server), Vitest + node smoke scripts (server), Prettier                                                  |

## Getting Started

### Prerequisites

- **Node.js ≥ 24** (see `.nvmrc`) and **pnpm**
- **PostgreSQL** — a reachable instance (`DATABASE_URL`)
- **Redis** — a reachable instance (`REDIS_URL`)

### Local development

```bash
pnpm install                              # installs both workspace packages

# 1. Backend
cd server
# create server/.env (see Configuration below), then apply migrations and run:
pnpm db:migrate                           # prisma migrate dev
pnpm dev                                  # tsx watch → listens on :8000

# 2. Frontend — from the repo root
cp client/.env.example client/.env        # VITE_API_URL=http://localhost:8000
pnpm --filter client dev                  # Vite dev server
```

## Configuration

### Backend — `server/.env`

| Variable                                                     | Default                                             | Description                                             |
| ------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------- |
| `PORT` / `HOST`                                              | `8000` / `0.0.0.0`                                  | Listen address                                          |
| `DATABASE_URL`                                               | `postgresql://root:pass@localhost:5432/yukino_chat` | PostgreSQL connection string                            |
| `REDIS_URL`                                                  | `redis://localhost:6379`                            | Cache backend; empty string → in-memory (tests)         |
| `JWT_SECRET`                                                 | `yukino-chat-jwt-secret`                            | JWT signing secret — change in production               |
| `TOKEN_EXPIRE_HOURS`                                         | `336`                                               | Login token lifetime (14 days)                          |
| `CACHE_TTL_SECONDS`                                          | `300`                                               | Read-through cache entry TTL                            |
| `STATIC_AVATAR_DIR` / `STATIC_FILE_DIR` / `STATIC_CHUNK_DIR` | `./static/…`                                        | Upload directories (created on boot)                    |
| `AGENT_WS_MAX_MESSAGE_BYTES`                                 | `4194304`                                           | Max inbound frame size on `/agent/ws`                   |
| `AGENT_IDLE_MS`                                              | `1800000`                                           | Idle eviction for per-user agent runtimes (30 min)      |
| `AGENT_QUEUE_CAP`                                            | `8`                                                 | Prompt queue capacity per agent                         |
| `AGENT_INTERACTION_TIMEOUT_MS`                               | `300000`                                            | Timeout for pending permission/question prompts         |
| `YUKINO_AI_PROTOCOL` / `_BASE_URL` / `_API_KEY` / `_MODEL`   | _(empty)_                                           | Env fallback provider when no yukino config file exists |

The embedded agent's **primary** configuration is yukino's own config file
(`~/.yukino/config.yaml`, then `./.yukino/config.yaml`) with `providers`,
`mcp_servers`, `hooks` and `permission_mode`. When no config file exists, a
single provider is synthesized from the `YUKINO_AI_*` variables above. With
neither, the server still starts — chat works and the assistant thread simply
reports itself unavailable.

### Frontend — `client/.env`

| Variable       | Description                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | Origin of the backend (default `http://localhost:8000`)                                                                                      |
| `VITE_WS_URL`  | Optional. Defaults to `VITE_API_URL` with the scheme swapped to `ws`. Set only when the WebSocket endpoint is proxied to a different origin. |

## API Surface

All endpoints are `POST` unless noted. Every route except `/login`,
`/register` and `/user/update-password` requires a JWT in the `Authorization`
header; admin routes additionally require `is_admin`. `/login`, `/register`
and `/user/update-password` are rate-limited per client IP (10/10/5 requests
per minute respectively).

| Group       | Examples                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `/user`     | `search-user`, `update-user-info`, `get-user-info`, `set-admin` (admin), `delete-users` (admin)          |
| `/group`    | `create-group`, `invite-group-members`, `leave-group`, `dismiss-group`, `delete-groups` (admin)          |
| `/session`  | `open-session`, `get-user-session-list`, `get-group-session-list`, `mark-session-read`, `delete-session` |
| `/contact`  | `apply-contact`, `pass-contact-apply`, `add-tag`, `black-contact`, `delete-contact`                      |
| `/message`  | `get-message-list`, `get-group-message-list`, `upload-file`, `upload-avatar`                             |
| `/file`     | `verify`, `upload-chunk`, `merge`                                                                        |
| `/chatroom` | `get-online-users`, `get-callers`                                                                        |

Static assets under `/static/avatars` and `/static/files` are served publicly;
upload **chunks are never served** — only merged files.

WebSocket channels (all `GET`, JWT passed in the `token` query parameter):

| Channel         | Purpose                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `/wss`          | Main realtime channel — messages, presence, call signaling; `client_id` must match the token |
| `/agent/ws`     | Yukino agent streaming over JSON-RPC 2.0 (tokens, tools, permission/question prompts)        |
| `/dashboard/ws` | Admin-only: live cache snapshots + key eviction                                              |

## Project Structure

```
yukino-chat/
├── client/                    # React frontend (workspace package "client")
│   ├── src/
│   │   ├── pages/             # Routes: chat, session-list, contact-list, manager, dashboard, auth
│   │   ├── components/        # UI: composer, message bubbles, agent cards, dialogs, shadcn/ui
│   │   ├── store/             # Zustand stores: auth, ws, call, agent, dashboard, preferences
│   │   ├── service/           # HTTP client, schemas, queries, chunked upload
│   │   └── workers/           # file-hash web worker (instant-upload dedup)
│   └── vite.config.ts         # Tailwind v4, PWA, @yukino.js/sentry, sourcemap moves
├── server/                    # Node.js backend (workspace package "server")
│   ├── src/
│   │   ├── routes/            # HTTP route tables + ws-chat / ws-agent / ws-dashboard routes
│   │   ├── services/          # Domain logic: user, session, contact, group, message
│   │   ├── hub/               # ChatHub, MessagePipeline, CallManager, frame types
│   │   ├── agent/             # AgentManager, AgentRuntime, event adapter, RPC protocol, stores
│   │   ├── middleware/        # JWT auth, admin gate, CORS, per-IP rate limiting
│   │   ├── cache/             # Redis read-through cache (+ in-memory fallback)
│   │   ├── database/          # Prisma client
│   │   └── config/            # Zod-validated environment
│   ├── prisma/                # schema.prisma + migrations (PostgreSQL)
│   └── tests/                 # Vitest units + http/ws smoke scripts
└── scripts/                   # repo utilities (bulk rename)
```

> `client/Dockerfile`, `client/docker-compose.yml` and `client/docker/` are
> leftovers from the previous Go + MongoDB layout and have not been updated
> for the TypeScript backend yet.

## Deployment Constraints

> **Read before exposing this to a public network.**

- **Single instance only.** The message hub is an in-process channel; the
  WebSocket connection table, call rooms, rate-limit buckets and the agent
  runtime registry all live in process memory. Messages routed to a user
  connected to another instance would never be delivered. Plan capacity for
  one instance.
- **No TLS.** The server speaks plain HTTP/WS. Terminate TLS at a gateway
  (nginx, caddy, …) in front of it for anything beyond an internal network.
- **`/user/update-password` is unauthenticated by design** (legacy
  forgot-password parity — no email/SMS verification exists). Anyone knowing a
  telephone number can reset that account's password (rate-limited to 5
  attempts per minute per IP). Front it with a verification step before
  exposing it publicly.
- **Redis is optional but recommended.** On Redis errors every cache read
  degrades to a DB miss instead of failing; with `REDIS_URL=""` the cache runs
  fully in memory (intended for tests).
- **Run migrations before booting a new version**: `pnpm db:deploy`
  (`prisma migrate deploy`).
- **The agent needs a provider** (`~/.yukino/config.yaml` or `YUKINO_AI_*`
  env) — without one the server runs fine but the assistant is unavailable.

## Scripts

Root (workspace):

```bash
pnpm --filter client <script>   # run a client script
pnpm --filter server <script>   # run a server script
```

Frontend (`client/`):

```bash
pnpm dev          # Vite dev server
pnpm build        # tsc -b && vite build
pnpm lint         # eslint .
pnpm format       # prettier
pnpm preview      # preview the production build
```

Backend (`server/`):

```bash
pnpm dev          # tsx watch src/index.ts (hot reload)
pnpm build        # prisma generate && tsc
pnpm start        # node dist/index.js
pnpm test         # vitest run
pnpm typecheck    # tsc -b --noEmit
pnpm lint         # biome check .
pnpm db:migrate   # prisma migrate dev (local development)
pnpm db:deploy    # prisma migrate deploy (production)
```

Server smoke tests run against a live server:

```bash
node server/tests/http-smoke.mjs   # register → login → session → message flow
node server/tests/ws-smoke.mjs     # /wss realtime flow
```

## License

Released under the MIT License (see the copyright headers in each source file).
