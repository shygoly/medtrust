# @medtrust/chat-agent

MedTrust 可信空间的**对话式任务配置**服务：用自然语言 → Card Message → MDOP 作业，
替代为每个计算场景单独开发 UI 表单（OpenSpec change `ai-chat-agent`）。

## 端口

**5032**（5020–5031 已被 DEPLOY.md §1 分配完；proposal 里写的 4000 不采用）。
前端 `apps/web` = 5020（`/console/chat`），控制面 API = 5021。

## 架构（Pi Agent 轻量）

```
apps/web (/console/chat)  ──POST /api/v1/chat──▶  apps/chat-agent
                                                   ├── PiAgent（@medtrust/pi-agent）
                                                   ├── ToolRegistry（MDOP / 空间 / 模板）
                                                   ├── ScenarioRegistry（场景即数据）
                                                   └── SessionRepository（会话即状态）
                                                          │
                                                          ▼
                                             控制面 API  /api/v1/mdop/*
```

- **无状态核心**：`PiAgent` 不持有会话，历史由 `SessionRepository` 管；核心库无 MedTrust 词汇。
- **工具驱动**：不写 FSM；用户随时可以「等等，我想改一下对照方」。
- **Card 即协议**：模型在文本里输出 ```card 围栏块，服务端用
  `@medtrust/chat-cards` 的结构校验拦一道再下发；前端回灌 `[card:submit]` 信封。

## 两个 LLM 模式

| 模式 | 触发 | 用途 |
|------|------|------|
| `anthropic` | `ANTHROPIC_API_KEY` 非空 | 真实对话理解 |
| `rule-based` | 无 key（默认） | **确定性回退**：关键词场景识别 + 卡片生成 + 工具调用，无需外部供应商即可开发/测试/演示。治理上也更保守：问题文本不出域 |

> 出域红线（AGENT.md R4）：真实模式下只有 **prompt-text**（用户自由文本 + 场景说明 +
> 目录**元数据**选择项）离开信任边界，MUST NOT 附带任何患者衍生数据或原始行。
> 见 `FLOWS.md·FLOW-AI-05` 与 `AGENT.md·AGT-05`。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat` | `{message, sessionId?, spaceId?}` → `{sessionId, message, cards, suggestions}` |
| POST | `/api/v1/chat/stream` | 同上入参，`text/event-stream` **步骤级**事件流（见下） |
| GET | `/api/v1/chat/sessions` | 当前用户会话列表 |
| GET | `/api/v1/chat/sessions/:id` | 会话明细（含消息） |
| DELETE | `/api/v1/chat/sessions/:id` | 删除会话 |
| GET | `/health` / `/health/ready` | 存活 / 就绪 |

身份：`x-user-id` / `x-space-id` 请求头（未接 JWT 前的最小实现；
接入控制面 JWT 后由 `AuthGuard` 注入，见 tasks 2.1.7）。

## 会话持久化

`SessionRepository` 是接口，两个实现在同一份契约用例下对拍（`session-repository.parity.spec.ts`）：

| `CHAT_AGENT_DB` | 实现 | 用途 |
|---|---|---|
| `memory`（默认） | `InMemorySessionRepository` | dev/test；任何 Node 版本都能起，不依赖原生模块 |
| `sqlite` | `TypeOrmSessionRepository`（独立库 `CHAT_AGENT_DB_PATH`） | 生产持久化；`better-sqlite3` 是原生模块，须仓内基线 **Node 20** |

`/health/ready` 的 `sessionStore` 如实报告当前驱动（`memory` / `sqlite`），不谎报"数据库已连"。

> 未接 Redis：它只做缓存加速，省掉一次 SQL 读，不改变正确性。

## 支持的场景

场景是一张张数据表（`src/agent/scenarios.ts`），**新增场景不改核心代码**：

| 场景 id | 模板 | 提交方式 |
|---------|------|----------|
| `external-control` | `rws.external-control` | 直提 `POST /mdop/jobs/external-control` |
| `fl-prediction` | `rws.l4.fl-prediction` | 直提 `POST /mdop/jobs/fl-prediction` |
| `cohort-count` | 队列规模 | 直提 `POST /mdop/jobs/cohort-count` |
| `load-forecast` | `power.load-forecast` | 模板两步：`plans/preview` → `jobs` |
| `demand-response` | `power.demand-response` | 模板两步 |
| `theft-detection` | `power.theft-detection` | 模板两步 |

