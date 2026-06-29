#!/bin/sh
set -e

# Assemble DATABASE_URL from the individual fields injected by ECS (sourced from
# the RDS-managed secret). If DATABASE_URL is already set (e.g. local docker),
# we leave it untouched.
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"
fi

echo "[entrypoint] applying database migrations…"
./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] starting api…"
exec node dist/main.js
