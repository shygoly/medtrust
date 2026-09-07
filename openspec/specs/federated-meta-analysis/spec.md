# federated-meta-analysis Specification

## Purpose
TBD - created by archiving change rws-study-protocol-spec. Update Purpose after archive.
## Requirements
### Requirement: 合并结果携带主分析与全部敏感性分析

`federated-meta-analysis` 的合并产物 SHALL 同时携带主分析结果与规格中声明的全部敏感性分析结果（《指导原则》§3.5）。当敏感性分析结果与主分析**不一致**时，合并产物 MUST 标注该不一致，供报告环节按规范要求"深入探讨原因并审慎说明适用范围与潜在不确定性"。

系统 MUST NOT 对不一致做自动裁决或择优呈现——判断由研究者承担，系统只保证不一致不被隐藏。

#### Scenario: 合并产物含全部声明的敏感性分析
- **WHEN** 某任务声明了两项敏感性分析且结果齐备
- **THEN** 合并产物 MUST 同时含主分析与两项敏感性分析的合并效应量

#### Scenario: 不一致被显式标注
- **WHEN** 某项敏感性分析的合并效应方向与主分析相反
- **THEN** 合并产物 MUST 标注该不一致，MUST NOT 只呈现主分析结果

#### Scenario: 系统不自动裁决
- **WHEN** 主分析与敏感性分析结论不一致
- **THEN** 系统 MUST NOT 择优呈现或标记何者"更可信"

### Requirement: 合并结果报告绝对风险

合并产物 SHALL 在相对效应量（pooled OR / HR / ATE）之外，同时给出绝对风险表达（率差或风险差 + 置信区间）（《指导原则》§3.1）。绝对风险所依赖的基线率 MUST 来自过闸后的站点聚合量，MUST NOT 由控制面从个体数据推算——控制面永不持有个体数据。

#### Scenario: 合并结果含绝对与相对双口径
- **WHEN** 一个 L2 任务完成跨院合并
- **THEN** 合并产物 MUST 同时含 pooled 相对效应量与绝对风险差及各自 CI

#### Scenario: 基线率来自过闸聚合量
- **WHEN** 计算绝对风险所需的基线率
- **THEN** 该基线率 MUST 取自各站点过闸后回传的聚合计数

