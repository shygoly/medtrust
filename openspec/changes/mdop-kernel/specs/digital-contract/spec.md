## ADDED Requirements

### Requirement: 持有方签署的数字合约
用于授权 MDOP 作业的数字合约 SHALL 以规范化形式（JCS）表达，在现有要素之外增加以下字段：
- 接收方列表：每项为 `{party, role: merger | final, jurisdiction}`，平台作为合并方时 MUST 显式列入；
- 用途编码；
- 允许的算子摘要；
- 复核方式（`auto` / `manual`）与复核时限；
- 是否要求伦理批件，以及批件号与有效期；
- 提供方连接器公钥指纹、平台节点公钥指纹；
- 预审快照哈希。

签署规则：
- 合约 MUST 由提供方连接器用本院私钥签署，再由平台节点密钥副署；
- 签名覆盖规范化合约的全部字段；
- 只有带有效持有方签名的合约才能授权 MDOP 作业；
- 没有持有方签名的旧合约 MUST 以 `E_CONTRACT_UNSIGNED` 被拒绝用于 MDOP 作业，但仍可服务旧管线直至其下线。

#### Scenario: 旧合约不能授权 MDOP 作业
- **WHEN** 一个 MDOP 作业引用了一份在本变更之前生效、没有持有方签名的合约
- **THEN** 编译 MUST 以 `E_CONTRACT_UNSIGNED` 失败

#### Scenario: 合约内容被改动
- **WHEN** 已签署合约的任一字段（例如接收方列表）被改动
- **THEN** 持有方签名 MUST 验证失败，该合约 MUST NOT 授权任何 MDOP 作业

#### Scenario: 平台作为合并方须明示
- **WHEN** 一份合约的接收方列表中没有平台
- **THEN** 该合约下的 C3 结果 MUST NOT 投递给平台

### Requirement: 撤销终止 MDOP 作业
数字合约被撤销时（在平台撤销，或医院在连接器本地撤销），引用该合约且尚未进入终态的 MDOP 作业 SHALL 进入 `ABORTED`，并触发销毁。此外：
- 平台 MUST 向相关连接器发出 `ContractTerminate`；
- 连接器本地撤销 MUST 立即生效，不以平台是否送达为前提。

#### Scenario: 平台侧撤销
- **WHEN** 提供方在平台上撤销一份合约，而该合约下有一个运行中的 MDOP 作业
- **THEN** 作业 MUST 进入 `ABORTED`，平台 MUST 向持有该作业制品的节点发出销毁指令

#### Scenario: 连接器本地撤销
- **WHEN** 医院在连接器本地撤销合约，而平台尚未收到通知
- **THEN** 该连接器 MUST 立即拒绝执行该合约下的任何片段
