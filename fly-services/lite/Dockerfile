# MedTrust Lite - API 服务
FROM node:20-alpine

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制 package 文件
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/database/package.json packages/database/

# 安装生产依赖
RUN pnpm install --production --frozen-lockfile

# 复制源代码
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/
COPY packages/database/src packages/database/src
COPY packages/database/tsconfig.json packages/database/

# 构建数据库包
WORKDIR /app/packages/database
RUN pnpm exec tsc

# 构建 API
WORKDIR /app/apps/api
RUN pnpm exec tsc

# 创建数据目录
RUN mkdir -p /data

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/medtrust.db

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
