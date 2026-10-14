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

### Requirement: 节点侧分析沙箱经 S2 声明，出域判据留在基座

S2 算子包 MUST 支持可选 `declareSandboxes(ctx)`（`StageSandbox`），与 `declareCollectors` 并列；
基座 MUST NOT 静态 import 行业沙箱实现。
**出域判据（错误文案脱敏 / 编码白名单 / 分层键闭合语法）MUST 留在基座**，
MUST NOT 随分析逻辑进入行业包；包只能经基座给的 `SandboxHost` 取得已放行的输入与执行原语。

#### Scenario: 行业包绕过宿主适配器直接取明文

- **WHEN** 包的 `runStage` 实现试图不经 `SandboxHost` 访问阶段输入或模块字节
- **THEN** 评审 MUST 拒绝（判据与数据的通路 MUST 只有宿主适配器这一条）

#### Scenario: 出域判据被搬进包

- **WHEN** 变更把三条判据中的任意一条从基座移入行业包
- **THEN** 评审 MUST 拒绝，并触发安全回归（TRUST CTL-27 相关用例 MUST 保持红/绿语义不变）

### Requirement: 计划模板经 S2 声明，HTTP 语义留在基座

S2 算子包 MUST 支持可选 `declareTemplates(ctx)`（`PlanTemplate`，与 `declareCollectors` / `declareSandboxes` 并列）；
基座 MUST NOT 静态 import 行业模板实现。
入参校验的**领域错误**（`PlanInputError`）MUST 定义在基座包 `@medtrust/mdop`；
HTTP 语义（校验失败 = 400）MUST 由应用层的控制器承担，MUST NOT 由行业包依赖 web 框架实现。

#### Scenario: 行业包依赖 Nest

- **WHEN** `industries/*` 内出现 `@nestjs/common`（或其它 web 框架）依赖
- **THEN** 评审 MUST 拒绝（包只依赖 SPI 与基座）

#### Scenario: 校验失败不再是 400

- **WHEN** 某模板端点收到不合法入参
- **THEN** MUST 仍返回 400 且**文案不变**（控制器把 `PlanInputError` 映射成 `BadRequestException`）

### Requirement: 领域记录类型归行业包，基座契约只用中立记录类型

领域记录类型（如医疗的 `InternalRecord`，含疾病/用药/不良事件等字段）MUST 定义在行业包内；
基座（kernel 目录）的契约 MUST 用中立记录类型（如 `Record<string, unknown>`），MUST NOT 出现领域字段名。

#### Scenario: 基座出现领域字段名

- **WHEN** 基座目录里的契约类型出现疾病/用药/不良事件等字段名
- **THEN** `pnpm check:kernel-purity` MUST 报红（棘轮只减不增）

#### Scenario: 非基座应用代码引用行业包

- **WHEN** 连接器 `src/domain/*` 等**非基座**目录引用行业包的记录类型
- **THEN** 允许（包 → SPI → 基座 的方向不受影响）；基座目录内引用行业包 MUST 报红

