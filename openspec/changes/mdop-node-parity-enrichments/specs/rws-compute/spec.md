## ADDED Requirements

### Requirement: 节点必须按计划应用协议队列与缺失值声明
当计划声明了协议队列定义或缺失值处理声明时，节点 SHALL 在**投影之前**按其收窄队列并应用该处理，
并在聚合结果上挂载可对账的证据字段（`missingnessLog`）。缺声明时行为 MUST 与既有实现一致。

#### Scenario: 声明了协议队列
- **WHEN** 计划带 `tte`（纳入 age>=18、排除妊娠）且持有方含 1 名未成年与 1 名妊娠者
- **THEN** 聚合的队列规模不含被排除者，且各分类计数与旧实现逐字段一致

#### Scenario: 声明了缺失值策略
- **WHEN** 计划声明 `imputationStrategy = "多重插补(MI), m=10"`
- **THEN** 聚合带 `missingnessLog`，其 `appliedStrategy` 为 `multiple_imputation` 且保留声明原文

#### Scenario: 未声明
- **WHEN** 计划既无队列定义也无缺失值声明
- **THEN** 不产 `missingnessLog`、不做任何处理，计数与既有实现一致

### Requirement: 缺失值策略不得静默退化
节点 SHALL 在日志中如实记录实际应用的策略；声明了多重插补而退化为完全病例的情形 MUST 被记录并被判据拦下。

#### Scenario: 声明与实际不一致
- **WHEN** 声明多重插补但实现只做了完全病例
- **THEN** `missingnessLog.appliedStrategy` 不等于声明的策略，对账断言失败
