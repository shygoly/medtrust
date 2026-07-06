# MedTrust API (NestJS control plane) — monorepo-aware production image.
# Build context = repo root (flyctl deploy --config fly-services/api/fly.toml from root).
FROM node:20-bookworm AS base
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
WORKDIR /repo

FROM base AS build
# better-sqlite3 is a native module — needs a toolchain to compile for linux.
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
# Only api + packages are present, so pnpm installs just those workspaces.
RUN pnpm install --no-frozen-lockfile
# Build every workspace that has a build script, in dependency order
# (database/demo-scenario before api; proto has no build script and is skipped).
RUN pnpm -r --if-present build

FROM base AS run
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
# NODE_ENV=development on purpose for the demo: it turns on TypeORM `synchronize`
# (so the ephemeral SQLite gets its schema + OnModuleInit seed data on boot) and
# lets optional infra like Vault degrade gracefully instead of crashing the app.
ENV NODE_ENV=development PORT=5021
EXPOSE 5021
CMD ["node", "dist/main.js"]
