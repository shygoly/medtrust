# MedTrust Web (Next.js 16) — monorepo-aware standalone production image.
# Build context = repo root (flyctl deploy --config fly-services/web/fly.toml from root).
FROM node:20-bookworm AS base
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
WORKDIR /repo

FROM base AS build
# NEXT_PUBLIC_* are inlined at build time — must be passed as build args.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# web's only workspace dep is @medtrust/demo-scenario (no native modules).
COPY packages/demo-scenario ./packages/demo-scenario
COPY apps/web ./apps/web
RUN pnpm install --no-frozen-lockfile
RUN pnpm -r --if-present build

FROM base AS run
ENV NODE_ENV=production PORT=5020 HOSTNAME=0.0.0.0
# Next standalone output (outputFileTracingRoot = repo root).
COPY --from=build /repo/apps/web/.next/standalone /repo
COPY --from=build /repo/apps/web/.next/static /repo/apps/web/.next/static
COPY --from=build /repo/apps/web/public /repo/apps/web/public
EXPOSE 5020
CMD ["node", "/repo/apps/web/server.js"]