## 治理默认值（卡片不收集，服务端补）

`purpose` / `applicant` / `contracts` / `notBefore` / `notAfter` / `minCell` 由配置补齐
（`DEFAULT_CONTRACTS` / `DEFAULT_MIN_CELL` / `DEFAULT_WINDOW_DAYS`），卡片描述里明示。
工具入参可覆盖。

## 文档

| 文档 | 面向 | 内容 |
|------|------|------|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | 使用方 | 怎么用、支持的场景、FAQ（含"数据会不会出域"） |
| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | 开发 | 加场景 / 加工具 / 加字段类型；治理红线；本地调试 |
| [docs/API.md](docs/API.md) | 集成方 | REST 与 SSE 端点 + 可复制的 curl 示例 |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 运维 | 部署、监控、告警、日志字段、排障表、容量与已知限制 |
| `/api/docs` · `/api/docs-json` | 集成方 | **由代码生成**的 OpenAPI（与实现同源，不是手抄） |

## 部署（4.4）

镜像与编排按仓库既定路径（Fly.io）：[Dockerfile](fly-services/chat-agent/Dockerfile) + [fly.toml](fly-services/chat-agent/fly.toml)。

```bash
# 仓库根执行（构建上下文必须是仓库根：pnpm workspace 要拷多个包的清单）
docker build -f fly-services/chat-agent/Dockerfile -t medtrust-chat-agent .
docker run --rm -p 5032:5032 medtrust-chat-agent      # 已实测：health/ready ready、/chat 出卡、/metrics 有数、日志为 JSON
flyctl deploy --config fly-services/chat-agent/fly.toml
flyctl secrets set DEEPSEEK_API_KEY=sk-... -a medtrust-chat-agent   # 不设即自动退化 rule-based（不出域）
# 非密钥项（LLM_PROVIDER / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL）在 fly-services/chat-agent/fly.toml 的 [env] 里
```

要点：
- **镜像里默认 `CHAT_AGENT_DB=memory`**：容器重建会话即丢。要持久化就设 `sqlite` 并把
  `CHAT_AGENT_DB_PATH` 指到挂载卷（fly.toml 里已给出 `[[mounts]]` 注释模板）。
- **健康检查**打 `/api/v1/health`；就绪信息（`/api/v1/health/ready`）会如实报告
  `sessionStore` 与 `llm` 模式。
- **未采用 K8s 清单**（原 tasks 4.4.2）：本仓库的部署事实是 Fly.io（`fly-services/*/fly.toml`），
  另写一套没人用的 K8s YAML 只会制造需要同步的第二份真相。

## 事件流（4.1.1）

`POST /api/v1/chat/stream` 以 SSE 推送**步骤级**事件，前端用 `fetch` + `ReadableStream`
读帧（`EventSource` 只能 GET，带不了请求体）：

```
event: start   data: {"type":"start","sessionId":"…","spaceId":"sh-med"}
event: tool    data: {"type":"tool","phase":"start","name":"submit_external_control"}
event: tool    data: {"type":"tool","phase":"end","name":"submit_external_control","ok":true,"durationMs":8}
event: card    data: {"type":"card","card":{…}}
event: done    data: {"type":"done","response":{…},"suggestions":[…]}
```

**它不是什么**：不是 token 级流式。`LLMClient.complete()` 目前一次性返回；
要 token 级得先给 LLM 客户端加流式方法（Anthropic 侧 `messages.stream()`）。
但"提交任务要等几秒"这个真实痛点，步骤级已经能给出可见进展。

两条实现约定：
- `POST /chat` 与 `POST /chat/stream` **共用同一条事件流实现**（前者消费后者），
  不存在"流式和一次性行为不一致"的可能；
- 参数校验 MUST 在写出 `text/event-stream` 之前完成 —— 头一写状态码就改不了，
  否则 400/413 会变成 200 + error 帧。有专门用例钉住这条顺序。

## 生产加固（M4）

