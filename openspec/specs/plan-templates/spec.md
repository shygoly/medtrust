# plan-templates Specification

## Purpose
TBD - created by archiving change pack-med-templates. Update Purpose after archive.
## Requirements
### Requirement: 模板解析经注册表且计划逐字不变

控制器 MUST 经模板注册表按 id 解析实现，MUST NOT 静态 import 具体模板；未注册的模板 id MUST fail-closed。
搬移 MUST 逐字（阶段 id、op 引用、`at` 放置、参数条件展开一律不动）；验收 MUST 证明同入参的计划**逐字段相等**。

#### Scenario: 未注册模板

- **WHEN** 端点请求的模板 id 不在注册表里
- **THEN** MUST 以明确错误 fail-closed（含已注册清单），MUST NOT 回退到任何默认模板

#### Scenario: 搬移改变了计划

- **WHEN** 同入参下搬移前后的 `LogicalPlanDraft` 出现任何字段差异（含 `at` 的放置）
- **THEN** 变更 MUST 被视为回归并阻断

