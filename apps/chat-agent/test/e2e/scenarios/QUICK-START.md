# RWD 单臂药物注册场景 E2E 演示 - 运行指南

## 🎯 场景说明

**业务场景**：某制药公司想要使用真实世界数据（RWD）作为外部对照组，与单臂临床试验的试验组进行对比，用于药物注册申请。

**完整流程**：
1. ✅ 登录系统（pv@demo-pharma.example）
2. ✅ 导航到 AI 助手（在"研究与任务"分组下，路由：`/space/chat`）
3. ✅ 用自然语言询问："我想做一个单臂试验的外部对照分析，用于药物注册申请"
4. ✅ Agent 识别场景并返回配置表单 Card
5. ✅ 填写试验方、对照方、分层键等参数
6. ✅ 提交任务到 MDOP
7. ✅ 验证任务创建成功
8. ✅ 查询任务状态

## 📍 导航路径

从登录后的首页进入 AI 助手：

```
登录成功（/space）
  ↓
侧边栏：点击 "研究与任务" 分组（FlaskConical 图标）
  ↓
侧边栏：点击 "AI 助手" 菜单项
  ↓
进入 Chat Agent 页面（/space/chat）
```

**配置位置**：`apps/web/src/nav.manifest.json` 第 18 行：
```json
{
  "route": "/space/chat",
  "label": "AI 助手",
  "entry": "menu",
  "group": "research"
}
```

## 🚀 快速开始

### 前置条件

需要启动 3 个服务：

```bash
# 终端 1: Web 应用（端口 5020）
cd apps/web
pnpm build  # 生产构建
pnpm start  # 或 pnpm dev 用开发模式

# 终端 2: Chat Agent（端口 5032）
cd apps/chat-agent
pnpm start:dev

# 终端 3: 控制面桩（端口 5099）
cd apps/chat-agent
node test/stub-control-plane.mjs
```

**注意**：测试使用 **rule-based mock 模式**，无需配置 `ANTHROPIC_API_KEY`。

### 运行演示

```bash
cd apps/chat-agent

# 方式 1: 使用便捷脚本（带界面、慢速执行）
chmod +x scripts/demo-rwd-single-arm.sh
./scripts/demo-rwd-single-arm.sh

# 方式 2: 直接运行 Playwright
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts \
  --headed \
  --slowmo=1000 \
  --workers=1
```

## 📸 演示效果

测试会自动生成 16 张截图（保存在 `test-results/` 目录）：

| 截图 | 说明 |
|------|------|
| `01-login-page.png` | 登录页面 |
| `02-login-filled.png` | 已填写登录信息（账号+密码+验证码） |
| `03-dashboard.png` | 登录成功后的空间总览 |
| `04-navigation-sidebar.png` | 侧边栏导航（研究与任务分组） |
| `05-chat-page.png` | AI 助手页面 |
| `06-user-message.png` | 用户输入的问题 |
| `07-agent-response.png` | Agent 识别场景并响应 |
| `08-form-card.png` | 外部对照配置表单 Card |
| `09-trial-filled.png` | 已填写试验方信息 |
| `10-controls-filled.png` | 已填写对照方信息 |
| `11-strata-keys-filled.png` | 已填写分层键 |
| `12-all-params-filled.png` | 所有参数填写完成 |
| `13-ready-to-submit.png` | 准备提交 |
| `14-task-submitted.png` | 任务提交成功 |
| `15-task-status.png` | 任务状态卡片 |
| `16-final-complete.png` | 演示完成 |

## 🧪 测试数据

```typescript
// 登录用户
账号: pv@demo-pharma.example
密码: demo123456
角色: consumer（使用方 / 药企）

// 试验方（单臂试验组）
参与方: p-sponsor
数据产品: dp-trial

// 对照方（外部对照组）
参与方: p-hosp-a
数据产品: dp-controls

// 匹配参数
分层键: <40|M, 40-60|M, >60|M, <40|F, 40-60|F, >60|F
卡尺天数: 30
匹配比例: 2:1
```

## 🎬 测试架构

