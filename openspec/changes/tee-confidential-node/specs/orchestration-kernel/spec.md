## ADDED Requirements

### Requirement: C2 编译与放置
编译器 SHALL 允许把 C2 边与其目标阶段放在**证明有效**的可信空间节点上。
- 放置前 MUST 查询该节点最近一次证明登记：证明有效期内、度量在允许清单、TCB ≥ 合约 `min_tcb`。
- 证明缺失或过期时，编译 MUST 拒绝（`E_ATTESTATION_FAILED`），MUST NOT 以「稍后补证明」放行。
- 数据就近规则不变：以 `ds://` 为输入的阶段仍留在数据所在节点，`seal` 之后才允许跨节点。

#### Scenario: 目标节点尚未登记证明
- **WHEN** 计划把一条 C2 边指向一个没有证明登记的可信空间节点
- **THEN** 编译 MUST 拒绝并指出该节点与边

#### Scenario: 证明在编译后过期
- **WHEN** 编译通过后，目标节点的证明在阶段下发前过期
- **THEN** 调度 MUST NOT 下发该阶段，作业 MUST 按超时/拒绝路径处理

### Requirement: 证明登记与生命周期
平台 SHALL 维护可信空间节点的证明登记：`node`、`quote_digest`、`measurement`、`tcb`、`verified_at`、`expires_at`、`chain_tx`。
- 证明摘要 MUST 锚定上链（复用存证适配器），链不可达时进补偿队列，MUST NOT 伪造交易号。
- 登记 MUST 可查询，供编译期与调度期判定；过期的登记 MUST NOT 被当作有效证明。
- 度量白名单 MUST 来自**部署配置**（注册中心白名单的人工同步副本），平台 MUST NOT 自行放宽——
  合约只能更严、交集为空即拒。**签名化签发与吊销未落地**（见 trusted-space-node 同名说明与 design Non-Goals）。

#### Scenario: 登记被伪造
- **WHEN** 有人试图用未经验签的证明写入登记
- **THEN** 平台 MUST 拒绝写入并记录审计

#### Scenario: 存证链不可达时的锚定记录
- **WHEN** 作业已到终态、需要把链头锚定上链，而存证链不可达（写入端未接或写入失败）
- **THEN** 锚定记录 MUST 记为 `pending`（进补偿队列，链恢复后补锚），且记录里 MUST NOT 出现交易号字段——
  不得用空串、占位符或本地回执编号冒充交易号

#### Scenario: 证明登记的上链补偿
- **WHEN** 登记时存证链不可达（写入抛错或返回降级回执），随后链恢复
- **THEN** 该登记 MUST 留在补偿队列里，并在链恢复后被补锚（**幂等**：已锚的不得重复上链）；
  补锚仍失败时 MUST 保持未锚（不阻断登记本身），MUST NOT 写入假交易号

### Requirement: 平台侧 ingest 的身份绑定（统一判据）
平台接收控制面消息时，**凡是要写入状态、写链或推进状态机的类型**，MUST 用消息层已认证的上下文
（信封 sender + 证书目录里的公钥）做身份判定，MUST NOT 采信消息正文里的自述字段。逐条要求：
- 回执（`AuditReceipt`）：`signer` = 发送方，且签名可被该参与方公钥验过（见 `node-artifact-lifecycle`）。
- 销毁回执（`PurgeReceipt`）：`node` = 发送方，且签名可验（见 `node-artifact-lifecycle`）。
- 阶段状态（`StageStatus`）：上报方 = 该阶段的落点节点（见 `trusted-space-node`）。
- 接受 / 拒绝（`PlanFragmentAccept` / `PlanFragmentReject`）：`signer` = 发送方（拒绝消息协议里没有签名，
  身份绑定是唯一可控点）。
- 合约签署（`ContractAgree`）：提交方 = 该合约的提供方——签名只证明「这份条款是提供方签的」，
  不证明「现在提交它的就是提供方」。
任一不符 MUST 拒绝该消息（`E_AUTH_INVALID` / 403），MUST NOT 落库、MUST NOT 推进状态机、MUST NOT 广播。

#### Scenario: 合约签署被冒名提交
- **WHEN** 已认证参与方 A 提交一份**由提供方 B 签名**的合约签署（`ContractAgree`）
- **THEN** 平台 MUST 拒绝（403）且合约状态 MUST NOT 被推进到 `active`

### Requirement: 凭证纳入证明摘要
执行凭证的签署内容 SHALL 在「凭证核心 + 本节点数据快照」之外，增加 `attestation{quote_digest, measurement, tcb}`。
- 各持有方的接受签名 MUST 覆盖该证明摘要：即签的是「在哪个度量下执行」。
- 执行前校验 MUST 比对「凭证中的证明摘要」与「本次会话实际证明」，不一致即 `E_ATTESTATION_FAILED`。
- 任一持有方拒绝或复核超时仍 MUST 使作业进入 `REJECTED`，且 MUST NOT 发出任何 `StageDispatch`。
- 平台 MUST 核对接受 / 拒绝消息里的 `signer` **就是消息层已认证的发送方**：接受靠签名挡伪造，
  但身份绑定挡「记到别人账上」；**拒绝消息在协议里没有签名**，身份绑定是唯一可控点——
  不绑就等于允许任何已认证参与方替别家拒绝，把整个作业打成 `REJECTED` 并向各院广播 `JobAbort`。

#### Scenario: 度量在执行前变化
- **WHEN** 节点在实际执行前提供的证明度量与凭证中登记的不一致
- **THEN** 执行 MUST 被拒绝，作业 MUST 进入失败路径

#### Scenario: 接受或拒绝被替报
- **WHEN** 已认证参与方 A 提交的消息自称 `signer: B`（接受或拒绝都一样）
- **THEN** 平台 MUST 拒绝该消息（`E_AUTH_INVALID`）；拒绝路径上作业 MUST NOT 进入 `REJECTED`、
  MUST NOT 发出 `JobAbort`

### Requirement: 调度与销毁覆盖可信空间节点
调度器 SHALL 把可信空间节点当作普通节点下发阶段指令（幂等键 `job:stage:attempt` 与重试规则不变）。
- 终态销毁 MUST 覆盖参与过的可信空间节点；`nodesToPurge` MUST 包含它们。
- 平台 MUST 收齐含该节点在内的全部 `PurgeReceipt` 才将作业置为 `PURGED`。

#### Scenario: 缺节点回执不释放
- **WHEN** 节点未返回销毁回执
- **THEN** 作业 MUST 停留在 `SUCCEEDED`（或相应终态）并持续按原幂等键重发，MUST NOT 进入 `PURGED`

### Requirement: 平台不得接触数据密钥
平台的任何组件 MUST NOT 持有、请求或缓存 C2 信封的数据密钥。
- 释放链路上 MUST 只有「节点 ↔ KMS」；
- 平台的证明登记只保存证明摘要与度量，MUST NOT 保存一次性私钥或任何可解密材料。

#### Scenario: 平台接口被要求返回密钥
- **WHEN** 调用方要求平台返回数据密钥或解密后的数据
- **THEN** 平台 MUST NOT 提供此类接口（以用例断言该约束）
