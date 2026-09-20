## 0. 前置

- [ ] 0.1 确认 `ConnectorAuthService.verifyPayloadSignature`（已存在）可复用于验连接器**结果级**签名
- [ ] 0.2 确认合并前各院 `resultSm3` 可收集（`l0-validation-merge` / `comparative-effect-merge` 的收集点）

## 1. 连接器结果级签名

- [ ] 1.1 连接器对 `resultSm3` 做 SM2 签名（复用 `CONNECTOR_SM2_PRIVATE_KEY`）；`control-plane-client` 的 complete 载荷带 `{resultSm3, connectorSm2Sig, certFingerprint}`
- [ ] 1.2 单元测试：连接器结果签名可被平台侧 `verifyPayloadSignature` 验过

## 2. 平台：验签 + 持久化

- [ ] 2.1 complete 处理器按院验连接器结果签名（**渐进**：无签名不破、有则验）
- [ ] 2.2 DB（`cp_rws_assignment`）增列 `resultSm3` / `connectorResultSig` / `connectorCertFingerprint`
- [ ] 2.3 验签失败 → 该院贡献无效（切 fail-closed 前先记审计/告警）

## 3. 上链 payload 扩展

- [ ] 3.1 `attestation.service.anchor` 接口扩展：除合并 `resultHash` 外带 `endorsements:[{participantId, resultSm3, sig, certFingerprint}]`
- [ ] 3.2 `l0-validation-merge` / `comparative-effect-merge` 在 anchor 前收集各院背书
- [ ] 3.3 `ChainAdapter` 上链 payload 带 endorsements；链不可达降级不丢背书（背书先持久化，链恢复可补锚）

## 4. 独立核验

- [ ] 4.1 独立核验流程（脚本或验证端点）：平台 CA 公钥验证书链 + 连接器证书公钥验签 → 确认某院背书了某 `resultSm3`
- [ ] 4.2 平台 CA 公钥/证书对外发布通道（存证详情附带 or 目录），使第三方能独立验
- [ ] 4.3 负例：篡改链上某院 `resultSm3`/签名 → 独立核验 MUST 失败

## 5. 前端

- [ ] 5.1 RWS 结果 / 存证详情按院显示背书（证书指纹前若干位 + 验签通过）

## 6. 切 fail-closed + 治理 + 验收

- [ ] 6.1 两院连接器升级后，切 fail-closed（无/错结果签名即拒该院贡献）
- [ ] 6.2 治理：`P-CTL-4` 现状标注「L1 可独立归因已落地、L2 多节点未落地」；如需补一条 DECISIONS（存证按院背书口径）；`check-meta-docs` 绿
- [ ] 6.3 端到端：多院任务 → 链上含各院背书 → 独立核验通过；单院同理；对照关闭背书可回退到只锚 `resultHash`