```
浏览器（Playwright）
  ↓ 真实 HTTP
Web App (localhost:5020)
  ↓ 真实 API 调用
Chat Agent (localhost:5032)
  ↓ Stub（桩）
控制面 API (localhost:5099 - stub-control-plane.mjs)
```

**关键点**：
- ✅ **浏览器 → Web**：真实请求
- ✅ **Web → Chat Agent**：真实 API 调用
- ✅ **Chat Agent → 控制面**：桩（stub-control-plane.mjs）
- ✅ **登录认证**：浏览器侧预置（localStorage）

## 🔍 验证点

测试会自动验证：

1. ✅ **登录成功**：检查空间总览页面加载
2. ✅ **导航正确**：通过"研究与任务"分组进入 AI 助手
3. ✅ **Chat 页面加载**：检查输入框可见
4. ✅ **Agent 响应**：检查 assistant 消息出现
5. ✅ **表单卡片**：检查表单和标题包含"外部对照"
6. ✅ **参数填写**：所有字段正确填写
7. ✅ **任务提交**：检查成功消息和任务 ID
8. ✅ **错误处理**：验证参数校验规则

## 🐛 故障排查

### 问题：Web 应用未启动

```
Error: net::ERR_CONNECTION_REFUSED at http://localhost:5020
```

**解决**：
```bash
cd apps/web
pnpm build && pnpm start
# 或开发模式: pnpm dev
```

### 问题：Chat Agent 未启动

```
Error: connect ECONNREFUSED localhost:5032
```

**解决**：
```bash
cd apps/chat-agent
pnpm start:dev
```

### 问题：控制面桩未启动

```
Error: Request failed with status code 500
或看到 chat-agent 日志中的 ECONNREFUSED :5099
```

**解决**：
```bash
cd apps/chat-agent
node test/stub-control-plane.mjs
# 应该看到: Stub control plane listening on :5099
```

### 问题：登录失败

```
Error: Selector not found: [data-testid="space-overview"]
```

**可能原因**：
1. 账号不在 DEMO_ACCOUNTS 列表
2. 登录页面结构变化

**解决**：检查 `apps/web/src/app/login/page.tsx` 中的 `DEMO_ACCOUNTS`

### 问题：找不到 AI 助手菜单

```
Error: Selector not found: nav a[href="/space/chat"]
```

**可能原因**：导航配置未加载

**解决**：检查 `apps/web/src/nav.manifest.json` 中是否有 `/space/chat` 条目

## 🎓 高级用法

### 无头模式运行（CI/CD）

```bash
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts
```

### 调试模式

```bash
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts \
  --debug
```

### 录制视频

```bash
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts \
  --video=on
```

视频保存到 `test-results/videos/`

### 只运行主流程

```bash
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts \
  --grep "完整演示"
```

### 自定义端口

```bash
export BASE_URL=http://localhost:3000
export CHAT_AGENT_URL=http://localhost:4000

npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts
```

## 📊 性能基准

在本地开发环境（MacBook Pro M1）：

| 指标 | 值 |
|------|-----|
| 总执行时间 | ~60-90 秒 |
| 登录时间 | ~2 秒 |
| Agent 首次响应 | ~3-5 秒（rule-based） |
| 任务提交 | ~2 秒 |
| 截图数量 | 16 张 |
| 视频大小 | ~5-10 MB |

## 📝 测试覆盖

- ✅ 正常流程：从登录到任务提交
- ✅ 表单填写：所有必填和可选字段
- ✅ 参数验证：试验方≠对照方
- ✅ 错误处理：验证失败提示
- ✅ 导航路径：通过"研究与任务"分组

## 🤝 相关文档

- [Chat Agent 开发指南](../../docs/DEVELOPER-GUIDE.md)
- [OpenSpec: AI Chat Agent](../../../../openspec/changes/ai-chat-agent/)
- [导航配置](../../../web/src/nav.manifest.json)
- [Playwright 文档](https://playwright.dev/)

---

**维护者**: MedTrust AI Chat Team
**最后更新**: 2024-10-16
**测试文件**: `apps/chat-agent/test/e2e/scenarios/rwd-single-arm-demo.spec.ts`
