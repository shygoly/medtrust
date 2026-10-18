# RWD 单臂药物注册场景 E2E 演示

模拟真实用户用 AI Chat Agent 配置并提交「RWD 单臂试验外部对照」任务的完整流程，
并在关键步骤自动截图（17 张）便于回顾。

## 📋 场景描述

**业务场景**：某制药公司想用真实世界数据（RWD）作外部对照组，与单臂临床试验的试验组比较，
用于药物注册申请。

**完整流程**：

1. ✅ 登录系统（账号 + 密码 + 图形验证码）
2. ✅ 进入 AI 助手页
3. ✅ 用自然语言提问「我想做一个单臂试验的外部对照分析，用于药物注册申请」
4. ✅ Agent 识别场景并返回配置表单 Card
5. ✅ 填写试验方 / 对照方 / 分层键 / 卡尺天数 / 匹配比例
6. ✅ 提交任务，拿到作业号
7. ✅ 查看任务状态卡片
8. ✅ 继续追问（同一会话上下文仍在）
9. ✅（另一条用例）试验方 = 对照方时被跨字段校验拦住，并拿到**预填回卡**

## 🎯 三条链路：两真一桩

| 链路 | 真实度 |
|------|--------|
| 浏览器 → apps/web（:5020） | 真：生产构建 `next start` |
| 浏览器 → apps/chat-agent（:5032） | 真：rule-based 模式，**不需要 ANTHROPIC_API_KEY** |
| chat-agent → 控制面 API（:5099） | 桩：`test/stub-control-plane.mjs` |
| 浏览器 → 登录接口（:5021） | 桩：在**浏览器侧**用 `page.route` 挡掉（见下） |

**为什么不真起 apps/api**：本演示要验的是「浏览器 → web → chat-agent → 控制面」这条业务链。
登录态在客户端就是 localStorage（`medtrust_token` + `medtrust_user`），AuthGate 再拿 token 调
`/auth/profile`；把这几个端点挡在浏览器侧，**登录页面仍走完整真实流程**
（填表 → 校验 → `saveSession` → `router.push('/space')`），却不必拉起控制面与本机数据库。

## 🚀 快速开始

```bash
# 一条命令：Playwright 自动拉起 web(:5020) + chat-agent(:5032) + 控制面桩(:5099)，并打开浏览器窗口
cd apps/chat-agent
./scripts/demo-rwd-single-arm.sh
```

等价的手动写法：

```bash
cd apps/chat-agent
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts --headed
```

无头 / 只跑主流程 / 调试：

```bash
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts                 # 无头
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts --grep "完整演示"
npx playwright test test/e2e/scenarios/rwd-single-arm-demo.spec.ts --debug
```

> 想打**真实**的 apps/api：先起 api（:5021），并删掉 spec 里的 `stubControlPlane(page)`。

## 📸 截图说明（`test-results/`）

| 截图 | 说明 |
|------|------|
| `01-login-page.png` | 登录页面（账号 / 验证码 / 密码 / MFA） |
| `02-login-filled.png` | 已填写登录信息 |
| `03-dashboard.png` | 登录成功后的控制台 |
| `04-chat-page.png` | AI 助手页面 |
| `05-user-message-typed.png` | 用户输入的问题 |
| `06-agent-response.png` | Agent 识别场景并响应 |
| `07-form-card.png` | 外部对照配置表单 Card |
| `08-trial-filled.png` | 已填写试验方信息 |
| `09-controls-filled.png` | 已填写对照方信息 |
| `10-strata-keys-filled.png` | 已填写分层键 |
| `11-all-params-filled.png` | 所有参数填写完成 |
| `12-ready-to-submit.png` | 准备提交 |
| `13-task-submitted.png` | 任务提交成功（含作业号） |
| `14-task-status.png` | 任务状态卡片 |
| `15-task-status-query.png` | 继续追问 |
| `16-final-complete.png` | 演示完成 |
| `error-validation.png` | 跨字段校验失败 + 预填回卡 |

## 🧪 测试数据

