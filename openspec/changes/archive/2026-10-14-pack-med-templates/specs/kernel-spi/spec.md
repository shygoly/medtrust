## ADDED Requirements

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
