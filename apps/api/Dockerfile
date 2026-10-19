# MedTrust API - Fly.io 部署
FROM node:20-alpine

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 先复制依赖相关文件
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
COPY packages/database/src ./packages/database/src
COPY packages/database/tsconfig.json ./packages/database/

# 构建
RUN pnpm --filter @medtrust/database build
RUN pnpm --filter @medtrust/api build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
