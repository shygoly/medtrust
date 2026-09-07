## Why

TC609-6-2025-16 基础级评测项 6.2「连接器注册/注销」在代码核查中判为 🟡：`CaService`/
`ParticipantRegistryService` 已实现且有单测，但**零生产调用方**（仅单测引用），无注册/注销
API 端点，实际接入是 fly.toml 静态配置 + 共享 dev token。这是整改计划（`docs/TC609-6-2025-16-整改计划.md`）
P0-4 的硬缺口——评测演示时无法现场出示注册/注销能力。

## What Changes

- 新增 `ConnectorAdminService` + `ConnectorAdminController`（`apps/api/src/runtime/participant-identity/`）：
  - `POST /connectors/register`（operator）：`CaService.issue` 签发 SM2 证书 + 写入 `CpConnectorRegistry`；
    支持连接器提交自有公钥，或控制面代生成演示密钥对。
  - `DELETE /connectors/:id`（operator）：按 connectorId 吊销证书（`CaService.revoke`）+ 移除注册表行。
  - `GET /connectors`：列出已签发证书（供 UI 查验）。
- 复用既有 `CaService`/`CpConnectorRegistry`，不新写密码学核心逻辑。
- `ParticipantIdentityModule` 接线 `CpConnectorRegistry` 实体与新的 controller/service。

## Capabilities

### New Capabilities
- `connector-registration`: 连接器可通过 API 注册（签发 SM2 证书 + 注册表写入）与注销（吊销 + 移除）。

### Modified Capabilities
- `participant-identity`（既有）：`CaService`/`CpConnectorRegistry` 从"零生产调用方"升为有 API 接线。

## Impact

- **Code:** `apps/api/src/runtime/participant-identity/{connector-admin.service,connector-admin.controller,dto/register-connector.dto}`（新增）、
  `participant-identity.module.ts`（接线）。
- **APIs:** 新增 `GET/POST/DELETE /connectors`（JWT + operator 门控）。
- **Risk:** 低。纯增量；不改变既有连接器接入鉴权（P1-4 再升级 pull 为证书鉴权）。
