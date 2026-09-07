## Why

TC609-6-2025-16 基础级评测项 6.10「日志查验」在代码核查中判为 🔴 mock：`ChainAdapter.verifyAttestation`
恒返回 `valid: true`（硬编码 signer `0xabcdef1234567890` + `Date.now()` 时间戳），`queryAttestationHistory`
恒返回 `[]`，链上验真不可用。这是整改计划（`docs/TC609-6-2025-16-整改计划.md`）P0-3 的硬缺口——存证/查验
恰是可信数据空间评测的核心审查面。

## What Changes

- ChainMaker sidecar（`fly-services/chain-sdk/.../Sidecar.java`）新增 `GET /attestation/:hash`（读合约
  `getAttestationByHash` view，解码 attester/timestamp/exists）与 `GET /attestations`（count + byId 枚举）。
- `ChainAdapter.verifyAttestation` 改为真实调用 sidecar 查询端点：已锚定 → `valid:true` + 真实链上字段；
  未锚定/篡改/链不可达 → `valid:false`（fail-closed）。删除恒 true 分支与硬编码 signer。
- `ChainAdapter.queryAttestationHistory` 改为真实调用 sidecar `/attestations`，按 signer/block 过滤。
- `BlockchainService.submitToBlockchain` 删除硬编码 `signer_address`（由链侧 tx `msg.sender` 决定）。

## Capabilities

### Modified Capabilities
- `blockchain-attestation`（既有）：链上查验从 mock 升级为真实读链；`POST /blockchain/verify` 对已锚定哈希
  返回 valid + 真实链上字段，对未锚定/篡改哈希返回 invalid。

## Impact

- **Code:** `apps/api/src/blockchain/adapters/chain.adapter.ts`、`apps/api/src/blockchain/blockchain.service.ts`、
  `fly-services/chain-sdk/src/main/java/medtrust/Sidecar.java`。
- **Deploy:** sidecar 需重新构建（`flyctl deploy` 远程 Maven 构建）后方可暴露查询端点；API 无需 schema 变更。
- **APIs:** `POST /blockchain/verify` 行为从"恒 valid"变为"真实查验"；负向用例（未锚定/篡改）进测试。
- **Risk:** 中。若 sidecar 未重建，查验端点 404 → 适配器 fail-closed 返回 invalid（不会假阳性）。ABI 解码
  需在部署后对拍真实链返回。
