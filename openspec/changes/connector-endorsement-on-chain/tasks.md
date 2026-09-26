## 0. 前置

- [x] 0.1 确认 `ConnectorAuthService.verifyPayloadSignature`（已存在）可复用于验连接器**结果级**签名
- [x] 0.2 确认合并前各院 `resultSm3` 可收集（`l0-validation-merge` / `comparative-effect-merge` 的收集点）
      —— 实际收集点为 `collectEndorsements(completed)`，三处 anchor 均已接：L0（`l0-validation-merge`）、
      L2/L3（`meta-analysis.service` 由 `rws-orchestrator.service` 传入）、L1 描述性（`anchorDescriptiveMergedResult`）

## 1. 连接器结果级签名

- [x] 1.1 连接器对 `resultSm3` 做 SM2 签名（复用 `CONNECTOR_SM2_PRIVATE_KEY`）；`control-plane-client` 的 complete 载荷带 `{resultSm3, connectorSm2Sig, certFingerprint}`
      —— `apps/connector/src/domain/result-endorsement.ts`；载荷加域分离前缀 `medtrust.result-endorsement.v1:`
- [x] 1.2 单元测试：连接器结果签名可被平台侧 `verifyPayloadSignature` 验过
      —— `apps/connector/src/domain/result-endorsement.spec.ts`（5 例，含跨协议重放负例）

## 2. 平台：验签 + 持久化

- [x] 2.1 complete 处理器按院验连接器结果签名（**渐进**：无签名不破、有则验）
      —— `RwsOrchestratorService.verifyResultEndorsement`；指纹只取守卫认证过的那张证书
- [x] 2.2 DB（`cp_rws_assignment`）增列 `resultSm3` / `connectorResultSig` / `connectorCertFingerprint`
- [x] 2.3 验签失败 → 该院贡献无效（切 fail-closed 前先记审计/告警）
      —— 有签名验不过**任何时候**都拒（伪造比缺失更危险）；缺签名在渐进期记 warn

## 3. 上链 payload 扩展

- [x] 3.1 `attestation.service.anchor` 接口扩展：除合并 `resultHash` 外带 `endorsements:[{participantId, resultSm3, sig, certFingerprint}]`
- [x] 3.2 `l0-validation-merge` / `comparative-effect-merge` 在 anchor 前收集各院背书
      —— 统一走 `collectEndorsements`（按 participantId 排序，payload 不依赖回传顺序）
- [x] 3.3 `ChainAdapter` 上链 payload 带 endorsements；链不可达降级不丢背书（背书先持久化，链恢复可补锚）
      —— `ChainAdapter` 的 metadata 已是 JSON 透传，无需改；降级回执同样回带背书

## 4. 独立核验

- [x] 4.1 独立核验流程（脚本或验证端点）：平台 CA 公钥验证书链 + 连接器证书公钥验签 → 确认某院背书了某 `resultSm3`
      —— `scripts/verify-endorsement.mjs`（**离线**，不认识平台）+ `POST /attestation/verify-endorsement`（便利实现）
- [x] 4.2 平台 CA 公钥/证书对外发布通道（存证详情附带 or 目录），使第三方能独立验
      —— `GET /attestation/trust-anchor`（CA 公钥 + 载荷口径）、`GET /attestation/certificates`（证书目录含 CA 签名）；
      `cp_certificate` 增列 `caSignature`（旧行按存储字段重新签发补齐）
- [x] 4.3 负例：篡改链上某院 `resultSm3`/签名 → 独立核验 MUST 失败
      —— `endorsement-verification.spec.ts`：篡改 sm3 / 篡改签名 / 平台自签冒充 / 吊销 / 指纹不在目录，均失败

## 5. 前端

- [x] 5.1 RWS 结果 / 存证详情按院显示背书（证书指纹前若干位 + 验签通过）
      —— `providerEndorsementLabel`（`execution-isolation.ts`）+ `orchestration-task-detail.tsx`；
      任务级另显示「N/M 家带背书」与如实边界（链仍单节点）

## 6. 切 fail-closed + 治理 + 验收

- [x] 6.1 两院连接器升级后，切 fail-closed（无/错结果签名即拒该院贡献）
      —— 开关 `RWS_ENDORSEMENT_REQUIRED`（DEPLOY.md 已登记），默认渐进；切换动作本身是**部署步骤**，
      代码路径与测试已就位（`切 fail-closed 后:不带背书即拒该院贡献`）
- [x] 6.2 治理：`P-CTL-4` 现状标注「L1 可独立归因已落地、L2 多节点未落地」；补 DECISIONS `D-RWS-5`（存证按院背书口径）；
      新增正册 `CTL-23`；`node scripts/check-meta-docs.mjs` 绿（0 error）
- [x] 6.3 端到端：多院任务 → 链上含各院背书 → 独立核验通过；单院同理；对照关闭背书可回退到只锚 `resultHash`
      —— `result-endorsement.spec.ts`（16 例）+ `endorsement-verification.spec.ts`（12 例）

## 已知边界（如实）

- L1 只防**伪造**，不防**遗漏**：平台仍单节点、仍决定锚不锚（design D4）；遗漏归 P-CTL-4 的 L2。
- `attestationLevel` 仍恒 `software`（D-RWS-4 不变）。
- ali29 上线需重建 api + connector；CA 已挂卷持久化，背书验签链不断。
