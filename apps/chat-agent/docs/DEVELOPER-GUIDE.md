# 开发者指南

> 架构：**Pi Agent 轻量**（prompt + tools + cards），无状态核心 + 工具循环。
> 包：`@medtrust/pi-agent`（通用运行时）、`@medtrust/chat-cards`（Card 协议 + React 渲染）、
> `apps/chat-agent`（应用：场景表 / 工具 / 卡片 / 会话 / API）。

## 1. 加一个场景（最小路径）

场景是**数据**，不是代码分支。只需在 [`src/agent/scenarios.ts`](../src/agent/scenarios.ts)
的 `SCENARIOS` 里加一条 `ScenarioDefinition`：

```ts
const demoCount: ScenarioDefinition = {
  id: 'demo-count',
  toolName: 'submit_demo_count',      // 模型看到的工具名
  title: '演示计数',
  template: 'demo.count',
  analysisKey: 'demo.count',
  endpoint: '/mdop/jobs/demo-count',  // mode: 'direct' 时必填；'template' 走 plans/preview → jobs
  mode: 'direct',
  description: '按分层键计数，只回小单元格以上的聚合。',
  keywords: ['演示', 'demo'],          // 识别用（确定性回退也吃这套）
  examples: ['帮我跑一下演示计数'],
  buildFields: (ctx) => [
    { name: 'holders', label: '数据持有方', type: 'text', required: true,
      help: ['用逗号分隔', directoryHelp(ctx, 'participants')].filter(Boolean).join('；') },
  ],
  validate: (values) => (String(values.holders ?? '').trim() ? [] : ['至少需要一个数据持有方']),
  buildSubmission: (values, ctx) => ({
    submission: {
      scenarioId: 'demo-count',
      mode: 'direct',
      endpoint: '/mdop/jobs/demo-count',
      analysisKey: 'demo.count',
      payload: {
        purpose: ctx.defaults.purpose,
        applicant: ctx.defaults.applicant,
        contracts: ctx.defaults.contracts,
        notBefore: ctx.defaults.notBefore,
        notAfter: ctx.defaults.notAfter,
        holders: String(values.holders).split(',').map((id) => ({ participantId: id.trim() })),
        minCell: ctx.defaults.minCell,
      },
    },
    warnings: [],
  }),
};
```

加完就自动获得：识别、卡片、`submit_demo_count` 工具、列表/对比里的条目、HTTP 与浏览器链路。
**不需要改** agent 核心、controller、Card 渲染器。

**可运行示例**：[`src/agent/scenarios.extension.spec.ts`](../src/agent/scenarios.extension.spec.ts)
就是这个场景的最小实现 + 断言（字段唯一、校验生效、经工具成功提交一次）。文档里的配方与它同源。

新增场景会被这些守护自动盯上：
- `scenarios.spec.ts` 的「逐场景提交」覆盖断言（漏补规范表即红）
- `scenario-matcher.spec.ts` 的识别语料覆盖断言（六个场景必须都覆盖）
- `mdop.tools.spec.ts` 的 `values` 才能提交（工具参数不接受散装字段）

## 2. 加一个工具

工具就是 `@medtrust/pi-agent` 的 `Tool`：`{ name, description, parameters, execute }`。
在 [`src/agent/tools/`](../src/agent/tools/) 里新建文件并挂到 `buildTools()`：

```ts
export function buildMyTools(): Tool[] {
  return [{
    name: 'my_lookup',
    description: '查一个只读信息（描述越具体，模型越不容易乱调）',
    parameters: { type: 'object', properties: { id: { type: 'string', description: '对象 id' } }, required: ['id'] },
    execute: async (params, context) => {
      const ctx = asChatContext(context);           // userId / spaceId / accessToken / directory / defaults
      const id = String((params as { id?: unknown }).id ?? '');
      if (!id) return { success: false, error: '缺 id' };
      return { success: true, data: { id } };
    },
  }];
}
```

约定：
- **工具自己吞错误**：返回 `{ success: false, error }`，不要抛——抛错会被 PiAgent 转成通用错误，
  用户就看不到可操作的原因了。
- 参数 schema 是**白名单**：PiAgent 会拒未声明字段（未知参数即参数校验失败）。
- 慢/外部调用要能被观察：`onToolEnd` 钩子会记 `tool_calls_total` 指标。
- **判定类工具要带卡**：若工具的结果会决定"用户下一步做什么"（如合规闸），
  除 `data` 外再回一张**现成的卡** `data.card`——卡片内容由工具按事实生成，提示词要求模型原样输出。
  这样模型没有编造 id 的空间，无 key 的确定性回退也能把流程走完（见 §6）。

## 3. 加一个 Card 字段类型 / 组件

Card 协议（[`packages/chat-cards/src/types.ts`](../../../packages/chat-cards/src/types.ts)）目前是
`text | number | select | date | checkbox`。要加多选之类的新类型，**四处一起改**：

