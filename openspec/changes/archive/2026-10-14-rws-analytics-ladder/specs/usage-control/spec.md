## ADDED Requirements

### Requirement: 分析分级授权
数字合约([[digital-contract]])的目的与输出约束 SHALL 限定允许的分析层级(L1 / L1.5 / L2 / L3 / L4)与允许的输出产物类别(`allowedArtifacts`);连接器策略执行点(PEP)MUST 拒绝任何超出合约允许层级或产物类别的任务。

#### Scenario: 安全监测合约不允许模型训练
- **WHEN** 一个数字合约的目的限定为"上市后安全监测"、允许层级至多 L1.5
- **AND** 一个 L4 预测建模任务引用该合约
- **THEN** 连接器 PEP MUST 拒绝该任务并记录审计

#### Scenario: 产物类别越界被拒
- **WHEN** 一个任务请求输出的 artifact 类别不在合约 `allowedArtifacts` 白名单内
- **THEN** 连接器 PEP MUST 拒绝该任务并记录审计
