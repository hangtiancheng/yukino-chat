#!/bin/sh
set -e
# Use the locally installed prisma CLI (a runtime dependency) so the version
# matches the lockfile and `prisma/config` resolves from /app/server.
./node_modules/.bin/prisma migrate deploy
exec node dist/index.js
