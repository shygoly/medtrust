# 设计：计划模板走 S2（TD-12 最后一刀）

## D1 形态：注册表 + 领域错误（沿用前两刀的做法）

与前两刀同构：SPI 声明 → 基座注册表 → 包实现 → 组装根注册 → 双闸验收。差异只有两处，见 D2 / D3。

## D2 入参校验：领域错误 + 控制器映射，而不是让包依赖 Nest

模板里的 `throw new BadRequestException(...)` 有两重语义：**校验**（业务）与 **HTTP 400**（传输）。
方案：校验进包、抛 `PlanInputError`（放 `@medtrust/mdop`，零 HTTP 依赖）；控制器的模板端点捕获后
`throw new BadRequestException(err.message)` —— **文案原样**，HTTP 形状不变。
备选（否决）：给医疗包加 `@nestjs/common` 依赖（领域包反向依赖 web 框架，且与「包只依赖 SPI/基座」相悖）。

## D3 space 由调用方传入

现有 builder 是 `space = currentSpaceId()` 默认参数——包不能 import 应用的 `space-id.util`。
改为 `build(input, space: string)`：控制器的端点传 `currentSpaceId()`。多空间语义不变（本来每次调用取一次）。

## D4 `LogicalPlanDraft` 提升到 `@medtrust/mdop`

计划形状是**基座概念**（编译器产物），不是医疗概念；放基座包后包可以引用、应用侧保留再导出以免改动调用点。

## D5 逐字搬移，禁止顺手优化

模板里有**放置语义**：如跨院配对的 `pair` / `decTee` 都写 `at: <teeNode>`（不写就会被默认丢给平台，而平台不能解封）。
搬移 MUST 逐字，阶段 id、op 引用、`at`、参数条件展开（`...(x ? {k:x} : {})`）都不得改动。判据：搬移前后同入参输出逐字段相等。

## D6 顺序（每步可独立验证）

SPI 缝 + `PlanInputError` → 基座注册表 + `LogicalPlanDraft` 提升 → 搬 paired-cohort（竖切）+ 控制器端点改造 →
双闸 → 其余四个模板（逐个或成批）→ L4 留待 FL 收尾。

## 风险

| 风险 | 缓解 |
|---|---|
| 搬移改了计划（阶段链/放置/条件展开） | D5 逐字搬 + 同入参逐字段相等 |
| HTTP 语义变了（400 → 500） | D2 控制器映射，文案不变；端点用例仍断言 400 |
| 控制器的入口闸门被绕过 | 端点仍先 `assertTemplateAllowed` 再解析模板 |
| L4 被顺手搬走 | 本变更显式排除；台账/迁移 5.x 一起动 |
