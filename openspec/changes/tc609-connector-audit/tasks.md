## 1. 实体

- [x] 1.1 `local_audit_log` 加 `entryHash`/`prevHash`；`cp_connector_audit_digest` 新实体 + 注册。
- [x] 1.2 `pnpm --filter @medtrust/database build`。

## 2. 连接器侧

- [x] 2.1 `AuditService`：可选仓库 + SM3 链式哈希 + 异步持久化 + onModuleInit 载入 + digest()。
- [x] 2.2 `ControlPlaneClient.uploadAuditDigest`。
- [x] 2.3 `ConnectorWorkerService` 周期上报审计链摘要（节流 30s）。
- [x] 2.4 `app.module` 接线 `forFeature([LocalAuditLog])`。

## 3. 平台侧

- [x] 3.1 `ConnectorAuditService`（record 链式对拍 chainOk + list）+ 模块。
- [x] 3.2 `ConnectorPullController` 加 `POST /connector/audit/digest`。
- [x] 3.3 `app.module` 接线 ConnectorAuditModule；DOMAIN 覆盖矩阵 + 存证小节。

## 4. 验证

- [x] 4.1 `audit.spec.ts`（链式哈希 / 持久化 / 重启恢复）通过。
- [x] 4.2 `connector-audit.service.spec.ts`（chainOk ok/break）通过。
- [x] 4.3 `connector-worker.service.spec.ts` 回归通过。
- [ ] 4.4 更新差距矩阵 6.10 日志上报 / 日志存证 / 8.3 日志记录安全状态。
