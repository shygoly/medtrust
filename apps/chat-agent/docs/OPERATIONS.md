# 运维指南

## 部署

按仓库既定路径（Fly.io）：

```bash
# 仓库根执行
docker build -f fly-services/chat-agent/Dockerfile -t medtrust-chat-agent .
docker run --rm -p 5032:5032 medtrust-chat-agent

flyctl deploy --config fly-services/chat-agent/fly.toml
flyctl secrets set ANTHROPIC_API_KEY=... -a medtrust-chat-agent   # 不设即自动退化 rule-based
```

- **会话持久化**：镜像默认 `CHAT_AGENT_DB=memory`，容器重建即丢。要保留就先建卷、
  把 `CHAT_AGENT_DB` 设成 `sqlite` 并把 `CHAT_AGENT_DB_PATH` 指到挂载点（`fly.toml` 里有模板）。
  ⚠️ sqlite 驱动是原生模块 `better-sqlite3`，与 Node ABI 绑定：**仓内基线是 Node 20**。
- **端口`5032`**：登记在 `DEPLOY.md` §1；`PORT` 是唯一事实源（`main.ts` 不再写第二份缺省）。

## 监控

| 看什么 | 在哪 |
|---|---|
| 请求数 / 结果 | `chat_requests_total{outcome="success\|error\|rejected"}` |
| 端到端耗时（P95 由 Prometheus 算） | `chat_duration_seconds` 直方图 |
| 工具调用（按工具/场景/成败） | `tool_calls_total{tool,scenario,outcome}` |
| LLM token | `llm_tokens_total{direction}` |
| 进程存活 | `chat_agent_uptime_seconds` |

### 追踪（可选）

```bash
# 本地肉眼验证（span 打到 stdout）
OTEL_ENABLED=true OTEL_EXPORTER=console pnpm --filter @medtrust/chat-agent dev

# 生产：指向 collector
OTEL_ENABLED=true OTEL_EXPORTER=otlp OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces
```

**默认关闭**：不设 `OTEL_ENABLED=true` 时只加载 `@opentelemetry/api`（全 no-op、零开销），
SDK 与导出器走动态 import。开启后 SDK 读标准的 `OTEL_TRACES_SAMPLER` /
`OTEL_TRACES_SAMPLER_ARG`（采样率交给标准变量，不在代码里造第二套开关）。

span 结构（实测一次提交）：

```
chat.turn                                { chat.space_id, chat.session_id, chat.user_ref(假名),
                                           chat.context_window, llm.mode,
                                           chat.outcome, chat.cards, chat.tools }
└── tool.submit_external_control         { tool.name, tool.ok }
    └── controlplane.request             { http.method, http.route, http.status_code }
```

**属性红线**：span 属性里**不放**用户原话、卡片取值、令牌、原始用户标识
（用户只以 10 位假名出现）。trace 后端通常比日志保留更久、权限更松，
往里复制一份用户原话等于给自己开第二条数据出口。这条有专门的治理断言把守。

告警规则：[`deploy/alert-rules.yml`](../deploy/alert-rules.yml)（错误率 > 5%、P95 > 5s、
工具失败率 > 20%、持续被拒）。把它挂进 Prometheus 的 `rule_files` 即可，仓库里不假装已接入。

### 日志

JSON 一行一条（`LOG_FORMAT=json`，缺省）。关键事件 `chat_completed`：

```json
{"time":"…","level":"info","context":"ChatService","fields":{"event":"chat_completed",
 "sessionId":"…","spaceId":"sh-med","userRef":"5d8067bf4c","durationMs":45,
 "contextWindow":20,"cards":1,"tools":0}}
```

- `userRef` 是用户标识的**假名**（sha256 前 10 位，不可逆但可跨行关联）。
- 令牌 / 口令 / 请求体 / 用户原话**永远不落日志**；`redact()` 按键名兜底，超长截断。
- 采集侧只需解析 JSON，不必为启动期单独写规则（启动日志经 `bufferLogs` 统一 flush）。

## 排障

| 现象 | 先看 | 常见原因 |
|---|---|---|
| 助手答「暂时不可用」 | 日志 `chat_completed` 有无 `outcome=error`；`chat_requests_total{outcome="error"}` | LLM 供应商不可达；带了 key 但额度/网络有问题 |
| 卡片下拉是空的（降级成文本） | `/health/ready` 的 `apiUrl`；日志里「目录加载失败」 | 控制面 API 不可达 → 目录为空；这是**降级**不是故障 |
| 提交返回 409 `[E_CHANNEL_UNKNOWN]` | 桩/控制面的 `analysisKey` 是否登记 | 模板未在编排台账登记（或模板名写错） |
| 大量 429 | `Retry-After`；`RATE_LIMIT_*` 配置；`/health/ready` 的 `rateLimitStore` | 配额偏小，或被同一 IP 的其它调用方挤占；`memory` 表示没共享（多实例 = 配额 × 实例数） |
| 413 | `CHAT_MAX_MESSAGE_CHARS` | 用户粘贴了超长文本（如整篇病历）——这正是要拦的 |
| 会话重启后没了 | `/health/ready` 的 `sessionStore` | 驱动是 `memory`；改 `sqlite` + 卷 |
| 启动即退出（退出码 1） | 日志里的 Redis 连接错误 | 配了 `REDIS_URL` 但连不上：这是**故意的** fail-closed，修地址或临时清空该变量 |
| 多实例下配额不对 | `/health/ready` 的 `rateLimitStore` | 显示 `memory` 说明没共享：检查是否所有实例都配了 `REDIS_URL` |
| 目录更新不生效（要等 5 分钟） | `directoryCacheTtlSeconds` | 缓存 TTL 内的旧目录属预期；调小 TTL 或加失效调用来规避 |
| 看不到 trace | 启动日志有无 `tracing enabled` | `OTEL_ENABLED` 没开，或 exporter 指向的 collector 不可达（OTLP 导出失败只在 SDK 内部记） |
| trace 少了子 span | span 的 `parentId` | 检查 provider 是否为 `NodeTracerProvider`（`BasicTracerProvider` 不注册上下文管理器 → 子 span 与 traceparent 注入会静默失效） |
| sqlite 启动失败 | 日志 dlopen / NODE_MODULE_VERSION | Node 版本与 `better-sqlite3` 编译 ABI 不一致；用 Node 20 或重装依赖 |

## 容量与已知限制

- 本地 rule-based 实测（200 请求 / 20 并发）：P95 ≈ 105ms、542 req/s、0 错误。
  **带外部 LLM 的延迟未测**，真实 P95 必须连供应商一起测。
- **限流**：`REDIS_URL` 配好 → 配额跨实例共享（实测两实例同配额）；没配 → 每实例独立，
  多实例下实际配额 = 配置值 × 实例数。就绪探针的 `rateLimitStore` 字段告诉你当前是哪种。
- **指标**始终是进程本地：各实例各自暴露，由 Prometheus 侧聚合。
- **目录缓存**同样依赖 Redis：配好了多实例共享（实测第二实例零控制面请求），没配则每次对话都打控制面。
