## ADDED Requirements

### Requirement: 领域记录类型归行业包，基座契约只用中立记录类型

领域记录类型（如医疗的 `InternalRecord`，含疾病/用药/不良事件等字段）MUST 定义在行业包内；
基座（kernel 目录）的契约 MUST 用中立记录类型（如 `Record<string, unknown>`），MUST NOT 出现领域字段名。

#### Scenario: 基座出现领域字段名

- **WHEN** 基座目录里的契约类型出现疾病/用药/不良事件等字段名
- **THEN** `pnpm check:kernel-purity` MUST 报红（棘轮只减不增）

#### Scenario: 非基座应用代码引用行业包

- **WHEN** 连接器 `src/domain/*` 等**非基座**目录引用行业包的记录类型
- **THEN** 允许（包 → SPI → 基座 的方向不受影响）；基座目录内引用行业包 MUST 报红
