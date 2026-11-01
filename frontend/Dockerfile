# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Frontend image — Next.js 15 (App Router) in `output: "standalone"` mode.
#
# Three stages so the runtime image carries no source, no dev dependencies and
# no package-manager store:
#
#   deps    — `pnpm install --frozen-lockfile` from the committed lockfile
#   builder — `next build`. NEXT_PUBLIC_* values are INLINED into the client
#             bundle at build time, so they must be build args, not runtime env
#   runner  — node:22-alpine + .next/standalone (+ static assets), non-root
#
# Networking note: this is a browser-facing app. Its *public* API origin must
# resolve from the browser (nginx on :80 of the host), while its server-side
# route handlers need an in-network address. The latter is supplied at runtime
# as API_INTERNAL_URL (see src/lib/server/session.ts) — server code reads
# non-public env vars at runtime, unlike the inlined NEXT_PUBLIC_* ones.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
# package.json pins `packageManager: pnpm@12.8.1`; corepack honours it.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HUSKY=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `prepare` runs scripts/prepare-husky.mjs during install (a no-op without .git,
# but the file must exist or the lifecycle script errors).
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost
ARG NEXT_PUBLIC_WS_URL=ws://localhost
ARG NEXT_PUBLIC_APP_NAME=Social
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
RUN pnpm build

FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Matches the compose file's `user: "1001:1001"`.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
