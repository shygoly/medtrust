# 提案：医疗包接管计划模板（TD-12 最后一刀）

## Why

- 第三刀锯完后棘轮 **246 → 163**，剩余最大一簇就是 `apps/api/src/mdop/plan-templates.ts`（**49 处**）与
  `mdop.controller.ts`（**16 处**）：736 行的模板文件导出 6 个模板（L15 / L4 / paired-cohort / vaccine-scri /
  ve-tnd / dedup-incidence）与共享的 `LogicalPlanDraft`。
- 勘察结论（2026-10-14）：
  1. **只有 L4 依赖 `FlPredictionTaskSpec`**（`apps/api/src/compute-task/dto/`），其余五个模板**不牵 DTO 级联**；
  2. 每个 builder 已经写成 `space = currentSpaceId()` 的默认参数——把 space 从「包内自己取」改成「调用方传入」是**小改**；
  3. 拦路虎是 `BadRequestException`：包不能依赖 `@nestjs/common`，但入参校验的**文案与 HTTP 400 语义都是行为**；
  4. 控制器是**一模板一端点**（`@Post("jobs/<name>")`），每个端点自己调对应 builder。

## What Changes

1. **SPI**：S2 再增**可选** `declareTemplates?(ctx)`（`PlanTemplate` + `TemplateRegistry`），与 `declareCollectors` /
   `declareSandboxes` 并列；仍**不新开第七根缝**。
2. **领域错误**：`PlanInputError` 落在 `@medtrust/mdop`（基座包，无 HTTP 依赖）；控制器把捕获的 `PlanInputError`
   映射成 `BadRequestException`（**文案原样保留**），从而「校验逻辑进包、HTTP 语义留基座」。
3. **基座**：`apps/api/src/mdop/template-registry.ts`（域中立：按模板 id 注册/解析，未知 id fail-closed）；
   控制器端点改为经注册表取模板再构建（id 不变、HTTP 形状不变）。
4. **行业包**：`industries/med/src/templates/` 逐个搬入模板（先 paired-cohort 竖切，再其余四个）；
   `LogicalPlanDraft` 提升到 `@medtrust/mdop`（计划形状是基座概念，包要能引用）；包导出 `medTemplates()` / `registerMedTemplates`。
5. **装配**：`apps/api/src/app.module.ts` 注册；单测经现有 jest `setupFiles` 同源注册。

## 本期不做

- **L4 模板**暂留基座：它带 `FlPredictionTaskSpec`，而该 DTO 与 `fl-run-result` / 迁移台账**同一批**（FL 迁移 5.x 收尾时一起动），
  现在搬会把 DTO 级联扯进本变更。
- 不动 `mdop.controller.ts` 的入口闸门（`assertEntryKeyAllowed`，D-MDOP-7 台账）。

## Capabilities

- `kernel-spi`：S2 增 `declareTemplates`；HTTP 语义（400）与领域校验分离。
- `plan-templates`：模板解析经注册表、未知模板 fail-closed、计划形状不因搬移改变。

## Impact

- **验收双闸**：① 行为等价——`plan-templates.spec.ts` 等 9 个引用方全绿（api mdop 30 套件 / 178 用例为底线），
  且搬移前后同一入参的计划**逐字段相等**；② 棘轮——**163 → ≤128**（模板簇 49 处中先降 paired-cohort）。
- **风险**：模板里不仅有名字，还有**阶段链与 `at` 放置**（配对必须在节点内、降密紧跟其后）——搬移 MUST 逐字搬、
  不得顺手「优化」放置语义。
