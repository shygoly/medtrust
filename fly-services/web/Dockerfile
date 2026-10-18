# MedTrust Web (Next.js 16) — monorepo-aware standalone production image.
# Build context = repo root (flyctl deploy --config fly-services/web/fly.toml from root).
FROM node:20-bookworm AS base
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
WORKDIR /repo

FROM base AS build
# NEXT_PUBLIC_* are inlined at build time — must be passed as build args.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_CHAT_AGENT_URL
ARG NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_CHAT_AGENT_URL=$NEXT_PUBLIC_CHAT_AGENT_URL \
    NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# Workspace manifests required for pnpm workspace resolution.
COPY packages/demo-scenario ./packages/demo-scenario
COPY packages/chat-cards ./packages/chat-cards
COPY packages/mdop/package.json ./packages/mdop/
COPY apps/web ./apps/web
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter web... build

FROM base AS run
ENV NODE_ENV=production PORT=5020 HOSTNAME=0.0.0.0
# Next standalone output (outputFileTracingRoot = repo root).
COPY --from=build /repo/apps/web/.next/standalone /repo
COPY --from=build /repo/apps/web/.next/static /repo/apps/web/.next/static
COPY --from=build /repo/apps/web/public /repo/apps/web/public
EXPOSE 5020
CMD ["node", "/repo/apps/web/server.js"]
