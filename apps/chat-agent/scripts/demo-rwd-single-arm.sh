#!/bin/bash
set -e

# RWD 单臂药物注册场景演示脚本
#
# 三个服务由 playwright.config.ts 的 webServer **自动拉起**（web :5020 / chat-agent :5032 /
# 控制面桩 :5099），所以这里不做硬性前置检查：已起的会被复用，没起的会被启动。
# 登录用的控制面（:5021）在浏览器侧打桩，不需要 apps/api。

echo "🎬 RWD 单臂药物注册场景 E2E 演示"
echo "=================================="
echo ""

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ℹ️  未设置 ANTHROPIC_API_KEY：将走 rule-based 确定性回退（演示完全够用，且不出域）"
fi

echo "📋 服务状态（未运行也没关系，Playwright 会自动启动）..."
check_service() {
    local url=$1
    local name=$2
    if curl -s -f -o /dev/null "$url"; then
        echo "   ✅ $name 已在运行，将复用"
    else
        echo "   ⏳ $name 未运行，稍后由 Playwright 启动"
    fi
}
check_service "http://localhost:5020/login" "Web App (:5020)"
check_service "http://localhost:5032/api/v1/health" "Chat Agent (:5032)"
check_service "http://localhost:5099/api/v1/public/catalog?spaceId=sh-med" "控制面桩 (:5099)"

echo ""
echo "🚀 开始演示（有头模式，会打开浏览器窗口）..."
echo ""

# 环境变量（与 spec 里的 TEST_CONFIG 同名；旧名 CHAT_URL / TEST_USER_EMAIL 已不再使用）
export BASE_URL=${BASE_URL:-http://localhost:5020}
export CHAT_AGENT_URL=${CHAT_AGENT_URL:-http://localhost:5032}
export TEST_USER_ACCOUNT=${TEST_USER_ACCOUNT:-admin@demohospa-hospital.com}
export TEST_USER_PASSWORD=${TEST_USER_PASSWORD:-demo123456}

# 慢动作便于肉眼跟：`playwright test` 没有 --slowmo 参数，只能从配置读 SLOWMO（见 playwright.config.ts）
export SLOWMO=${SLOWMO:-400}
npx playwright test \
    test/e2e/scenarios/rwd-single-arm-demo.spec.ts \
    --headed \
    --workers=1 \
    "$@"

echo ""
echo "✅ 演示完成！"
echo ""
echo "📸 截图（$(pwd)/test-results/）："
ls -lh test-results/*.png 2>/dev/null | awk '{print "  - " $9 " (" $5 ")"}' || echo "  （无）"
echo ""
