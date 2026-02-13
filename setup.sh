#!/bin/bash
# MedTrust 项目初始化脚本

set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║  MedTrust - 医疗可信数据空间 初始化脚本           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 检查目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在项目根目录运行此脚本"
    exit 1
fi

echo "📦 Step 1: 安装依赖..."
pnpm install

echo ""
echo "⚙️  Step 2: 配置环境变量..."
if [ ! -f ".env.local" ]; then
    cp .env.example .env.local
    echo "✅ 已创建 .env.local，请编辑配置数据库和 Stripe 密钥"
else
    echo "✅ .env.local 已存在"
fi

echo ""
echo "🗄️  Step 3: 初始化数据库..."
echo "请确保 PostgreSQL 已运行，然后执行:"
echo "  pnpm db:push"

echo ""
echo "🏗️  Step 4: 项目结构检查..."
echo "项目结构:"
tree -L 2 . 2>/dev/null || find . -maxdepth 2 -type d | head -20

echo ""
echo "✅ 初始化完成！"
echo ""
echo "下一步:"
echo "1. 编辑 .env.local 配置数据库连接"
echo "2. 运行 pnpm db:push 初始化数据库"
echo "3. 运行 pnpm dev 启动开发服务器"
echo ""
echo "📖 文档:"
echo "- 租户模型: /specs/TENANT_MODEL_SPEC.md"
echo "- 技术调研: /research/technical/"
