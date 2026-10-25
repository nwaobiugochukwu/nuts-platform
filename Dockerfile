# ==============================================================================
# Root Multi-Target Dockerfile for Monorepo (Back4App & Cloud Platforms)
# Allows building either 'api' or 'web' from the root build context.
# Default target: api
# ==============================================================================

# ------------------------------------------------------------------------------
# API BUILD & RUNNER
# ------------------------------------------------------------------------------
FROM node:22-alpine AS api-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY tsconfig.base.json tsconfig.node.json ./

RUN npm ci

COPY packages/database ./packages/database
RUN npm run db:generate --workspace=@nuts/database

COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build:api

FROM node:22-alpine AS api-runner
WORKDIR /app
RUN apk add --no-cache dumb-init curl openssl

ENV NODE_ENV=production
ENV PORT=3001
ENV NODE_OPTIONS="--max-old-space-size=350"
ENV UV_THREADPOOL_SIZE=4

COPY --from=api-builder /app/package*.json ./
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-builder /app/packages/database/schema.prisma ./packages/database/schema.prisma
COPY --from=api-builder /app/packages/database/migrations ./packages/database/migrations
COPY --from=api-builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=api-builder /app/apps/api/tsconfig.runtime.json ./apps/api/tsconfig.runtime.json
COPY --from=api-builder /app/apps/api/dist ./apps/api/dist
COPY --from=api-builder /app/apps/api/package.json ./apps/api/package.json

COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
COPY apps/api/docker-migrate.sh ./apps/api/docker-migrate.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh ./apps/api/docker-migrate.sh \
  && mkdir -p /app/node_modules/.bin \
  && if [ -f /app/apps/api/node_modules/.bin/prisma ]; then ln -sf /app/apps/api/node_modules/.bin/prisma /app/node_modules/.bin/prisma; fi

RUN chown -R node:node /app
USER node

WORKDIR /app/apps/api
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3001/api/v1/health || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["dumb-init", "./docker-entrypoint.sh"]


# ------------------------------------------------------------------------------
# WEB BUILD & RUNNER
# ------------------------------------------------------------------------------
FROM node:22-slim AS web-builder
WORKDIR /app

COPY package*.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY tsconfig.base.json tsconfig.node.json tsconfig.web.json ./

RUN npm ci

COPY packages ./packages
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG INTERNAL_API_URL=http://localhost:3001

ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build:web

FROM node:22-slim AS web-runner
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=400"
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

COPY --from=web-builder /app/apps/web/public ./apps/web/public
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

STOPSIGNAL SIGTERM
CMD ["dumb-init", "node", "apps/web/server.js"]