1. `types.ts`：`FormFieldType` 与字段结构
2. `validation.ts`：`validateField` 的分支（服务端也用这一份，别只改前端）
3. `cards/FormCard.tsx` 的 `renderField` 分派 + 新字段组件
4. `test/dist-entries.test.ts` 会在构建产物层面验证入口导出（防"源码绿、产物坏"）

改完跑：`pnpm --filter @medtrust/chat-cards test`（含构建产物对拍）。

## 4. 本地开发

```bash
pnpm --filter @medtrust/chat-agent dev        # :5032（watch）
pnpm --filter @medtrust/chat-agent test       # jest：单测 + 集成 + HTTP e2e
pnpm --filter @medtrust/chat-agent test:e2e   # Playwright：真实浏览器
pnpm --filter @medtrust/chat-agent lint       # eslint（--max-warnings 0：零告警才算过）
```

Lint 约定（三个包一致：`apps/chat-agent` / `packages/chat-cards` / `packages/pi-agent`）：
- eslint 8 + `@typescript-eslint` 6 的 legacy 配置，与 `apps/api` 同代；
- **不引 prettier**——本仓没有 `.prettierrc`，接进来只会用"格式不合规"淹没真问题；
- 规则只留能抓 bug 的：`no-unused-vars`（`^` 前缀豁免）、`no-explicit-any`、
  `no-console`（日志走 `JsonLogger`）、`eqeqeq`、`prefer-const`、`no-var`；
- 测试与 `test-utils` 里 `no-explicit-any` 关闭（替身对象需要）。
- **不要跑 `pnpm -r lint` 做本包验证**：它会把 `apps/api` 的既有告警一起报出来，
  且 `apps/api` 的 lint 脚本带 `--fix` 会改写工作区文件。用上面的 `--filter` 写法。

调试小贴士：
- 想固定走确定性回退：不要设 `ANTHROPIC_API_KEY`（`/health/ready` 会报 `llm: rule-based`）。
- 想让会话跨重启保留：`CHAT_AGENT_DB=postgres` + `CHAT_AGENT_DATABASE_URL`；schema 由正式 migration 管理。
- 想知道某个请求花了多久、调了哪些工具：看 JSON 日志的 `chat_completed.fields`。

## 5. 治理红线（改代码前读一遍）

- **出域**：只有 `prompt-text`（用户原话 + 场景说明 + 目录元数据）能离开信任边界。
  见 `AGENT.md` 的 AGT-05、`FLOWS.md` 的 FLOW-AI-05、`DECISIONS.md` 的 D-AI-3。
- **日志**：不得记录用户原话、令牌、请求体（`redact()` 兜底，但别故意往里送）。
- **目录读取**：用 agent 自有凭证，**不复用调用者 token**（AGENT.md R2）。
- **校验位置**：请求边界只在 `normalizeUserMessage()`；卡片字段只在 `chat-cards/validation.ts`。
  两处都管会漂移。

## 6. 合规闸与合约申请（改这里之前读一遍）

作业提交与合约申请在同一层：`src/compliance/compliance.ts`（判定）+ `src/cards/contract-cards.ts`（出卡）。

- **提交前必过闸**：`buildSubmitTool` 先跑 `evaluatePrerequisites()`（成员身份 + 合约可用性）。
  闸的判据**逐条镜像控制面 `assertUsableForJob`**：存在 → 持有方签名 → `mdopStatus=active` →
  未过期 → 用途编码相符。改判据前先看控制面实现，两边不一致时**停下登记**（AGENT-OPS AO-2）。
- **失败策略是明确的**：明确"不属于空间"/"无可用合约" → 拦；**查不动（unknown）→ 不拦**。
  查询故障不等于无权限；把故障升级成"用户不能用"是错的，漏放也有控制面兜底。
- **申请 ≠ 生效**：`request_contract` 调的是 `POST /contracts/requests`（要 consumer 身份 + 本方预审
  `compositionId`，D-CMP-2），拿到的是 `draft`。合约要数据提供方签发（`holderSignature` +
  `mdopStatus=active`）才能用；**没有"平台自动批准"这条路径**，卡片文案与 `autoApprove` 字段都不许
  写成"立即生效"。
- **不借 agent 凭证替用户签**：合约申请用调用者 token（`asChatContext(context).accessToken`）。
- **两类合约卡**：`contract_approval`（用户点"同意并提交申请"才发申请）与
  `contract_request`（agent 替不了，只给原因 + 步骤）。新增卡类型要五处一起改：
  `types.ts` / `validation.ts` / `cards/` 组件 / `renderer.tsx` / `dist-entries.test.ts`。
- **可追溯**：判定与合约申请会进 `compliance_decisions_total` 指标与 `compliance_audit` 日志
  （`src/api/chat/compliance-audit.ts`）。字段名是工具层与 observability 之间唯一的约定，
  改一侧要同步改 `compliance-audit.spec.ts`。
