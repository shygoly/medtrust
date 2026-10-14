# mdop-aggregation Specification

## Purpose
TBD - created by archiving change pack-med-collectors. Update Purpose after archive.
## Requirements
### Requirement: 平台合并经聚合收集器注册表解析且口径不变

`MdopMergeService` MUST 经聚合收集器注册表解析实现，MUST NOT 按具体 `analysisType` 做静态分派。
被解析到的实现 MUST 与搬移前**同一函数体**（合并口径、字段顺序、错误语义都不因搬移而变）。
验收 MUST 同时满足两项：等价性用例逐字段相等，且棘轮计数**下降**。

#### Scenario: 收到的分析类型未注册

- **WHEN** 合并时某条投递的分析类型在注册表里没有对应收集器
- **THEN** MUST 以明确错误 fail-closed（错误里含该类型名与已注册清单）
- **AND** MUST NOT 回退到某个默认收集器，MUST NOT 静默产出空结果或部分结果

#### Scenario: 搬移改变了合并结果

- **WHEN** 搬移后的平台合并产物与搬移前基线（既有 e2e 夹具）出现任何字段差异
- **THEN** 本变更 MUST 被视为回归并阻断合并

#### Scenario: 棘轮计数没有下降

- **WHEN** 变更合并后 `scripts/check-kernel-purity.mjs --ratchet` 的当前计数不低于变更前基线（246）
- **THEN** 验收 MUST 不通过（本变更的目的就是让计数下降，只许更少）

