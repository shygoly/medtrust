# 接口文档

> 机器可读的 OpenAPI：服务启动后 `GET /api/docs-json`；
> 交互式 UI：`GET /api/docs`（`SWAGGER_ENABLED=false` 时两者都不挂）。
> 本文的示例都在本机实测过。

## 身份

当前是**开发期最小实现**：`x-user-id` / `x-space-id` 请求头（缺省 `demo-user` / `sh-med`），
`authorization` 用于提交作业时透传给控制面。接入控制面 JWT 后改由 AuthGuard 注入，请求体不变。

## POST /api/v1/chat

一次性返回。

```bash
curl -s -X POST http://localhost:5032/api/v1/chat \
  -H 'content-type: application/json' -H 'x-user-id: u-1' \
  -d '{"message":"我想做单臂试验的外部对照"}'
```

返回 `{sessionId, message, cards, suggestions, usage?}`；`cards` 里的表单直接渲染即可，
提交时把值包成信封回灌（见下）。

| 状态 | 何时 |
|---|---|
| 400 | `message` 非字符串或去控制字符后为空 |
| 413 | 超过 `CHAT_MAX_MESSAGE_CHARS`（默认 4000） |
| 429 | 触发限流，响应头带 `Retry-After` |

## POST /api/v1/chat/stream

**步骤级** SSE（不是 token 级）。事件：`start` / `tool` / `card` / `done` / `error`。

```bash
curl -sN -X POST http://localhost:5032/api/v1/chat/stream \
  -H 'content-type: application/json' -H 'x-user-id: u-1' \
  -d '{"message":"我想做单臂试验的外部对照"}'
```

```
event: start
data: {"type":"start","sessionId":"7f8e991d…","spaceId":"sh-med"}

event: tool
data: {"type":"tool","phase":"start","name":"submit_external_control"}

event: card
data: {"type":"card","card":{"type":"status","title":"任务已提交：单臂试验外部对照","tone":"success","data":{"jobId":"job-e2e-1"}}}

event: done
data: {"type":"done","response":{…},"suggestions":["去任务列表查看执行状态"]}
```

**参数错误在写响应头之前返回 4xx JSON**（不是 200 + error 帧）——SSE 头一写状态码就改不了。
`: ping` 是 15s 一次的心跳注释行。

## 卡片提交信封

前端提交卡片时，把值包成一条普通用户消息（同一个 `/chat` 或 `/chat/stream` 端点）：

```
[card:submit] {"kind":"card-submit","cardType":"form","title":"外部对照配置","scenario":"external-control","values":{...}}
```

`@medtrust/chat-cards` 提供 `encodeCardSubmission()` / `parseCardSubmission()`，
前后端共用同一份编解码（不要自己拼字符串）。

## 会话

```bash
curl -s http://localhost:5032/api/v1/chat/sessions -H 'x-user-id: u-1'          # 列表（不含消息体）
curl -s http://localhost:5032/api/v1/chat/sessions/<id> -H 'x-user-id: u-1'     # 详情
curl -s -X DELETE http://localhost:5032/api/v1/chat/sessions/<id> -H 'x-user-id: u-1'
```

会话按用户隔离：别人的会话返回 403，不存在或过期返回 404，删除幂等。

## 运维端点

```bash
curl -s http://localhost:5032/api/v1/health         # 存活
curl -s http://localhost:5032/api/v1/health/ready   # 就绪（含 sessionStore / llm 模式）
curl -s http://localhost:5032/api/v1/metrics        # Prometheus 文本
```
