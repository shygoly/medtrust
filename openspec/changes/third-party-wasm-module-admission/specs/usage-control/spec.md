## ADDED Requirements

### Requirement: PEP 执行前吊销检查
连接器 PEP 在执行合约固定的算法模块之前，MUST 检查该模块未被吊销；被吊销（撤签名 / 撤合约固定 / 命中吊销名单）的模块 MUST 被拒绝执行，且不回退到内置实现。

#### Scenario: 已吊销模块被 PEP 拒
- **WHEN** 连接器领到引用某已吊销模块的任务
- **THEN** PEP MUST 拒绝执行，任务判失败，且不回退

#### Scenario: 未吊销模块正常放行
- **WHEN** 模块未被吊销且 SM2 / SM3 校验通过
- **THEN** PEP SHALL 放行，进入沙箱执行
