## Why

现状：连接器算完聚合结果 → 对回传请求做 SM2 签名（`ts:pid:bodySm3`，传输层，`ConnectorTokenGuard` 在 ingress 验一次即弃）→ 平台验哈希后，把**合并后的单个 `resultHash`** 锚到单节点链（`l0-validation-merge.ts:110` `attestation.anchor(resultHash)`，payload = `{dataHash, source:"medtrust-attestation"}`）。**连接器的签名从不进链**。

后果：链上记录只能证明「**平台**锚了这个哈希」，无法**独立归因到某医院**——读链的人脱离平台就无法验证「这条结果确实出自该院连接器」。对一个卖「可信」的数据空间，这是存证的实质空缺：`存证可信 = 信平台单节点`。

**L1** 用最小改动堵住「平台单方面伪造/篡改某院贡献」的缺口，且**医院无需跑任何链节点**：把连接器**对结果哈希的 SM2 签名**搬上链，任何人凭连接器证书（平台 CA 签发、可公开验）即可独立核验每院对其贡献的背书。与 L2（医院背书节点 / 多节点共识，见 P-CTL-4）正交——L1 不改共识、不加节点、不开入站口。

## What Changes

- **连接器：对结果哈希做结果级 SM2 签名**。连接器对其聚合结果的 `resultSm3`（稳定的结果摘要，非传输层 `ts:pid:bodySm3`）用院内证书私钥 SM2 签名，随结果回传；平台按院持久化 `{resultSm3, connectorSm2Sig, certFingerprint, participantId}` 到该院派发记录。
- **平台：上链 payload 按贡献方带上背书**。`attestation.anchor` 的存证 payload 从「单个合并 `resultHash`」扩展为「合并 `resultHash` + 每贡献方 `{participantId, resultSm3, connectorSm2Sig, certFingerprint}`」。多院任务锚一条含各院背书的记录。
- **可独立核验（核心收益）**：存证记录变为**离开平台也能验**——读链者拿链上的 `resultSm3 + connectorSm2Sig + certFingerprint`，用平台 CA 公钥验证书链、再用连接器证书公钥验签，即可确认「该院确实背书了这份结果哈希」。无需医院链节点。
- **前端存证详情显示每院背书**：证书指纹（前若干位）+ 验签状态（每贡献方一行）。
- **如实边界**：L1 只提升「链上记录可独立归因到医院」；**不改变**链仍是单节点平台运营这一事实（多节点共识是 P-CTL-4 的另一步）。`attestationLevel` 仍 `software`（D-RWS-4）。
- **不改共识 / 不加节点 / 不开入站口**：与连接器「只出站」红线一致。

## Capabilities

### New Capabilities
- `on-chain-provider-endorsement`：把连接器对结果哈希的 SM2 签名随存证上链，使存证记录可脱离平台、凭平台 CA 证书链独立归因并核验到每个贡献医院；医院无需运行任何链节点。

### Modified Capabilities
- `rws-compute`：RWS 结果存证从「只锚合并 `resultHash`」改为「锚合并 `resultHash` + 各贡献方连接器背书（`resultSm3`/SM2 签名/证书指纹）」；结果回传新增连接器对 `resultSm3` 的结果级 SM2 签名，平台按院验签并持久化。

## Impact

- **连接器**（`apps/connector`）：结果回传前对 `resultSm3` 做结果级 SM2 签名（复用院内证书私钥 `CONNECTOR_SM2_PRIVATE_KEY` / 指纹）；`control-plane-client` 的 complete 载荷带上该签名与指纹。
- **控制面**（`apps/api`）：complete 处理器按院验连接器结果签名（`ConnectorAuthService.verifyPayloadSignature`，已存在）并持久化；`l0-validation-merge` / `comparative-effect-merge` 在 anchor 前收集各院背书；`attestation.service.anchor` 接口扩展为带 provider 背书数组；`ChainAdapter` 上链 payload 相应扩展。
- **数据库**（`packages/database` 控制面实体）：派发记录（`cp_rws_assignment`）增列 `resultSm3` / `connectorResultSig` / `connectorCertFingerprint`；存证记录关联各院背书。
- **前端**：RWS 结果 / 存证详情显示每院背书（证书指纹 + 验签通过）。
- **治理**：归 `P-CTL-4`（多节点共识 / 密钥治理）接入路径的第一步「可独立归因」；如需可在 TRUST 增一条控制点或在 P-CTL-4 现状里标注 L1 已落地。DECISIONS 视需要补一条（存证按院背书的口径）。
- **非目标**：不做医院链节点 / 多节点共识（L2/L3，P-CTL-4 后续）；不改 `attestationLevel`。
