# Yukino Chat Operations Runbook

**Document status:** Active  
**Environment:** Single-node production preview  
**Last updated:** 2026-11-02  
**Deployed revision:** `8613e4f`  
**Public endpoint:** `http://123.57.193.65:8000`

> This runbook describes the host-based deployment currently running on the
> server. Host-specific values are collected in Section 2.3. When cloning the
> service to another machine, replace paths, IP addresses, and secrets
> consistently and update this document.

## Table of Contents

- [1. Purpose and Scope](#1-purpose-and-scope)
- [2. Architecture](#2-architecture)
- [3. Configuration](#3-configuration)
- [4. Provisioning](#4-provisioning)
- [5. Release Management](#5-release-management)
- [6. Standard Operations](#6-standard-operations)
- [7. Backup and Restore](#7-backup-and-restore)
- [8. Monitoring and Maintenance](#8-monitoring-and-maintenance)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Security](#10-security)
- [11. Known Constraints](#11-known-constraints)
- [12. Disaster Recovery](#12-disaster-recovery)
- [Appendix A: systemd Unit](#appendix-a-systemd-unit)
- [Appendix B: Nginx Configuration](#appendix-b-nginx-configuration)
- [Appendix C: Environment Reference](#appendix-c-environment-reference)
- [Appendix D: Command Cheat Sheet](#appendix-d-command-cheat-sheet)
- [Appendix E: Release Checklist](#appendix-e-release-checklist)

## 1. Purpose and Scope

This document is the operational reference for deploying, releasing,
monitoring, backing up, recovering, and troubleshooting Yukino Chat.

It covers:

- The production topology and trust boundaries.
- Runtime and build-time configuration.
- Standard release and rollback procedures.
- Database migration handling.
- Backup, restore, and disaster recovery.
- Health checks, monitoring, and log locations.
- Common failure modes and their remediation.
- Security hardening requirements and known platform constraints.

It does not replace application development documentation or the product
requirements. Commands are written for the current Ubuntu host unless stated
otherwise.

## 2. Architecture

### 2.1 Logical Architecture

```text
Browser
  |
  | HTTP :8000 / WebSocket :8000
  v
Nginx edge (host package, systemd)
  |-- /                    -> /var/www/yukino-chat (SPA)
  |-- /assets/*            -> immutable hashed assets
  |-- /api/*               -> reverse proxy to 127.0.0.1:8001
  v
Node.js backend (systemd)
  |-- Hono HTTP API
  |-- WebSocket hub
  |-- Agent runtime
  |-- Prisma ORM
  v
SQLite database (default)
  or
PostgreSQL (DATABASE_PROVIDER=pg)
```

The frontend and backend are **separate deployment units**:

- **Nginx** is the only public entry point. It serves the built SPA and
  reverse-proxies every backend path under `/api/`.
- **The Node backend** never serves the frontend in the current architecture.
  It exposes HTTP, WebSocket, upload, and health endpoints on a loopback
  address.
- **Prisma** supports PostgreSQL and SQLite through the `DATABASE_PROVIDER`
  feature flag. The current deployment uses SQLite.

### 2.2 Deployment Models

Two deployment models are supported by the repository:

| Model                       | Description                                               | Status on this host |
| --------------------------- | --------------------------------------------------------- | ------------------- |
| Host-based (current)        | Host Nginx package + Node.js under systemd + local SQLite | Active              |
| Container-based (canonical) | `docker compose` with separate backend and Nginx images   | Not used            |

The container-based model is defined by:

- `Dockerfile` — backend image, runs `prisma migrate deploy` on entry.
- `docker/nginx.Dockerfile` — SPA build and Nginx edge image.
- `docker/nginx.conf.template` — proxy and SPA configuration template.
- `docker-compose.yml` — service topology, volumes, health checks, and the
  single published port.

The host-based model was selected because the current 2 vCPU / 2 GB host has
limited memory and does not have the required container images cached. The
runtime behavior and URL contract are equivalent.

> **Architecture transition (commit `8613e4f`).** The backend no longer serves
> the SPA. `WEB_DIST_DIR` was removed, and the frontend must be served by the
> Nginx edge and built with `VITE_API_URL=/api`. A legacy `server/web` directory
> is unused and can be removed.

### 2.3 Current Host Topology

| Item                     | Value                                           |
| ------------------------ | ----------------------------------------------- |
| Hostname                 | `iZ2zebtdr0fktrx69pdlpgZ`                       |
| Provider / platform      | Alibaba Cloud ECS, KVM                          |
| Operating system         | Ubuntu 22.04.5 LTS                              |
| Kernel                   | Linux 5.15.0-170-generic                        |
| CPU                      | 2 vCPU                                          |
| Memory                   | 2 GB RAM (1.6 GiB reported), 4 GB swap          |
| Disk                     | 40 GB root volume                               |
| Public IPv4              | `123.57.193.65`                                 |
| Repository               | `/root/yukino-chat`                             |
| Branch / revision        | `main` / `8613e4f`                              |
| Node.js                  | v24.13.1 at `/root/.local/node24/bin/node`      |
| Package manager          | pnpm 12.x (`/usr/local/bin/pnpm`)               |
| Nginx                    | 1.18.0 (Ubuntu package)                         |
| Backend service          | `yukino-chat.service`                           |
| Frontend web root        | `/var/www/yukino-chat`                          |
| Frontend source artifact | `/root/yukino-chat/client/dist`                 |
| SQLite database          | `/root/yukino-chat/server/prisma-sqlite/dev.db` |
| Backend log              | systemd journal (`journalctl -u yukino-chat`)   |
| Nginx configuration      | `/etc/nginx/conf.d/yukino-chat.conf`            |
| Firewall                 | `firewalld`, `public` zone, `8000/tcp` allowed  |

### 2.4 Ports and Trust Boundaries

| Port       | Interface       | Process      | Exposure                   | Purpose                        |
| ---------- | --------------- | ------------ | -------------------------- | ------------------------------ |
| `8000/tcp` | `0.0.0.0`       | Nginx        | Public (current)           | SPA, `/api/*` reverse proxy    |
| `8001/tcp` | `127.0.0.1`     | Node backend | Loopback only              | API, WebSocket, health         |
| `80/tcp`   | `0.0.0.0`       | Nginx        | Blocked by firewalld       | Default site only; unused      |
| `22/tcp`   | `0.0.0.0`       | OpenSSH      | Restricted by cloud policy | Administration                 |
| `5432/tcp` | loopback/docker | PostgreSQL   | Not exposed                | Only if `DATABASE_PROVIDER=pg` |
| `6379/tcp` | loopback/docker | Redis        | Not exposed                | Optional cache                 |

Both the **cloud security group** and **host firewalld** must allow a port.
Opening it in only one location is insufficient.

### 2.5 Filesystem Layout

```text
/root/yukino-chat/
  client/
    dist/                       # latest SPA build artifact (source of truth)
  server/
    .env                        # runtime configuration, mode 600
    dist/                       # compiled backend (tsc output)
    prisma/                     # PostgreSQL schema and migrations
    prisma-sqlite/              # SQLite schema, migrations, dev.db
    static/                     # avatars, files, chunks
    logs/                       # application log output (SENTRY_LOG_DIR)
  docker/
    nginx.conf.template         # canonical edge configuration
  package.json
  pnpm-lock.yaml

/var/www/yukino-chat/           # Nginx web root (copy of client/dist)
/etc/nginx/conf.d/yukino-chat.conf
/etc/systemd/system/yukino-chat.service
```

## 3. Configuration

### 3.1 Server Runtime Configuration

The backend reads `server/.env` through `dotenv/config`. Environment variables
provided by the process manager take precedence over the file.

| Variable                       | Required          | Default                  | Operational Notes                                                                                                                                      |
| ------------------------------ | ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_PROVIDER`            | No                | `pg`                     | `pg` or `sqlite`. Current deployment: `sqlite`.                                                                                                        |
| `DATABASE_URL`                 | No                | Provider-specific        | For SQLite, use a `file:` URL. Relative paths resolve against the server working directory. Current: `file:./prisma-sqlite/dev.db` (implicit default). |
| `HOST`                         | No                | `0.0.0.0`                | Current deployment: `127.0.0.1`. Bind to loopback behind Nginx.                                                                                        |
| `PORT`                         | No                | `8000`                   | Current deployment: `8001`.                                                                                                                            |
| `JWT_SECRET`                   | Yes in production | Development default      | Must be replaced with a strong random secret. Rotation invalidates all existing tokens.                                                                |
| `TOKEN_EXPIRE_HOURS`           | No                | `336`                    | Login token lifetime in hours.                                                                                                                         |
| `REDIS_URL`                    | No                | `redis://localhost:6379` | Empty string enables the in-memory cache fallback.                                                                                                     |
| `CACHE_TTL_SECONDS`            | No                | `300`                    | Read-through cache TTL.                                                                                                                                |
| `STATIC_AVATAR_DIR`            | No                | `./static/avatars`       | Avatar upload directory.                                                                                                                               |
| `STATIC_FILE_DIR`              | No                | `./static/files`         | File upload directory.                                                                                                                                 |
| `STATIC_CHUNK_DIR`             | No                | `./static/chunks`        | Chunked upload directory.                                                                                                                              |
| `SENTRY_LOG_DIR`               | No                | `./logs`                 | Application log directory created on boot.                                                                                                             |
| `AGENT_WS_MAX_MESSAGE_BYTES`   | No                | `4194304`                | Maximum agent WebSocket frame size.                                                                                                                    |
| `AGENT_IDLE_MS`                | No                | `1800000`                | Idle eviction threshold for agent runtimes.                                                                                                            |
| `AGENT_QUEUE_CAP`              | No                | `8`                      | Per-agent prompt queue capacity.                                                                                                                       |
| `AGENT_INTERACTION_TIMEOUT_MS` | No                | `300000`                 | Permission/question interaction timeout.                                                                                                               |
| `YUKINO_AI_PROTOCOL`           | No                | Empty                    | `anthropic`, `openai`, or `openai-compat`.                                                                                                             |
| `YUKINO_AI_BASE_URL`           | No                | Empty                    | Fallback LLM provider base URL.                                                                                                                        |
| `YUKINO_AI_API_KEY`            | No                | Empty                    | Fallback LLM API key. Sensitive.                                                                                                                       |
| `YUKINO_AI_MODEL`              | No                | Empty                    | Fallback model identifier.                                                                                                                             |

The current `/root/yukino-chat/server/.env` contains:

```env
DATABASE_PROVIDER=sqlite
HOST=127.0.0.1
PORT=8001
```

`JWT_SECRET` is currently not set, so the development default is in use. This
must be corrected before exposing the service beyond a controlled preview.
See Section 10.

The canonical environment reference is `server/.env.example`.

### 3.2 Client Build-Time Configuration

The SPA reads its API base at **build time**. It cannot be changed by editing a
file on the server after the build.

| Variable       | Production value | Notes                                                     |
| -------------- | ---------------- | --------------------------------------------------------- |
| `VITE_API_URL` | `/api`           | Same-origin prefix; Nginx strips `/api/` before proxying. |
| `VITE_WS_URL`  | Empty (optional) | Derived from the page origin and `/api` when unset.       |

Development commonly uses `http://localhost:8000`. Production must use `/api`
when the SPA and API are served from the same Nginx origin.

### 3.3 Secrets Management

- `server/.env` is excluded from version control and must remain mode `600`.
- Never commit `JWT_SECRET`, LLM API keys, or database credentials.
- Rotate `JWT_SECRET` by generating a high-entropy value, updating `.env`, and
  restarting the backend. All issued tokens become invalid immediately.
- Rotate LLM provider keys through the provider console and update `.env`.
- Store backups containing user data with encryption at rest.

### 3.4 Runtime Invariants

- Nginx must be able to read `/var/www/yukino-chat` as `www-data`.
- The backend must bind to a loopback address when Nginx is the public edge.
- Only one backend instance may own the SQLite file.
- The Nginx upstream must match the backend `HOST`/`PORT` exactly.
- `DATABASE_PROVIDER` must match the schema and migration directory in use.
- The SPA build must reference `/api`, not `localhost` or a stale host.

## 4. Provisioning

### 4.1 Host Prerequisites

Required packages and tooling:

- Ubuntu 22.04 or compatible Linux distribution.
- Node.js 24.x. The repository pins Node 24 via `.nvmrc`.
- pnpm 12.x.
- Nginx 1.18 or later.
- `git`, `curl`, `tar`, `python3`, `make`, and `g++` for native modules.
- Optional: `sqlite3` for online database backups.
- Optional: Redis, when persistent/shared caching is desired.

Node and pnpm must be available to systemd through an absolute path or an
explicit `PATH`. A non-login SSH shell does not inherit interactive shell
configuration, which is why the systemd unit sets `PATH` explicitly.

### 4.2 First-Time Bootstrap

```bash
# 1. Install Node.js 24 (example: standalone installation under /root/.local)
mkdir -p /root/.local/node24
curl -fL https://npmmirror.com/mirrors/node/v24.13.1/node-v24.13.1-linux-x64.tar.xz \
  | tar -xJ -C /root/.local/node24 --strip-components=1
export PATH=/root/.local/node24/bin:$PATH
node --version
# v24.x

# 2. Install pnpm
npm install -g pnpm
pnpm --version

# 3. Install system dependencies
apt-get update
apt-get install -y git curl tar python3 make g++ nginx
apt-get install -y sqlite3          # optional, for backups

# 4. Clone the repository
git clone git@github.com:hangtiancheng/yukino-chat.git /root/yukino-chat
cd /root/yukino-chat

# 5. Install JavaScript dependencies.
#    The mirror avoids timeouts when GitHub or nodejs.org is unreachable.
export npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3
pnpm install

# 6. Create the runtime environment file
umask 077
cat > server/.env <<'EOF'
DATABASE_PROVIDER=sqlite
HOST=127.0.0.1
PORT=8001
EOF

# 7. Build the backend
pnpm -C server build

# 8. Initialize or update the database
cd server
DATABASE_PROVIDER=sqlite pnpm db:deploy
```

The frontend build is intentionally excluded from the host bootstrap. See
Section 5.4 for the recommended off-host build procedure.

### 4.3 Nginx Configuration

The deployed configuration is derived from `docker/nginx.conf.template` with
three substitutions:

| Template value                | Host deployment value        |
| ----------------------------- | ---------------------------- |
| `${YUKINO_API_UPSTREAM}`      | `127.0.0.1:8001`             |
| `listen 80;`                  | `listen 8000;`               |
| `root /usr/share/nginx/html;` | `root /var/www/yukino-chat;` |

Install the rendered configuration:

```bash
cp <rendered-config> /etc/nginx/conf.d/yukino-chat.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

The full deployed configuration is reproduced in Appendix B.

Key behaviors:

- `/api/` is proxied with the prefix stripped. `/api/health` becomes `/health`.
- WebSocket upgrade headers are forwarded for `/api/wss`,
  `/api/agent/ws`, and `/api/dashboard/ws`.
- Long-lived sockets use `proxy_read_timeout 3600s`.
- `/assets/` is cached for seven days; `sw.js` is never cached.
- All non-file paths fall back to `/index.html` for client-side routing.
- `client_max_body_size` is `100m` for chunked uploads.

### 4.4 systemd Service

The backend is managed by `yukino-chat.service`. The full unit is reproduced in
Appendix A.

Important properties:

- `WorkingDirectory=/root/yukino-chat/server`
- `ExecStartPre` runs `prisma migrate deploy` before every start.
- `Restart=on-failure` with a three-second delay.
- `PATH` includes the Node 24 installation directory.
- The unit runs as `root` in the current deployment. A dedicated service user
  is a recommended hardening step.

Enable and start:

```bash
systemctl daemon-reload
systemctl enable --now yukino-chat
systemctl status yukino-chat
```

### 4.5 Firewall and Cloud Security Group

The current host uses `firewalld`. The effective public zone allows SSH and
`8000/tcp`:

```bash
firewall-cmd --zone=public --list-all
firewall-cmd --zone=public --add-port=8000/tcp --permanent
firewall-cmd --reload
```

Notes:

- `ufw` is inactive and `iptables` legacy output can be misleading. Inspect
  `firewalld` and `nft list ruleset` when diagnosing.
- The Alibaba Cloud security group must also allow inbound TCP `8000` from the
  intended source range.
- When TLS is introduced, expose only `443/tcp` and remove direct public
  access to `8000`.
- Restrict SSH to administrative source addresses where possible.

### 4.6 Container Deployment (Alternative)

The repository's canonical container topology is defined in
`docker-compose.yml`. It publishes only the Nginx edge and keeps the backend
private.

```bash
export DATABASE_PROVIDER=sqlite
export DATABASE_URL=file:/app/data/yukino-chat.db
export HTTP_PORT=8000
export VITE_API_URL=/api

docker compose up -d --build
docker compose ps
docker compose logs -f app nginx
```

Operational notes:

- The backend entrypoint runs `prisma migrate deploy` before starting Node.
- SQLite must reside on the `app-data` volume. Do not mount a directory over
  `prisma-sqlite/`, because that would hide the baked-in migrations.
- For PostgreSQL, set `DATABASE_PROVIDER=pg` and a PostgreSQL `DATABASE_URL`;
  the `postgres` service can be stopped when SQLite is used.
- Build on a host with sufficient memory or in CI. Building both images on the
  current 2 GB host is not recommended.
- Only the edge port is published; the backend has no host port mapping.
- Configure TLS in front of the edge, or extend the Nginx template with a
  `443` server block.

## 5. Release Management

### 5.1 Build Strategy

The host has 2 vCPU and 2 GB RAM. Building the full SPA on the host is possible
but slow and memory-constrained. The recommended split is:

| Component           | Build location             | Reason                                                    |
| ------------------- | -------------------------- | --------------------------------------------------------- |
| Backend (`server`)  | On the host                | Lightweight TypeScript and Prisma generation.             |
| Frontend (`client`) | Operator workstation or CI | Vite/Rolldown builds are memory-intensive on a 2 GB host. |

If the frontend must be built on the host:

```bash
cd /root/yukino-chat
NODE_OPTIONS=--max-old-space-size=1536 \
VITE_API_URL=/api \
pnpm -C client exec vite build --sourcemap false
```

Ensure 4 GB of swap is active and stop non-essential services during the
build. Disabling source maps materially reduces memory pressure.

### 5.2 Pre-Release Checklist

1. Confirm the target commit and changelog.
2. Verify the working tree is clean on the target branch.
3. Back up the SQLite database and upload directories.
4. Confirm available disk and memory.
5. Confirm the Nginx upstream and backend port are unchanged.
6. Confirm `VITE_API_URL=/api` for the production frontend build.
7. Confirm a rollback revision and a prior frontend artifact are available.

### 5.3 Backend Release

```bash
cd /root/yukino-chat
export PATH=/root/.local/node24/bin:$PATH
export npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3

# 1. Fetch the target revision (fast-forward only)
git pull --ff-only

# 2. Install dependencies if the lockfile or package manifests changed
pnpm install

# 3. Build the backend and regenerate both Prisma clients
pnpm -C server build

# 4. Apply migrations explicitly before restarting.
#    The systemd ExecStartPre repeats this idempotently.
cd server
DATABASE_PROVIDER=sqlite pnpm db:deploy
cd ..

# 5. Restart the service
systemctl restart yukino-chat
```

If `pnpm db:deploy` fails, do **not** restart the service. Diagnose the
migration and restore the database if necessary.

### 5.4 Frontend Release

Build on the operator workstation:

```powershell
cd C:\path\to\yukino-chat
$env:VITE_API_URL = '/api'
$env:VITE_WS_URL = ''
pnpm -C client build

# Package the deployable output, excluding local source maps
tar --exclude=dist/.sourcemaps -czf yukino-web.tgz -C client dist
scp yukino-web.tgz root@123.57.193.65:/tmp/
```

Deploy on the host:

```bash
cd /root/yukino-chat
rm -rf client/dist
tar -xzf /tmp/yukino-web.tgz -C client
rm -f /tmp/yukino-web.tgz

rm -rf /var/www/yukino-chat
cp -r client/dist /var/www/yukino-chat
chown -R www-data:www-data /var/www/yukino-chat
chmod -R a+rX /var/www/yukino-chat
```

The backend does not need to restart after a static frontend deployment.
However, if the release also changes API contracts, restart the backend first
and deploy the frontend second to minimize incompatibility windows.

An atomic release layout (`releases/<timestamp>` plus a `current` symlink) is
recommended for future hardening. The current procedure replaces the web root
in place and therefore has a brief window where old and new assets may be
served together.

### 5.5 Database Migrations

- Migrations are forward-only. Do not edit an already-applied migration.
- Run `prisma migrate deploy`; never use `prisma migrate reset` on a live
  database.
- Back up the database before every release that includes a schema change.
- The systemd unit executes the migration on each start, so a migration
  failure prevents the backend from starting. This is intentional.
- `DATABASE_PROVIDER=sqlite` selects `prisma-sqlite/migrations`.
- `DATABASE_PROVIDER=pg` selects `prisma/migrations`.

### 5.6 Restart and Verification

```bash
systemctl restart yukino-chat
systemctl is-active yukino-chat
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/
```

Expected results:

| Check          | Expected          |
| -------------- | ----------------- |
| Backend health | `{"status":"ok"}` |
| Proxied health | `{"status":"ok"}` |
| SPA root       | `200`             |
| Static asset   | `200`             |
| systemd state  | `active`          |

Then verify externally:

```bash
curl --noproxy '*' -I http://123.57.193.65:8000/
curl --noproxy '*' -sS http://123.57.193.65:8000/api/health
```

### 5.7 Rollback

**Frontend rollback**

1. Restore the previous `/var/www/yukino-chat` content from a backup or a
   previously saved artifact.
2. Ensure ownership is `www-data:www-data`.
3. Reload Nginx only if the configuration changed.

No backend restart is required for a static rollback.

**Backend rollback**

```bash
cd /root/yukino-chat
git checkout <previous-revision>
export PATH=/root/.local/node24/bin:$PATH
pnpm install
pnpm -C server build
systemctl restart yukino-chat
```

**Database rollback**

Database migrations are not automatically reversible. If a release included an
incompatible schema change:

1. Stop the backend.
2. Restore the pre-release database backup.
3. Start the backend.
4. Verify health and application behavior.

Do not attempt to reverse migrations manually on a live database.

### 5.8 Release Checklist

- [ ] Commit identified and reviewed.
- [ ] Database backup completed and verified.
- [ ] Dependencies installed from the lockfile.
- [ ] Both Prisma clients generated.
- [ ] Backend TypeScript build succeeded.
- [ ] Frontend built with `VITE_API_URL=/api`.
- [ ] Frontend artifact uploaded and checksum verified.
- [ ] Web root replaced and permissions corrected.
- [ ] Migrations applied successfully.
- [ ] Backend restarted.
- [ ] Internal and external health checks passed.
- [ ] Static assets and WebSocket upgrade verified.
- [ ] Previous revision and frontend artifact retained for rollback.

## 6. Standard Operations

### 6.1 Service Management

```bash
# Status
systemctl status yukino-chat
systemctl status nginx

# Lifecycle
systemctl start yukino-chat
systemctl stop yukino-chat
systemctl restart yukino-chat
systemctl reload nginx

# Boot behavior
systemctl enable yukino-chat
systemctl disable yukino-chat
systemctl is-enabled yukino-chat nginx
```

### 6.2 Logs

| Source                    | Command or location                                     |
| ------------------------- | ------------------------------------------------------- |
| Backend application logs  | `journalctl -u yukino-chat -f`                          |
| Backend errors only       | `journalctl -u yukino-chat -p err --since "1 hour ago"` |
| Nginx service logs        | `journalctl -u nginx`                                   |
| Nginx access log          | `/var/log/nginx/access.log`                             |
| Nginx error log           | `/var/log/nginx/error.log`                              |
| Application log directory | `/root/yukino-chat/server/logs`                         |
| Prisma migration output   | Included in `journalctl -u yukino-chat`                 |

`journalctl --vacuum-time=14d` may be used to bound journal growth, subject to
retention policy. Nginx log rotation is provided by the distribution package.
Configure rotation for `server/logs` if the directory grows.

### 6.3 Health Checks

```bash
# Backend liveness, bypassing Nginx
curl -fsS http://127.0.0.1:8001/health

# Public liveness through Nginx
curl -fsS http://127.0.0.1:8000/api/health

# SPA availability
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/

# Nginx configuration validation
nginx -t
```

The backend health endpoint is intentionally unauthenticated. Do not expose it
as a substitute for authentication or application-level readiness checks.

### 6.4 Configuration Changes

1. Edit `/root/yukino-chat/server/.env` with mode `600`.
2. Validate the values against `server/.env.example`.
3. Restart the backend: `systemctl restart yukino-chat`.
4. Verify `/api/health` and application login.
5. Record the change in the operations log.

Nginx configuration changes require `nginx -t` before `systemctl reload nginx`.
A failed test must be corrected before reload; Nginx continues running with the
previous configuration.

### 6.5 Dependency Updates

- Update `pnpm-lock.yaml` through the repository workflow, not on the host.
- Review native dependency changes (Prisma engines, better-sqlite3).
- Rebuild both Prisma clients after schema or generator changes.
- Run the test suite before deployment.
- Retain the previous revision for rollback.
- Do not run `pnpm update` directly on the production host.

## 7. Backup and Restore

### 7.1 Backup Scope

| Asset            | Path                                    | Frequency            | Notes                                       |
| ---------------- | --------------------------------------- | -------------------- | ------------------------------------------- |
| SQLite database  | `server/prisma-sqlite/dev.db`           | Daily / pre-release  | Primary application data.                   |
| Uploaded content | `server/static/`                        | Daily                | Avatars, files, chunks.                     |
| Application logs | `server/logs/`                          | Per retention policy | Optional; useful for investigations.        |
| Configuration    | `server/.env`, Nginx and systemd units  | On change            | Contains secrets; protect at rest.          |
| SPA artifact     | `client/dist` or `/var/www/yukino-chat` | Per release          | Reproducible, but useful for fast rollback. |

### 7.2 SQLite Online Backup

Preferred online backup using the SQLite backup API:

```bash
install -d -m 700 /var/backups/yukino-chat
sqlite3 /root/yukino-chat/server/prisma-sqlite/dev.db \
  ".backup '/var/backups/yukino-chat/dev-$(date +%Y%m%d-%H%M%S).db'"
```

Verify the backup:

```bash
sqlite3 /var/backups/yukino-chat/<backup>.db 'PRAGMA integrity_check;'
# Expected: ok
```

If `sqlite3` is unavailable and installing it is not possible, stop the
backend, copy `dev.db`, and remove stale `-wal` and `-shm` files if present.
Restart the backend immediately after the copy.

### 7.3 PostgreSQL Backup

When `DATABASE_PROVIDER=pg`:

```bash
pg_dump --format=custom --file=/var/backups/yukino-chat/yukino-$(date +%F).dump \
  postgresql://yukino:yukino@localhost:5432/yukino_chat
```

Restore with `pg_restore --clean --if-exists`.

### 7.4 Restore Procedure

SQLite:

```bash
systemctl stop yukino-chat

install -m 600 /var/backups/yukino-chat/<backup>.db \
  /root/yukino-chat/server/prisma-sqlite/dev.db

# Remove stale sidecar files if present after restoring a stopped copy
rm -f /root/yukino-chat/server/prisma-sqlite/dev.db-wal \
      /root/yukino-chat/server/prisma-sqlite/dev.db-shm

systemctl start yukino-chat
curl -fsS http://127.0.0.1:8001/health
```

Also restore `server/static/` and any configuration files that changed.
Validate the application login and a representative chat flow after restore.

### 7.5 Retention and Off-Host Storage

Example retention policy:

- Daily backups: 7 days.
- Weekly backups: 4 weeks.
- Monthly backups: 12 months.
- Pre-release backups: retain until the next successful release.

Copy backups off the host to object storage or a backup server. Encrypt backups
at rest and restrict access to the backup directory. Test restores
periodically; an unverified backup is not a recovery plan.

### 7.6 Restore Drill

At least quarterly:

1. Restore the latest backup into a non-production host or isolated directory.
2. Start a backend instance with a non-conflicting port and database URL.
3. Verify `/health`, login, and message retrieval.
4. Record the restore duration (RTO) and data loss window (RPO).

## 8. Monitoring and Maintenance

### 8.1 Required Signals

| Signal             | Check                                     | Suggested threshold               |
| ------------------ | ----------------------------------------- | --------------------------------- |
| Backend process    | `systemctl is-active yukino-chat`         | Must be `active`                  |
| Nginx process      | `systemctl is-active nginx`               | Must be `active`                  |
| Proxied health     | `/api/health`                             | HTTP 200 with `{"status":"ok"}`   |
| 5xx rate           | Nginx access/error logs                   | Alert on sustained 5xx            |
| Restart count      | `systemctl show -p NRestarts yukino-chat` | Alert on repeated increases       |
| Disk usage         | `df -h /`                                 | Warn at 75%, critical at 85%      |
| Memory / swap      | `free -h`                                 | Alert on sustained swap thrashing |
| SQLite size        | `du -h .../dev.db`                        | Capacity planning                 |
| Certificate expiry | TLS endpoint                              | If TLS is enabled                 |
| Backup age         | `find /var/backups/yukino-chat -type f`   | Alert if older than 24 hours      |

### 8.2 Operational Checks

```bash
systemctl status yukino-chat nginx
systemctl show -p NRestarts yukino-chat
journalctl -u yukino-chat -p err --since "24 hours ago"
df -h /
free -h
du -sh /root/yukino-chat/server/prisma-sqlite /root/yukino-chat/server/static
nginx -t
```

### 8.3 Routine Maintenance

| Cadence     | Task                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| Daily       | Check health endpoint, service states, disk, and backup completion.      |
| Weekly      | Review error logs, restart counts, and Nginx 4xx/5xx patterns.           |
| Monthly     | Apply OS security updates, review dependencies, verify backup integrity. |
| Quarterly   | Restore drill, secret rotation review, TLS/certificate review.           |
| Per release | Backup, migration review, release checklist, post-deploy verification.   |

### 8.4 Log Rotation

Nginx uses the distribution logrotate configuration. If
`SENTRY_LOG_DIR=/root/yukino-chat/server/logs` accumulates files, add a
logrotate policy that rotates daily, compresses, retains 14 rotations, and
signals the backend only if the application reopens files on signal. Verify
that the application does not hold open descriptors indefinitely.

## 9. Troubleshooting

| Symptom                                 | Likely cause                                                                      | Diagnosis and remediation                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `502 Bad Gateway`                       | Backend down, wrong upstream port, or failed migration                            | `systemctl status yukino-chat`; `journalctl -u yukino-chat -n 100`; verify `PORT=8001` and the Nginx upstream; check `ss -ltnp \| grep 8001`.                                              |
| Public `:8000` times out                | firewalld or cloud security group denies the port                                 | `firewall-cmd --zone=public --list-ports`; `ss -ltnp \| grep 8000`; verify the cloud security group allows TCP 8000; note that port 22 working proves the network path, not the port rule. |
| SPA returns 404 or blank page           | Missing web root, wrong permissions, or stale index                               | `ls -l /var/www/yukino-chat/index.html`; verify owner `www-data`; `nginx -t`; inspect `/var/log/nginx/error.log`.                                                                          |
| Asset 404 after deploy                  | `index.html` references a missing hashed file or the web root is partially copied | Compare the asset name in `index.html` with `/var/www/yukino-chat/assets`; redeploy the full `dist`; clear the service worker cache.                                                       |
| API calls go to `localhost`             | SPA built without `VITE_API_URL=/api`                                             | Inspect the built asset for `VITE_API_URL` and rebuild the frontend with `/api`; redeploy.                                                                                                 |
| WebSocket fails or returns 401/403      | Invalid/expired token, missing `/api` prefix, or proxy upgrade headers absent     | Verify the URL (`/api/wss`), token, and Nginx `Upgrade`/`Connection` headers; check `proxy_read_timeout`; inspect backend logs.                                                            |
| `better-sqlite3` install fails          | Node 20 ABI has no prebuilt Linux binary; GitHub/nodejs.org timeouts              | Use Node 24; set `npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3`; install `python3 make g++`; rerun `pnpm rebuild better-sqlite3`.          |
| Prisma client not found                 | Clients not generated after schema change or clean checkout                       | Run `pnpm prisma:generate` or `pnpm -C server build`; confirm both `src/generated/prisma` and `src/generated/prisma-sqlite`.                                                               |
| Migration failure on start              | Invalid schema, missing migration directory, or locked database                   | Inspect `journalctl -u yukino-chat`; run `DATABASE_PROVIDER=sqlite pnpm db:deploy` manually; verify `DATABASE_PROVIDER` matches the migration set.                                         |
| `SQLITE_BUSY` / database locked         | Multiple processes or long-running transactions                                   | Ensure only one backend instance owns the SQLite file; stop duplicate processes; use PostgreSQL for concurrent multi-instance workloads.                                                   |
| Node not found under systemd            | Non-login `PATH` lacks the Node 24 installation                                   | Use an absolute `ExecStart` path; set `PATH` in the unit; verify with `systemctl show -p Environment yukino-chat`.                                                                         |
| Frontend build hangs or OOMs on host    | 2 GB RAM insufficient for the Vite build                                          | Build off-host; add swap; use `--sourcemap false`; avoid parallel root builds.                                                                                                             |
| PWA does not install                    | Service worker requires a secure context                                          | Serve over HTTPS; HTTP is allowed only for `localhost`.                                                                                                                                    |
| External access fails while local works | Public/edge firewall policy                                                       | Test `curl --noproxy '*'`; verify both firewalld and the cloud security group; check the public IP assignment.                                                                             |

## 10. Security

### 10.1 Current Posture

- Public ingress is plain HTTP on `:8000`; there is no TLS termination on the
  host at present.
- The backend listens on loopback and is not directly reachable externally.
- The systemd service runs as `root`.
- `JWT_SECRET` is still the development default.
- The cloud security group and firewalld jointly restrict ingress.

This posture is acceptable only for a controlled preview. The following
hardening steps are required before handling real user data or exposing the
service broadly.

### 10.2 Required Hardening

1. **TLS**
   - Terminate TLS at a load balancer or add an Nginx `443` server block.
   - Redirect HTTP to HTTPS.
   - Expose only `443` publicly and keep the backend loopback-only.
   - PWA functionality requires HTTPS.

2. **JWT secret**

   ```bash
   openssl rand -base64 48
   ```

   Store the value in `server/.env` with mode `600`. Restart the backend.
   Existing sessions are invalidated.

3. **Dedicated service account**
   - Create a non-root user (for example, `yukino`).
   - Grant read/write access to `server/prisma-sqlite`, `server/static`, and
     `server/logs`.
   - Update the systemd unit with `User=` and `Group=`.
   - Re-validate migrations and uploads under the new identity.

4. **Firewall least privilege**
   - Restrict SSH to administrative networks.
   - Close direct public access to `8001` (already loopback-only).
   - Remove `8000` from the public edge after TLS is available.

5. **Rate limiting and abuse controls**
   - Add Nginx `limit_req` rules for authentication and upload endpoints if
     traffic warrants it.
   - Preserve the application-level rate limits.
   - Keep `client_max_body_size` at the minimum value that supports intended
     uploads.

6. **Secrets and backups**
   - Keep `.env` out of version control and backups in encrypted storage.
   - Rotate LLM keys and JWT secrets on a defined schedule.
   - Restrict backup directory permissions.

7. **Dependency and OS updates**
   - Apply Ubuntu security updates promptly.
   - Review `pnpm-lock.yaml` changes and run tests before deployment.
   - Monitor Prisma and native module advisories.

8. **Nginx hardening**
   - Add security headers where appropriate
     (`X-Content-Type-Options`, `Referrer-Policy`, HSTS with TLS).
   - Keep the default Ubuntu site disabled if it is not needed.
   - Review access logs for anomalous authentication and upload traffic.

## 11. Known Constraints

- **Single instance.** WebSocket connections, call rooms, in-memory rate
  limits, and agent runtimes are process-local. Horizontal scaling requires
  shared pub/sub and sticky sessions, which are not implemented.
- **SQLite is a single-writer database.** It is suitable for this single-node
  deployment, not for multiple application instances. Use PostgreSQL for that
  topology.
- **Redis is optional.** Cache reads degrade to the database on Redis errors;
  an empty `REDIS_URL` selects the in-memory cache.
- **No TLS out of the box.** The bundled Nginx configuration is HTTP-only.
- **Limited build capacity.** The 2 GB host cannot comfortably build the SPA;
  use off-host builds.
- **Forward-only migrations.** Rollback of schema changes requires a database
  restore.
- **In-place frontend deployment.** The current procedure replaces the web
  root directly; an atomic release/symlink layout is a recommended
  improvement.

## 12. Disaster Recovery

### 12.1 Scenario: Host Loss

1. Provision an Ubuntu 22.04 host with equivalent or better capacity.
2. Install Node.js 24, pnpm, Nginx, build tools, and `git`.
3. Clone the repository at the last known-good revision.
4. Restore `server/.env` from secure configuration storage.
5. Install dependencies with the configured prebuild mirror.
6. Restore the SQLite database and `server/static/` from backup.
7. Build the backend.
8. Build or upload the frontend artifact with `VITE_API_URL=/api`.
9. Install the Nginx configuration and systemd unit.
10. Open only the required ports in firewalld and the cloud security group.
11. Start Nginx and the backend.
12. Execute the full verification checklist.

### 12.2 Recovery Objectives

Example targets, to be refined by the service owner:

| Objective               | Target                                                |
| ----------------------- | ----------------------------------------------------- |
| RPO (maximum data loss) | 24 hours for daily backups; 0 for pre-release backups |
| RTO (time to restore)   | 60 minutes for a prepared host                        |
| Backup verification     | Quarterly restore drill                               |

### 12.3 Recovery Validation

- `/api/health` returns `{"status":"ok"}`.
- SPA loads over the public endpoint.
- Login succeeds with a known account.
- A message can be sent and received.
- Representative uploads are retrievable.
- WebSocket upgrade succeeds.
- Logs contain no migration or schema errors.

## Appendix A: systemd Unit

`/etc/systemd/system/yukino-chat.service`

```ini
[Unit]
Description=yukino-chat backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/yukino-chat/server
Environment=PATH=/root/.local/node24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStartPre=/root/yukino-chat/server/node_modules/.bin/prisma migrate deploy
ExecStart=/root/.local/node24/bin/node dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Apply changes with:

```bash
systemctl daemon-reload
systemctl restart yukino-chat
systemctl status yukino-chat
```

## Appendix B: Nginx Configuration

`/etc/nginx/conf.d/yukino-chat.conf`

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream yukino_api {
    server 127.0.0.1:8001;
}

server {
    listen 8000;
    server_name _;

    root /var/www/yukino-chat;
    index index.html;

    client_max_body_size 100m;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 5;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml
        font/woff2;

    location /api/ {
        proxy_pass http://yukino_api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=604800, immutable";
        try_files $uri =404;
    }

    location = /sw.js {
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

The canonical source is `docker/nginx.conf.template`; the container deployment
renders it with `YUKINO_API_UPSTREAM` via the official Nginx image entrypoint.

## Appendix C: Environment Reference

`server/.env` for the current deployment:

```env
DATABASE_PROVIDER=sqlite
HOST=127.0.0.1
PORT=8001
```

Production hardening additions:

```env
JWT_SECRET=<high-entropy-secret>
# REDIS_URL=redis://127.0.0.1:6379
# CACHE_TTL_SECONDS=300
# SENTRY_LOG_DIR=./logs
```

A complete annotated reference is available in `server/.env.example`.

## Appendix D: Command Cheat Sheet

```bash
# Service status
systemctl status yukino-chat nginx

# Backend logs
journalctl -u yukino-chat -f

# Nginx validation and reload
nginx -t
systemctl reload nginx

# Health checks
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/

# Listening sockets
ss -ltnp | grep 8001
ss -ltnp | grep 8000

# Firewall
firewall-cmd --zone=public --list-all

# Database backup
sqlite3 /root/yukino-chat/server/prisma-sqlite/dev.db \
  ".backup '/var/backups/yukino-chat/dev-$(date +%F-%H%M%S).db'"

# Database restore (service stopped)
systemctl stop yukino-chat
install -m 600 /var/backups/yukino-chat/<backup>.db \
  /root/yukino-chat/server/prisma-sqlite/dev.db
systemctl start yukino-chat

# Manual migration
cd /root/yukino-chat/server
PATH=/root/.local/node24/bin:$PATH DATABASE_PROVIDER=sqlite pnpm db:deploy

# Backend release
cd /root/yukino-chat
export PATH=/root/.local/node24/bin:$PATH
pnpm install
pnpm -C server build
systemctl restart yukino-chat
```

## Appendix E: Release Checklist

- [ ] Target revision reviewed and approved.
- [ ] Working tree clean and branch fast-forwarded.
- [ ] Database and upload backups completed and integrity-checked.
- [ ] Node.js 24 and pnpm available.
- [ ] `better-sqlite3` prebuild mirror configured if dependencies change.
- [ ] Both Prisma clients generated.
- [ ] Backend build succeeds.
- [ ] Frontend built with `VITE_API_URL=/api`.
- [ ] Frontend artifact checksum verified.
- [ ] Web root updated and owned by `www-data`.
- [ ] Migrations applied successfully.
- [ ] Backend restarted and active.
- [ ] Internal health, public health, SPA, assets, and WebSocket verified.
- [ ] Previous revision and frontend artifact retained.
- [ ] Release recorded in the operations log.
