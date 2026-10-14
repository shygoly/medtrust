# kernel-spi Specification

## Purpose
TBD - created by archiving change pack-med-collectors. Update Purpose after archive.
## Requirements
### Requirement: 平台侧聚合实现只经 SPI 缝隙解析

基座 MUST 只经 `@medtrust/space-kernel-spi` 的 **S2 算子包**声明（`OperatorPack.declareCollectors` 与 `AggregationCollectorRegistry`）取得行业聚合实现；
基座 MUST NOT 静态 import 任何行业包（`industries/*`、`@medtrust/domain-*`）或应用内部行业路径。
行业包 MUST 只依赖 SPI 与基座，MUST NOT 依赖应用内部相对路径。

#### Scenario: 基座直接 import 行业收集器

- **WHEN** 任一基座目录文件出现含 `industries/med` 的 import 说明符
- **THEN** `pnpm check:kernel-purity`（棘轮或目标布局）MUST 报红，且 `pnpm test` MUST 失败

#### Scenario: 行业包反向依赖应用内部

- **WHEN** `industries/med` 内的文件 import 应用内部相对路径（`../../apps/...`）
- **THEN** 评审 MUST 拒绝（包只能依赖 SPI 与基座）

