# MedTrust API (NestJS control plane) — monorepo-aware production image.
# Build context = repo root (flyctl deploy --config fly-services/api/fly.toml from root).
FROM node:20-bookworm AS base
# 国内镜像:corepack 拉 pnpm、npm registry 走 npmmirror(避免被墙/超时)。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate
WORKDIR /repo

FROM base AS build
# better-sqlite3 是原生模块:优先从国内镜像下预编译二进制(prebuild-install),
# 不从源码编译(源码编 sqlite3.c 在慢/受限网络上要几十分钟)。工具链仅作兜底。
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
    npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3 \
    npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
# 依赖层:只拷各 workspace 的清单 → pnpm install 结果(含 better-sqlite3 预编译二进制)
# 可被缓存,仅业务源码改动时不再重装/重下,彻底避免重复编译。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/demo-scenario/package.json ./packages/demo-scenario/
COPY packages/proto/package.json ./packages/proto/
# mdop-kernel：控制面新增的协议核心依赖（apps/api 依赖 @medtrust/mdop）；
# wasm-algorithms 是算法模块注册表用的（同层漏拷会在 pnpm install 报 WORKSPACE_PKG_NOT_FOUND）。
COPY packages/mdop/package.json ./packages/mdop/
COPY packages/wasm-algorithms/package.json ./packages/wasm-algorithms/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --no-frozen-lockfile
# 源码层 + 构建(database/demo-scenario 先于 api;proto 无 build 脚本被跳过)。
COPY packages ./packages
COPY apps/api ./apps/api
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
