#!/bin/bash

# MedTrust Lite 部署脚本
# 一键部署低成本的演示环境

set -e

echo "🚀 MedTrust Lite 部署脚本"
echo "=========================="

# 配置
REGION="hkg"
APPS=("medtrust-lite" "medtrust-lite-fate" "medtrust-lite-fisco" "medtrust-lite-mpc")

# 检查 flyctl
if ! command -v flyctl &> /dev/null; then
    echo "❌ 请先安装 flyctl"
    echo "   curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# 登录检查
echo ""
echo "🔐 检查 Fly.io 登录状态..."
if ! flyctl auth whoami &> /dev/null; then
    echo "请先登录 Fly.io:"
    flyctl auth login
fi
echo "✓ 已登录"

# 部署主应用
echo ""
echo "📦 1. 部署主应用 (API + Web)..."
cd "$(dirname "$0")"

if ! flyctl apps list | grep -q "medtrust-lite"; then
    echo "   创建新应用..."
    flyctl apps create medtrust-lite --org personal
fi

flyctl deploy \
    --app medtrust-lite \
    --config fly.template.toml \
    --region $REGION \
    --detach

echo "✓ 主应用部署完成"

# 部署 FATE 模拟服务
echo ""
echo "📦 2. 部署 FATE Flow 轻量版..."

if ! flyctl apps list | grep -q "medtrust-lite-fate"; then
    flyctl apps create medtrust-lite-fate --org personal
fi

flyctl deploy \
    --app medtrust-lite-fate \
    --config fate-mock.toml \
    --region $REGION \
    --detach

echo "✓ FATE 服务部署完成"

# 部署 FISCO BCOS 单节点
echo ""
echo "📦 3. 部署 FISCO BCOS (单节点)..."

if ! flyctl apps list | grep -q "medtrust-lite-fisco"; then
    flyctl apps create medtrust-lite-fisco --org personal
fi

flyctl deploy \
    --app medtrust-lite-fisco \
    --config fisco-single.toml \
    --region $REGION \
    --detach

echo "✓ FISCO BCOS 部署完成"

# 部署 MPC 轻量版
echo ""
echo "📦 4. 部署 MPC 轻量版..."

if ! flyctl apps list | grep -q "medtrust-lite-mpc"; then
    flyctl apps create medtrust-lite-mpc --org personal
fi

flyctl deploy \
    --app medtrust-lite-mpc \
    --config mpc-lite.toml \
    --region $REGION \
    --detach

echo "✓ MPC 服务部署完成"

# 显示部署结果
echo ""
echo "🎉 部署完成！"
echo "=========================="
echo ""
echo "服务地址:"
echo "  • 主应用:    https://medtrust-lite.fly.dev"
echo "  • FATE:      https://medtrust-lite-fate.fly.dev"
echo "  • FISCO:     http://medtrust-lite-fisco.fly.dev:8545"
echo "  • MPC:       https://medtrust-lite-mpc.fly.dev"
echo ""
echo "查看状态:"
echo "  flyctl status --app medtrust-lite"
echo ""
echo "查看日志:"
echo "  flyctl logs --app medtrust-lite"
echo ""
