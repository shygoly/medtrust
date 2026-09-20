## ADDED Requirements

### Requirement: 连接器结果级签名
连接器 MUST 对其聚合结果的 `resultSm3`（结果摘要，非传输层 `ts:pid:bodySm3`）用院内证书私钥做 SM2 签名，随结果回传。平台 MUST 用该院连接器证书验签并按院持久化 `{resultSm3, connectorSm2Sig, certFingerprint}`；验签失败 MUST 判该院贡献无效（fail-closed，不静默入库）。

#### Scenario: 回传带结果级签名 → 验签通过 → 持久化
- **WHEN** 连接器对 `resultSm3` 做 SM2 签名并随 complete 回传
- **THEN** 平台用该院连接器证书验签通过，持久化 `{resultSm3, 签名, 证书指纹}`

#### Scenario: 结果签名验不过 → 拒该院贡献
- **WHEN** 结果级签名缺失或与 `resultSm3` 不符
- **THEN** 平台 MUST 判该院贡献无效，不将其计入合并/存证

### Requirement: 存证按贡献方带连接器背书
平台锚链的存证 payload MUST 在合并 `resultHash` 之外，按贡献方带上 `{participantId, resultSm3, connectorSm2Sig, certFingerprint}`。多院任务的存证记录 MUST 含各院背书。

#### Scenario: 多院任务存证含各院背书
- **WHEN** 一个跨院 RWS 任务合并回传并存证
- **THEN** 链上记录 MUST 含合并 `resultHash` + 各贡献院的连接器背书

#### Scenario: 单院任务存证含该院背书
- **WHEN** 单院任务存证
- **THEN** 链上记录 MUST 含该院连接器背书（非仅一个平台锚的哈希）

### Requirement: 存证可独立核验（无需医院节点）
存证记录 MUST 可脱离平台核验：给定链上的 `resultSm3 + connectorSm2Sig + certFingerprint` 与平台 CA 公钥，第三方 MUST 能验证书链 + 验签，确认该院背书了该结果哈希，全程 MUST NOT 依赖医院运行链节点。

#### Scenario: 第三方凭 CA 公钥独立验某院背书
- **WHEN** 第三方读链取某院背书，用平台 CA 公钥验证书链、连接器证书公钥验签
- **THEN** 能独立确认「该院背书了该 `resultSm3`」，不需向平台或医院请求

#### Scenario: 篡改链上背书 → 独立核验失败
- **WHEN** 链上某院的 `resultSm3` 或签名被篡改
- **THEN** 独立核验 MUST 失败（验签不通过）

### Requirement: 不改共识与节点拓扑
本能力 MUST NOT 改变链的共识或节点拓扑（仍单节点平台运营），MUST NOT 要求医院运行链节点或开入站端口，`attestationLevel` MUST 仍为 `software`（D-RWS-4）。

#### Scenario: L1 落地后拓扑不变
- **WHEN** 本能力上线
- **THEN** 链仍单节点、医院无链节点、连接器不开入站口，`attestationLevel=software`
