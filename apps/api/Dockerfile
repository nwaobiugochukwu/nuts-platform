# ==============================================================================
# Multi-stage Dockerfile — NestJS API (Monorepo)
# Stages: builder → dev | runner (prod)
# ==============================================================================

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

# 1. Copy workspace manifests for optimal layer caching
COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY tsconfig.base.json tsconfig.node.json ./
COPY scripts/postinstall.js ./scripts/postinstall.js

# 2. Install workspace dependencies
RUN npm ci

# 3. Copy Prisma schema & generate typed Prisma client
COPY packages/database ./packages/database
RUN npm run db:generate --workspace=@nuts/database

# 4. Copy shared packages and API source code
COPY packages ./packages
COPY apps/api ./apps/api

# 5. Build NestJS API
RUN npm run build:api

# ─── Stage 2: Dev ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl curl

COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY tsconfig.base.json tsconfig.node.json ./
COPY scripts/postinstall.js ./scripts/postinstall.js

RUN npm ci

COPY packages/database ./packages/database
RUN npx prisma generate --schema=packages/database/schema.prisma

COPY packages ./packages
COPY apps/api ./apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=development
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "dev"]

# ─── Stage 3: Production Runtime ──────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# dumb-init: proper PID 1 signal forwarding (SIGTERM / SIGINT)
# curl: healthcheck probe
# openssl: Prisma TLS engine
RUN apk add --no-cache dumb-init curl openssl

ENV NODE_ENV=production
ENV PORT=3001
ENV NODE_OPTIONS="--max-old-space-size=350"
ENV UV_THREADPOOL_SIZE=4

# Copy required production node_modules and built output from builder
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=node:node /app/packages/database/schema.prisma ./packages/database/schema.prisma
COPY --from=builder --chown=node:node /app/packages/database/migrations ./packages/database/migrations
COPY --from=builder --chown=node:node /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder --chown=node:node /app/apps/api/tsconfig.runtime.json ./apps/api/tsconfig.runtime.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
# Fail the image build if the entrypoint or an API runtime dependency is missing.
RUN test -s /app/apps/api/dist/main.js \
  && test -s /app/apps/api/dist/app.module.js \
  && cd /app/apps/api \
  && node -e 'for (const name of Object.keys(require("./package.json").dependencies)) require.resolve(name)'
COPY --chown=node:node apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
COPY --chown=node:node apps/api/docker-migrate.sh ./apps/api/docker-migrate.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh ./apps/api/docker-migrate.sh \
  && mkdir -p /app/node_modules/.bin \
  && if [ -f /app/apps/api/node_modules/.bin/prisma ]; then ln -sf /app/apps/api/node_modules/.bin/prisma /app/node_modules/.bin/prisma; fi

# Run as non-root user for container security. Files copied from the builder
# already belong to node, avoiding a recursive ownership walk over node_modules.
USER node

WORKDIR /app/apps/api
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3001/api/v1/health || exit 1

STOPSIGNAL SIGTERM

ENTRYPOINT ["dumb-init", "./docker-entrypoint.sh"]
