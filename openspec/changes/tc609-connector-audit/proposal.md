## Why

TC609-6-2025-16 评测项 6.10「日志存证/上报」与 8.3「日志记录安全」判定：连接器审计日志为
**内存数组**（`apps/connector/src/domain/audit.ts`），`LocalAuditLog` 实体是死代码，且连接器
审计/证据日志**无上报通道**。整改计划（`docs/TC609-6-2025-16-整改计划.md`）P0-6。

## What Changes

- `local_audit_log` 增加 `entryHash`/`prevHash`（SM3 链式哈希）。
- `AuditService` 改为可选注入 `LocalAuditLog` 仓库：`record()` 保持同步（调用方 fire-and-forget），
  内部计算链式 SM3 哈希并异步落本地表；`onModuleInit` 载入既有条目 + 链尾（重启不丢）。
- `ControlPlaneClient.uploadAuditDigest` + `ConnectorWorkerService` 周期（节流 30s）把本地审计链
  摘要（含链式 prevHash + 阻断事件）上报平台。
- 平台新增 `cp_connector_audit_digest` 实体 + `ConnectorAuditService`（`record` 按链式 prevHash
  对拍 → `chainOk=ok/break`、`list`）；`ConnectorPullController` 新增 `POST /connector/audit/digest`。

## Capabilities

### New Capabilities
- `connector-audit-digest`: 连接器审计持久化（重启不丢）+ SM3 链式哈希 + 摘要上报，平台可查验链完整性。

### Modified Capabilities
- `data-space-connector`（既有）：`AuditService` 从内存态升为持久化 + 链式哈希。

## Impact

- **Code:** `packages/database/src/{connector,control-plane}/index.ts`、`apps/connector/src/domain/{audit.ts,control-plane-client.ts,connector-worker.service.ts,app.module.ts}`、
  `apps/api/src/runtime/connector-audit/*`、`apps/api/src/runtime/rws-orchestrator/{connector-pull.controller,rws-orchestrator.module}.ts`、`apps/api/src/app.module.ts`。
- **Data:** `local_audit_log` 新增两列；`cp_connector_audit_digest` 新表。
- **APIs:** 新增 `POST /connector/audit/digest`（连接器令牌鉴权）。
- **Risk:** 低。`AuditService.record()` 签名不变（同步），既有调用方零改动；持久化失败不阻断执行路径。
