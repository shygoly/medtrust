## 1. 适配器去 mock

- [x] 1.1 `chain.adapter.ts` `verifyAttestation`：真实调用 sidecar `/attestation/:hash`，删除恒 true 分支与硬编码 signer。
- [x] 1.2 `chain.adapter.ts` `queryAttestationHistory`：真实调用 sidecar `/attestations`，按 signer/block 过滤。
- [x] 1.3 `AttestationData.signer_address` 改可选；`blockchain.service.ts` 删除硬编码 `0x0000...`。

## 2. sidecar 查询端点

- [x] 2.1 `Sidecar.java` 新增 `GET /attestation/:hash`（queryContract getAttestationByHash + ABI 解码）。
- [x] 2.2 `Sidecar.java` 新增 `GET /attestations`（getAttestationCount + getAttestationById 枚举）。

## 3. 测试与验证

- [x] 3.1 新增 `chain.adapter.spec.ts`：valid/非锚定/链不可达 fail-closed/history 过滤/history 异常 5 用例。
- [x] 3.2 `blockchain.service.spec.ts` 回归通过。
- [ ] 3.3 部署后对拍：sidecar `/attestation/:hash` 对已锚定哈希返回 exists:true + 真实 timestamp/attester。
- [ ] 3.4 更新差距矩阵 6.10 日志查验状态（🔴→✅）。
