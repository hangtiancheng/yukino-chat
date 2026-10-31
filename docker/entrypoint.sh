#!/bin/sh
set -e
prisma migrate deploy
exec node dist/index.js
