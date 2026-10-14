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

