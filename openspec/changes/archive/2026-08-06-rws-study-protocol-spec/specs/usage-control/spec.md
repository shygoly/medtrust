## ADDED Requirements

> Delta 说明：本文件叠加于未归档 change `federated-data-space-rws` 与 `rws-analytics-ladder` 定义的 `usage-control`，归档时统一 reconcile。本 change 新增"防 p-hacking"维度的强制，不修改既有的授权强制行为，故使用 ADDED。

### Requirement: 预先指定字段的冻结强制

`usage-control` SHALL 把既有的 `allowedArtifacts` 白名单强制从"授权边界"扩展为"预先指定边界"：`allowedArtifacts` 与 `matchingCovariates`（倾向评分变量）在任务派发后 MUST 不可变。

理由：《指导原则》附1·2 监管要点明示"预先指明用于构建倾向评分模型的变量，避免为获得'理想'或'预期'结果而反复调整倾向评分模型"。反复调整 PS 模型从最终产物上不可见，唯一有效的控制点在事前冻结。

#### Scenario: 派发后改 PS 变量被拒
- **WHEN** 一个已派发任务尝试修改 `matchingCovariates`
- **THEN** PEP MUST 拒绝该变更，任务 MUST 继续以冻结时的变量集执行

#### Scenario: 派发后扩大产物范围被拒
- **WHEN** 一个已派发任务尝试向 `allowedArtifacts` 追加类别
- **THEN** PEP MUST 拒绝，MUST NOT 允许新类别的产物出域

### Requirement: 敏感性分析全报强制

`usage-control` SHALL 在结果出具前对账：规格中**声明**的每一项敏感性分析，其结果 MUST 全部随主分析回传。存在声明但未回传的项时，结果 MUST NOT 出具（fail-closed）。

理由：《指导原则》§3.5 要求"完整报告所有敏感性分析结果"，且结果与主分析不一致时须探讨原因。选择性省略不一致项是最隐蔽的报告偏倚。本约束把"不可见的省略"转化为"可见的少声明"。

#### Scenario: 声明三项回传两项被阻断
- **WHEN** 某任务声明了三项敏感性分析，但回传结果只含两项
- **THEN** 系统 MUST NOT 出具该任务结果，并指出缺失的那一项

#### Scenario: 声明与回传一致则放行
- **WHEN** 声明的全部敏感性分析结果均已回传
- **THEN** 结果 MUST 正常出具

#### Scenario: 未声明敏感性分析不受此约束
- **WHEN** 某任务未声明任何敏感性分析
- **THEN** 本约束 MUST NOT 阻断结果出具（少声明是可见的，由评审判断）
