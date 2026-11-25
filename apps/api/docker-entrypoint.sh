#!/bin/sh
# ==============================================================================
# Docker Entrypoint — NUTS Commerce API
# ==============================================================================
# Runs Prisma migrations against the database before starting the server.
# Retries on failure with exponential backoff to handle transient DB issues.
# ==============================================================================
set -eu

# If AUTO_MIGRATE is not explicitly set to false and DATABASE_URL is provided,
# execute database migrations before booting the NestJS application.
if [ "${AUTO_MIGRATE:-true}" != "false" ] && [ -n "${DATABASE_URL:-}" ]; then
  if [ -x "./docker-migrate.sh" ]; then
    echo "[entrypoint] Executing automated database migrations..."
    ./docker-migrate.sh
  elif [ -x "/app/apps/api/docker-migrate.sh" ]; then
    echo "[entrypoint] Executing automated database migrations..."
    /app/apps/api/docker-migrate.sh
  fi
fi

export TS_NODE_PROJECT=./tsconfig.runtime.json

# PM2_APP selects which role this container runs: api (default), worker or jobs.
# PM2_ENABLED=false is the rollback switch: run the single-process API as before.
PM2_APP="${PM2_APP:-api}"
if [ "${PM2_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] PM2 disabled; starting NestJS API directly..."
  exec node -r tsconfig-paths/register dist/main
fi

PM2_RUNTIME="$(command -v pm2-runtime || true)"
if [ -z "$PM2_RUNTIME" ] && [ -x /app/node_modules/.bin/pm2-runtime ]; then
  PM2_RUNTIME=/app/node_modules/.bin/pm2-runtime
fi
if [ -z "$PM2_RUNTIME" ]; then
  echo "[entrypoint] pm2-runtime not found; set PM2_ENABLED=false to run without it." >&2
  exit 1
fi

echo "[entrypoint] Starting role '${PM2_APP}' under PM2..."
exec "$PM2_RUNTIME" ecosystem.config.cjs --only "$PM2_APP"
