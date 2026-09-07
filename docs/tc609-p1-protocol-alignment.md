# TC609-6-2025-01 平台↔连接器交互规范对拍表（P1-12）

> 目的：对照 TC609-6-2025-01 逐项自查 pull/complete/progress 消息语义，输出对拍结论。
> 状态：对拍完成，基础级字段已补齐；扩展字段按需。

| # | 交互原语 | 规范要求 | MedTrust 实现 | 字段/语义 | 结论 |
|---|---|---|---|---|---|
| 1 | 任务下发（pull） | 平台应提供待执行任务查询接口，连接器主动拉取 | `GET /connector/rws/pending`、`GET /connector/fl-prediction/pending` | 返回 assignmentId/taskId/purpose/workloadType/analysis/contract；幂等，拉取后置 running | 对齐 |
| 2 | 任务拉取确认 | 连接器拉取后状态迁移 | `pullPending` 原子置 running + startedAt + progress=pulled | 状态机 pending→running | 对齐 |
| 3 | 进度上报（progress） | 阶段事件应带 stage + detail | `POST /connector/rws/assignments/:id/progress`、FL 同构 | stage 为受控枚举（queued/pulled/data-load/pep-check/compute/output-gate/retention/complete/failed），detail 自由文本 | 对齐 |
| 4 | 结果回传（complete） | 结果应携带可校验哈希 | `POST /connector/rws/assignments/:id/complete` | aggregate + aggregateHash（SM3 稳定序列化），平台验哈希后入库 | 对齐（P1-6 补齐） |
| 5 | 失败回传 | 失败应带 error | 同上 `{ error }` | 平台置 failed + progress=failed | 对齐 |
| 6 | 连接器身份 | 请求应可鉴别连接器身份 | `x-connector-token` + `x-connector-participant`；P1-4 升级为 SM2 证书签名头 | `x-connector-cert-fingerprint` + `x-connector-timestamp` + `x-connector-signature` | 对齐（P1-4 补齐） |
| 7 | 心跳/运行监测 | 连接器周期上报状态 | `POST /connector/heartbeat` | version/taskStatus/resources 落库 `lastHeartbeat`；`GET /connectors/status` 超时（默认 60s）标 offline；web `/space/connectors` 接真实状态 | 对齐（P1-9 补齐） |
| 8 | 审计日志上报 | 连接器本地审计链摘要上报 | `POST /connector/audit/digest` | count/firstPrevHash/lastEntryHash/blocked[]；平台 chainOk 对拍 | 对齐（P0-6） |
| 9 | 合约规则知悉 | 消费方知悉确认 | `POST /contracts/:id/acknowledge` | consumerAcknowledgedAt + acknowledgedHash | 对齐（P0-7） |
| 10 | 合约解除 | 解除后下游任务应拒绝 | `POST /contracts/:id/revoke` | revokeReason 留痕；PEP fail-closed 拒绝 | 对齐（P1-3） |

## 差距与后续

- 标准若要求 `messageId` / `correlationId` 字段，当前以 `assignmentId` 关联；如对拍评审要求显式字段，增加映射即可，不影响语义。
- 标准若要求二进制/流式交付，当前 RWS 聚合结果为 JSON，L4 权重包为二进制下载（`GET /fl-prediction/tasks/:id/weight-bundle`），已覆盖。
- 标准若要求异步回执确认，当前 complete 响应为任务视图；可增加 `202 Accepted` + receiptId 扩展。
