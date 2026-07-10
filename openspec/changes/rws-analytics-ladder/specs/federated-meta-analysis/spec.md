## ADDED Requirements

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
