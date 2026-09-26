## MODIFIED Requirements

### Requirement: 七项本地复核
连接器收到 `PlanFragmentOffer` 后 SHALL 逐项检查，全部通过才可签名接受：
1. 片段中每个算子摘要都在本地白名单中，未被吊销，清单签名有效；
2. 用途编码与本地合约一致，数据集在合约范围内，当前时间和凭证有效期都在合约有效期内；
3. 用本地清单对本方子图（本方片段及全部边界边）重算等级，符合传播规则；
4. 边界边的对端要么是本地固定公钥的平台节点，要么是证书有效且未吊销的参与方，C3 目标在合约接收方列表中；
   **C2 边在复核阶段只判两件事**：① 本地合约副本的条款里有 `attestation_policy`（否则该合约不允许 C2）；
   ② 对端在合约接收方/参与方之列。**本次会话的证明此时还不存在**（要到投递/执行时才产生），
   因此复核 MUST NOT 假装验证证明，也 MUST NOT 采信平台侧的证明登记结果；实际证明与 KMS 释放凭据的校验
   分别落在**投递阶段**（出口守卫）与**执行前**（`verifyC2Execution`）。复核 MUST 把 C2 对端记入复核结论
   （`c2Targets`），供后两处使用；
5. DP 预算账本不在医院连接器本地：片段若要求本节点申请 DP 预算，一律拒绝；
   （可信空间节点侧的查询预算由该节点自行记账，见 `trusted-space-node`，不改变本条对医院连接器的约束）；
6. 本地合约要求伦理批件时，作业的批件号与合约一致且未过期；
7. 重算的片段哈希与 `plan_hash` 与要约一致。

每项失败对应的错误码：
- 第 1 项：`E_OP_NOT_WHITELISTED` 或 `E_OP_REVOKED`；
- 第 2 项：`E_PURPOSE_MISMATCH` 或 `E_CONTRACT_EXPIRED`；
- 第 3 项：`E_LABEL_VIOLATION`；
- 第 4 项：`E_CAPABILITY_MISMATCH`（合约未声明证明策略、对端不在参与方之列；标签不符时是
  `E_LABEL_VIOLATION`）。**复核阶段不产生 `E_ATTESTATION_FAILED`**：本项在**执行前**发生，
  而本次会话的证明要到执行后才产生——证明校验落在**投递（出口守卫）**与**执行前**
  （`verifyC2Execution`），错误码由那两处出（见本能力末尾的说明）；
- 第 5 项：`E_BUDGET_EXCEEDED`；
- 第 6 项：`E_ETHICS_MISSING`；
- 第 7 项：`E_TICKET_INVALID`。

#### Scenario: 用途不符
- **WHEN** 片段的用途编码与本地合约不同
- **THEN** 复核 MUST 以 `E_PURPOSE_MISMATCH` 拒绝

#### Scenario: 本地合约未声明证明策略
- **WHEN** 片段中一条 C2 边指向某节点，而本地合约副本的条款里没有 `attestation_policy`
- **THEN** 复核 MUST 以 `E_CAPABILITY_MISMATCH` 拒绝

#### Scenario: 合约允许 C2 但平台未给出对端
- **WHEN** 片段中一条 C2 边的对端既不是本节点，也不在合约接收方/参与方之列
- **THEN** 复核 MUST 以 `E_CAPABILITY_MISMATCH` 拒绝

#### Scenario: 复核结论带出 C2 对端
- **WHEN** 复核通过一条 C2 边（合约有策略、对端在参与方之列）
- **THEN** 复核结论 MUST 把该对端列入 `c2Targets`，供投递与执行前校验使用

#### Scenario: 会话结束后核验节点证明（D13 的独立校验落点）
- **WHEN** 持有方收到平台转发的**会话见证**（节点证明 + KMS 释放凭据）
- **THEN** 持有方 MUST 用**部署配置里的 KMS 公钥**验签，并把本次证明与本院签下的期望（`core.attestation[node]`）对拍；
  通过记 `WITNESS_VERIFIED`、不通过记 `WITNESS_REJECTED`（含错误码），两者都 MUST 进审计回执链。
- 复核第 4 项因此**不承担**证明校验：它在**执行前**发生，而本次会话的证明要到执行后才产生；
  「持有方独立校验证明」的目标形态是**会话后核验见证**，不是复合约策略后的自证。
