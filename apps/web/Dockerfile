# ==============================================================================
# Multi-stage Dockerfile — Next.js Web Client (Monorepo)
# Stages: builder → dev | runner (prod)
# ==============================================================================

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# 1. Copy workspace manifests for optimal caching
COPY package*.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY tsconfig.base.json tsconfig.node.json tsconfig.web.json ./

# 2. Install workspace dependencies
RUN npm ci

# 3. Copy source files
COPY packages ./packages
COPY apps/web ./apps/web

# Build-time env vars (public ones get embedded into the client bundle)
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG INTERNAL_API_URL=http://api:3001
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID

ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_TELEMETRY_DISABLED=1

# 4. Build Next.js
RUN npm run build:web

# ─── Stage 2: Dev ─────────────────────────────────────────────────────────────
FROM node:22-slim AS dev

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY tsconfig.base.json tsconfig.node.json tsconfig.web.json ./

RUN npm ci

COPY packages ./packages
COPY apps/web ./apps/web

WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

CMD ["npx", "next", "dev", "-p", "3000"]

# ─── Stage 3: Production Runtime ──────────────────────────────────────────────
FROM node:22-slim AS runner

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

# In Next.js standalone monorepo output, server.js resides in apps/web/server.js
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-3000}/health" || exit 1

STOPSIGNAL SIGTERM

CMD ["dumb-init", "node", "apps/web/server.js"]
