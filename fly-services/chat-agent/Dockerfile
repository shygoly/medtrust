# MedTrust Chat Agent（对话式任务配置）— monorepo-aware production image.
# Build context = repo root：
#   docker build -f fly-services/chat-agent/Dockerfile -t medtrust-chat-agent .
FROM node:20-bookworm AS base
# 国内镜像：corepack 拉 pnpm、npm registry 走 npmmirror（与 fly-services/api/Dockerfile 同口径）
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo

FROM base AS build
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
# 依赖层：只拷清单 → 结果可缓存。本应用依赖两个 workspace 包，漏拷会报 WORKSPACE_PKG_NOT_FOUND。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/pi-agent/package.json ./packages/pi-agent/
COPY packages/chat-cards/package.json ./packages/chat-cards/
# 根清单把 @medtrust/mdop 列为 devDependency：即使本应用不用它，清单不拷也会
# ERR_PNPM_WORKSPACE_PKG_NOT_FOUND（pnpm 解析的是整个 workspace，不是单个包）。
COPY packages/mdop/package.json ./packages/mdop/
COPY apps/chat-agent/package.json ./apps/chat-agent/
# PostgreSQL 会话驱动不需要原生 SQLite 模块。
# 跳过依赖安装脚本，避免生产镜像构建被无关的 apt/编译工具链绑住。
RUN pnpm install --ignore-scripts --no-frozen-lockfile
# 源码层 + 构建：`...` 后缀 = 本包 + 其 workspace 依赖，按拓扑序先建 pi-agent / chat-cards。
COPY packages/pi-agent ./packages/pi-agent
COPY packages/chat-cards ./packages/chat-cards
COPY packages/mdop ./packages/mdop
COPY apps/chat-agent ./apps/chat-agent
RUN pnpm --filter @medtrust/chat-agent... build

FROM base AS run
COPY --from=build /repo /repo
WORKDIR /repo/apps/chat-agent
# 生产：JSON 结构化日志；持久会话用 CHAT_AGENT_DB=postgres。
ENV NODE_ENV=production PORT=5032 LOG_FORMAT=json
EXPOSE 5032
CMD ["node", "dist/main.js"]
