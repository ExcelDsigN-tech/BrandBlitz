# syntax=docker/dockerfile:1.7

# Issue #227: Harden Dockerfile with pinned base image, multi-stage build, and non-root user
# - Pinned to specific Node Alpine digest for reproducibility
# - Multi-stage build to minimize final image size
# - Non-root user for security
# Node version is pinned once in the repository root `.nvmrc` and must match
# apps/web/Dockerfile and apps/deposit-monitor/Dockerfile (issue #897).

# ── Stage 1: Dependencies ───────────────────────────────────────────────────
# Pinned to Node 22.14.0-alpine with specific SHA256 digest
# To update: docker pull node:22.14.0-alpine && docker inspect node:22.14.0-alpine --format '{{index .RepoDigests 0}}'
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS deps
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/stellar/package.json ./packages/stellar/
COPY packages/storage/package.json ./packages/storage/
RUN pnpm install --frozen-lockfile

# ── Stage 2: Dev (tsx hot reload) ────────────────────────────────────────────
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS dev
RUN corepack enable pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["pnpm", "dev"]

# ── Stage 3: Builder (TypeScript → JavaScript) ──────────────────────────────
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS builder
RUN corepack enable pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/apps/api
RUN pnpm build

# ── Stage 4: Production dependencies (pruned) ────────────────────────────────
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS prod-deps
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/stellar/package.json ./packages/stellar/
COPY packages/storage/package.json ./packages/storage/
RUN pnpm install --frozen-lockfile --prod

# ── Stage 5: Runner (Production) ─────────────────────────────────────────────
# Issue #227: Run as non-root user for security
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS runner

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy dependencies and built files with proper ownership
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder  --chown=nodejs:nodejs /app/apps/api/dist ./dist
COPY --from=builder  --chown=nodejs:nodejs /app/packages ./packages

ENV NODE_ENV=production

# Switch to non-root user
USER nodejs

EXPOSE 3001
STOPSIGNAL SIGTERM

# Healthcheck uses PORT env var (defaults to 3001 per docker-compose.yml)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3001}/health || exit 1

CMD ["node", "dist/index.js"]
