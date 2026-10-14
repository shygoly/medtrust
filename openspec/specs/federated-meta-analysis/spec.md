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

### Requirement: 站点级效应量随机效应合并
中心控制面 SHALL 提供 meta 分析聚合器,对各参与方过闸后的站点级效应量(β / HR / ATE + 标准误/协方差)做随机效应合并,产出 pooled 效应、异质性指标(I² / τ²)与森林图数据。聚合器 MUST NOT 接触任何个体行,输入 MUST 仅为站点级汇总量。

#### Scenario: 随机效应合并产出 pooled 效应
- **WHEN** 聚合器收到 ≥2 个参与方的站点级效应量 + 标准误
- **THEN** 聚合器 MUST 输出 pooled 效应量、置信区间与异质性 I²/τ²

#### Scenario: 拒绝个体行输入
- **WHEN** meta 聚合器的输入中包含行级或可识别个体数据
- **THEN** 聚合器 MUST 拒绝该输入并记录审计

#### Scenario: 参与方不足无法合并
- **WHEN** 仅有一个参与方返回有效效应量
- **THEN** 聚合器 MUST 不做合并,并向发起方返回原因(单站无法 meta)

### Requirement: meta 结果存证
一次 meta 合并完成后,中心控制面 SHALL 将输入站点效应量的指纹、合并方法、pooled 结果哈希、时间戳上链存证;链上 MUST NOT 包含任何个体数据明文。

#### Scenario: 合并结果上链
- **WHEN** 一次 meta 合并完成
- **THEN** 中心 MUST 将合并方法 / 输入指纹 / 结果哈希上链,不含任何医疗数据明文

