## 1. 服务/控制器

- [x] 1.1 `ConnectorAdminService`：register（issue 证书 + 注册表写入，去重）、deregister（吊销 + 移除）、list。
- [x] 1.2 `ConnectorAdminController`：`GET /connectors`、`POST /connectors/register`（operator）、`DELETE /connectors/:id`（operator）。
- [x] 1.3 `RegisterConnectorDto`：connectorId/participantId/subjectPublicKey?/capabilities?。

## 2. 模块接线

- [x] 2.1 `ParticipantIdentityModule` 接线 `CpConnectorRegistry` + controller/service。

## 3. 测试与验证

- [x] 3.1 `connector-admin.service.spec.ts`：注册/去重/注销/未知注销/自有公钥 5 用例。
- [x] 3.2 `participant-identity` 全量回归（ca/registry/secure-channel/connector-admin）通过。
- [ ] 3.3 更新差距矩阵 6.2 连接器注册/注销状态（🟡→✅）。