| 项 | 值 | 来源 |
|----|----|------|
| 登录账号 | `pv@demo-pharma.example` / `demo123456` | 与 `login/page.tsx` 的 DEMO_ACCOUNTS 同源；**药企（使用方）发起研究，医院不发起业务需求** |
| 试验方 / 数据产品 | `p-sponsor` / `dp-trial` | **控制面桩的目录**（必须存在，否则下拉里没有这个选项） |
| 对照方 / 数据产品 | `p-hosp-a` / `dp-controls` | 同上 |
| 分层键 | `<40\|M, 40-60\|M, >60\|M, <40\|F, 40-60\|F, >60\|F` | 卡片文本框（逗号分隔） |
| 卡尺天数 / 匹配比例 | `30` / `2` | 卡片数值字段 |
| 最小单元格 | `5` | 治理默认值（服务端补齐，卡片上不可改） |

环境变量可覆盖：`BASE_URL` / `CHAT_AGENT_URL` / `TEST_USER_ACCOUNT` / `TEST_USER_PASSWORD`。

## 🔍 验证点（判据都是 DOM 钩子，不是文案）

1. **登录成功**：控制台侧栏出现「退出登录」（AuthGate 已通过 `/auth/profile`）
2. **Chat 页加载**：`[data-testid="chat-input"]` 可见
3. **Agent 响应**：`[data-role="assistant"]` 出现
4. **表单卡片**：`[data-card-type="form"]` 且标题含「外部对照」
5. **任务提交**：`[data-card-type="status"][data-job-id]` 出现并取到作业号，`data-tone="success"`
6. **错误场景**：`[data-tone="error"]` 卡片含「不能是同一参与方」，且回卡已预填原值

## 🐛 故障排查（都是本轮实际踩到的）

| 现象 | 根因 | 处置 |
|------|------|------|
| 等 `input[name="email"]` 超时 | 登录页是**账号**（`#account`）+ 密码 + **图形验证码**（`#captcha`），没有 email/password 字段 | 改用 `#account` / `#password` / `#captcha`，并给验证码端点打桩 |
| 进不去聊天页 | 真实路由是 `/space/chat`（`nav.manifest.json`），不是 `/console/chat` | 改路由 |
| `[name="trial.participantId"]` 找不到 | 卡片字段名是**扁平**的：`trial` / `trialDataProduct` / `controls` / `controlsDataProduct` / `strataKeys` | 用真实 name |
| 下拉里没有 `p-sponsor-a` | 取值必须来自**目录**；桩提供的是 `p-sponsor` / `p-hosp-a` | 用目录里的 id（或改桩） |
| 拿不到作业号 | 状态卡没有稳定钩子，只能从散文里抠 `job-\d+`（桩回的是 `job-e2e-1`，正则不匹配） | 给 StatusCard 加 `data-job-id`（本轮加的**产品侧**钩子） |
| 校验失败时没有「预填回卡」 | **真 bug**：submit 工具在校验失败分支只回 `data.scenario`、没回 `values`，上层拼不出回卡（只有 API 失败那条路径有） | 已修 `mdop.tools.ts`，并在工具层与客户端层各补一条回归用例 |
| `13-task-submitted.png` 只拍到表单 | 控制台是**固定高度的内部滚动容器**，`fullPage: true` 也拍不到折叠线以下 | 截图前 `scrollIntoViewIfNeeded()` |
| 脚本报 `Chat Agent (localhost:4000) 未运行` | 端口写错（真实是 5032），而且服务本就由 Playwright 自动拉起 | 脚本改为提示性检查，不再硬失败 |

## 📊 性能基准

本地（Apple Silicon）实测：2 条用例合计约 **8 秒**（不含首次构建）；截图 17 张；
作业号形如 `job-e2e-1`（桩返回）。

## 📚 相关文档

- [Playwright 官方文档](https://playwright.dev/)
- [Chat Agent 开发指南](../../docs/DEVELOPER-GUIDE.md)
- [OpenSpec: AI Chat Agent](../../../../openspec/changes/ai-chat-agent/)

---

**维护者**: MedTrust AI Chat Team
**最后更新**: 2026-10-16（修正端口/路由/选择器/测试数据；修掉校验失败不回 values 的缺陷）
