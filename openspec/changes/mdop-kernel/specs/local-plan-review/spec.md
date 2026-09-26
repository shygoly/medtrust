## ADDED Requirements

### Requirement: 本地合约库
连接器 SHALL 在本地库中保存本院签署的合约全文，以及本院签名和平台副署。对 MDOP 片段的复核 MUST 只依据本地副本，MUST NOT 依据平台随消息附带的合约内容。

#### Scenario: 平台附带的合约与本地副本不一致
- **WHEN** 片段要约中引用的合约用途与本地副本不同
- **THEN** 连接器 MUST 按本地副本判定，以 `E_PURPOSE_MISMATCH` 拒绝

#### Scenario: 本地没有该合约
- **WHEN** 片段引用的合约在本地库中不存在
- **THEN** 连接器 MUST 以 `E_CONTRACT_UNSIGNED` 拒绝

### Requirement: 合约本地确认与签署
连接器收到 `ContractOffer` 后 SHALL 放入本地待确认队列。
- 缺省需要院内人员经仅限院内访问的端点或 CLI 确认；
- 只有本地策略文件显式允许的要约才可以自动确认，自动确认 MUST 在签名记录中标注 `review=auto(policy)`；
- 确认后，连接器用本院私钥签署规范化合约，发出 `ContractAgree`，并写入本地合约库。

医院在本地撤销合约 MUST 立即生效：此后复核 MUST 拒绝引用该合约的片段，与平台是否已知无关。

#### Scenario: 未经确认不签
- **WHEN** 连接器收到一份合约要约，本地既没有人工确认，也没有匹配的自动确认策略
- **THEN** 连接器 MUST NOT 签署该合约

#### Scenario: 本地撤销立即生效
- **WHEN** 医院用本地 CLI 撤销了一份合约
- **THEN** 连接器 MUST 立即以 `E_CONTRACT_EXPIRED` 拒绝引用该合约的新片段，并停止执行在途片段

### Requirement: 七项本地复核
连接器收到 `PlanFragmentOffer` 后 SHALL 逐项检查，全部通过才可签名接受：
1. 片段中每个算子摘要都在本地白名单中，未被吊销，清单签名有效；
2. 用途编码与本地合约一致，数据集在合约范围内，当前时间和凭证有效期都在合约有效期内；
3. 用本地清单对本方子图（本方片段及全部边界边）重算等级，符合传播规则；
4. 边界边的对端要么是本地固定公钥的平台节点，要么是证书有效且未吊销的参与方，C3 目标在合约接收方列表中；
5. 本期没有预算账本，凡是给本节点申请 DP 预算的片段一律拒绝；
6. 本地合约要求伦理批件时，作业的批件号与合约一致且未过期；
7. 重算的片段哈希与 `plan_hash` 与要约一致。

每项失败对应的错误码：
- 第 1 项：`E_OP_NOT_WHITELISTED` 或 `E_OP_REVOKED`；
- 第 2 项：`E_PURPOSE_MISMATCH` 或 `E_CONTRACT_EXPIRED`；
- 第 3 项：`E_LABEL_VIOLATION`；
- 第 4 项：`E_CAPABILITY_MISMATCH`；
- 第 5 项：`E_BUDGET_EXCEEDED`；
- 第 6 项：`E_ETHICS_MISSING`；
- 第 7 项：`E_TICKET_INVALID`。

#### Scenario: 用途不符
- **WHEN** 片段的用途编码与本地合约不同
- **THEN** 连接器 MUST 以 `E_PURPOSE_MISMATCH` 拒绝

#### Scenario: 申请 DP 预算
- **WHEN** 作业为本节点申请了 ε > 0 的预算
- **THEN** 连接器 MUST 以 `E_BUDGET_EXCEEDED` 拒绝，说明为「本节点未启用预算账本」

#### Scenario: 缺少伦理批件
- **WHEN** 本地合约要求伦理批件，而作业没有批件号或批件已过期
- **THEN** 连接器 MUST 以 `E_ETHICS_MISSING` 拒绝

#### Scenario: 平台改动了片段
- **WHEN** 要约中的片段内容与片段哈希表中的哈希不符
- **THEN** 连接器 MUST 以 `E_TICKET_INVALID` 拒绝

### Requirement: 复核方式与时限
复核 SHALL 按本地合约约定的方式进行：
- `auto`：七项全部通过即签；
- `manual`：七项通过后进入本地待确认队列，由院内人员确认。

复核时限由合约约定，缺省 72 小时；超时 MUST 视同拒绝。

#### Scenario: 人工复核超时
- **WHEN** 合约约定人工复核，而院内人员在时限内没有确认
- **THEN** 该片段 MUST 视同拒绝，平台将作业置为 `REJECTED`

### Requirement: 接受与拒绝消息
接受时，连接器 SHALL 用本院私钥签名凭证核心与本节点快照标识，以 `PlanFragmentAccept` 发回。
- 快照标识：文件数据源为文件字节的 SM3。

拒绝时 MUST 以 `PlanFragmentReject` 发回，只包含错误码和一句简短说明。每一次接受或拒绝 MUST 写入本地审计回执链。

#### Scenario: 拒绝消息的内容
- **WHEN** 连接器拒绝一个片段
- **THEN** `PlanFragmentReject` MUST 只含错误码和简短说明，MUST NOT 含本地策略原文、预算数值或数据规模

### Requirement: 执行前凭证校验
连接器在执行每个 `StageDispatch` 之前 SHALL 校验：
- 凭证中有本院对凭证核心与本节点快照的有效签名；
- 平台签名能用本地固定的平台节点公钥验证；
- 当前时间在凭证有效期内；
- 待执行片段的哈希等于凭证中本节点的片段哈希；
- 重算的数据快照标识等于签入的值。

快照不一致 MUST 以 `E_SNAPSHOT_CHANGED` 拒绝；其余任一失败 MUST 以 `E_TICKET_INVALID` 拒绝。拒绝时 MUST NOT 读取数据。

#### Scenario: 篡改片段后下发
- **WHEN** 平台在凭证签发后改动了本节点片段，再下发 `StageDispatch`
- **THEN** 连接器 MUST 以 `E_TICKET_INVALID` 拒绝执行

#### Scenario: 凭证缺少本院签名
- **WHEN** 凭证里没有本院的有效接受签名
- **THEN** 连接器 MUST 以 `E_TICKET_INVALID` 拒绝执行

#### Scenario: 数据在接受后发生变化
- **WHEN** 执行时重算的快照标识与接受时签入的不同
- **THEN** 连接器 MUST 以 `E_SNAPSHOT_CHANGED` 拒绝执行

#### Scenario: 凭证过期
- **WHEN** `StageDispatch` 到达时已超过凭证的 `not_after`
- **THEN** 连接器 MUST 以 `E_TICKET_INVALID` 拒绝执行
