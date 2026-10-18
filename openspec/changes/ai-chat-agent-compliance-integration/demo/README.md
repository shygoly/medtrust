# 演示产物（Phase 6.3 / 6.4）

这里的截图与录屏都是**真跑出来的**（浏览器级 e2e 产出，不是手绘/合成），可复跑：

```bash
cd apps/chat-agent
# 截图（用例内固定写这几张）
npx playwright test test/e2e/scenarios/contract-compliance-flow.spec.ts
# 录屏（默认关；打开后每条用例产 test-results/<case>/video.webm）
RECORD_VIDEO=1 SLOWMO=150 npx playwright test test/e2e/scenarios/contract-compliance-flow.spec.ts
```

三条链路里两段是真的：浏览器 → `apps/web`（生产构建）、浏览器 → `apps/chat-agent`；
只有控制面那一跳是桩（`test/stub-control-plane.mjs`），桩扮演**连接器**的签名动作。

## screenshots

| 文件 | 画面 | 说明 |
|---|---|---|
| `compliance-01-blocked-approval-card.png` | 提交被合规闸拦下 + 合约审批卡 | 正文带控制面原错误码（`E_CONTRACT_MISSING`） |
| `compliance-02-pending-offered.png` | "合约申请已提交"（自动推进、待签发） | 连接器策略为人工复核时的形态 |
| `compliance-04-hospital-signed.png` | 医院侧 `/space/contracts` 签发后的行状态 | 真实的"人点签发"路径（另一浏览器会话） |
| `compliance-05-auto-ready.png` | "合约已自动生效" | Phase 3：预授权 + 院内自动签，全程无医院点击 |
| `compliance-06-acl-denied.png` | 产品级 ACL 未授权被拦 | 出"找数据提供方开权限"的引导卡，不误报成合约问题 |
| `compliance-07-permission-denied.png` | 不属于该空间被拦 | 权限拒绝流程（Phase 6.2 的第三个场景） |

## demo（录屏）

| 文件 | 内容 |
|---|---|
| `manual-issue-and-resubmit.webm` | 无合约 → 申请 → **医院登录并点签发** → 回到使用方重新配置 → 提交成功 |
| `phase3-auto-create.webm` | 无合约 + 预授权 + 院内自动签 → 用户确认后**合约自动生效** → 直接提交成功 |

录屏为 Playwright 原始产物（webm，约 0.5MB/条），未做剪辑配音。

## RWD 单臂（药企发起）

| 文件 | 画面 |
|---|---|
| `rwd-01-pharma-login.png` | **药企账号**登录（`pv@demo-pharma.example`）——发起人应是使用方，不是医院 |
| `rwd-02-form-card.png` | AI 助手出的「单臂试验外部对照」配置卡 |
| `rwd-03-task-status.png` | 提交后的任务状态卡（作业号） |

复跑：`cd apps/chat-agent && pnpm test:e2e -- test/e2e/scenarios/rwd-single-arm-demo.spec.ts`
（该用例的截图由 spec 自己写到 `test-results/01…16-*.png`）