| 能力 | 落点 | 说明 |
|------|------|------|
| 结构化日志 | `src/observability/json.logger.ts` | JSON 一行一条；`redact()` 按键名打码（令牌/口令/请求体/用户原话），超长截断、层级封顶；用户标识只落 `pseudonymize()` 假名。启动期日志用 `bufferLogs` 缓冲后统一 flush，格式前后一致 |
| 指标 | `GET /api/v1/metrics` | Prometheus 文本格式，自实现（不引 prom-client）：`chat_requests_total{outcome}`、`chat_duration_seconds` 直方图、`tool_calls_total{tool,scenario,outcome}`、`llm_tokens_total{direction}`、`chat_agent_uptime_seconds` |
| 告警规则 | `deploy/alert-rules.yml` | 错误率 > 5% / P95 > 5s / 工具失败率 > 20% / 持续被拒；规则本体入库，接入 Prometheus `rule_files` 即可 |
| 限流 | `src/common/rate-limit.guard.ts` | 用户 + IP 两个维度的滑动窗口，超限 429 + `Retry-After`；配额用尽即拒**且失败开放**（两维都配 0 即关闭） |
| 输入边界 | `src/common/input.ts` | 只收字符串、去控制字符（保留换行/制表）、长度封顶（超限 413）；**不做 HTML 转义**——转义是渲染层的事，在数据层做只会污染用户原话 |
| CORS | `main.ts` | 白名单来自 `CORS_ORIGIN`；浏览器级 E2E 已真实验证跨源 5020→5032 |
| 分布式追踪（可选） | `src/observability/tracing.ts` | 库代码只依赖 `@opentelemetry/api`（不启用时全 no-op、零开销）；`OTEL_ENABLED=true` 才懒加载 SDK。span：`chat.turn` → `tool.<name>` / `controlplane.request`，并注入 W3C `traceparent` 到控制面请求 |
| Redis（可选） | `src/store/` · `src/cache/` | 目录缓存（`CACHE_DIRECTORY_TTL_SECONDS`）+ **跨实例共享限流**（`RateLimitStore` 的 Redis 实现）。`REDIS_URL` 空即关闭；配了连不上则**拒绝启动**（不静默降级成每实例配额） |

**已知限制（不假装）**：
- **限流**：配了 `REDIS_URL` 就是**跨实例共享**的固定窗口（配额真的成立，实测两实例共享同一配额）；
  没配则是每实例的滑动窗口，多实例下等于配额 × 实例数。就绪探针会报告用的是哪种。
- **指标**是进程本地的，由各实例各自暴露、Prometheus 侧聚合。
- 性能预算只对**本地 rule-based 模式**有实测（`scripts/perf-smoke.mjs`：200 请求 / 20 并发，P95 ≈ 105ms）；
  带外部 LLM 的真实 P95 必须连供应商一起测。

## 开发

```bash
pnpm --filter @medtrust/chat-agent test        # jest：单元 + 集成 + HTTP e2e（无需浏览器）
pnpm --filter @medtrust/chat-agent dev         # :5032

# 浏览器级 E2E（Playwright）：自带三台服务（控制面桩 5099 + 本服务 5032 + web 5020）
pnpm --filter @medtrust/chat-agent test:e2e

# Lint（本包 + 两个 workspace 依赖包；--max-warnings 0，零告警才算过）
pnpm --filter @medtrust/chat-agent lint
pnpm --filter @medtrust/chat-cards lint
pnpm --filter @medtrust/pi-agent lint

# 本地压测冒烟（先起服务，并关掉限流）
RATE_LIMIT_PER_USER_PER_MIN=0 RATE_LIMIT_PER_IP_PER_MIN=0 PORT=5034 node dist/main.js &
node scripts/perf-smoke.mjs http://localhost:5034/api/v1 20 200
```

E2E 用 `@playwright/test` **精确锁在 1.63.0**：它要的 chromium 是 revision 1243，
本机 `~/Library/Caches/ms-playwright` 里已有（含 headless shell），因此 **零下载**。
升级 Playwright 前先确认所需 chromium revision 已缓存，否则会拉一百多 MB。
浏览器 ↔ 本服务这一段是真链路；只有控制面那一跳由 `test/stub-control-plane.mjs` 充当
（真控制面需要 DB/种子/合约，不适合塞进浏览器 E2E）。
