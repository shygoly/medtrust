# 证据：计划模板走 S2 —— 竖切 paired-cohort（2026-10-14）

## 1. 落地

- **SPI**：S2 增可选 `declareTemplates`（`PlanTemplate` / `TemplateRegistry`），与前两块并列，仍不新开缝。
- **协议核**：新增 `PlanInputError`（入参不合法；零 HTTP 依赖）与 `LogicalPlanDraft`（计划形状提升到基座，应用侧再导出）。
- **基座**：`apps/api/src/mdop/template-registry.ts` —— 注册/解析（未知 id fail-closed，含已注册清单）+
  **`buildPlanWithInputMapping`**（解析 → 构建 → `PlanInputError` 映射 `BadRequestException`，文案原样）。
- **包**：`industries/med/src/templates/paired-cohort.ts`（**逐字**搬移，仅两处差异：`space` 改入参；`BadRequestException` → `PlanInputError`）+
  `medTemplates()` / `registerMedTemplates` + `medOperators.declareTemplates` 声明。
- **装配**：组装根 `app.module.ts` + jest `setupFiles`（`apps/api/src/test/register-collectors.ts`）同源注册；
  控制器端点改经注册表（`@Body()` 收 `unknown`，校验由模板承担），`plan-templates.ts` 只留 id 常量。

## 2. 等价性与语义闸

- **计划逐字段相等**：新增 `template-registry.spec.ts` 断言「经注册表构建 == 直接调包内 builder」（`toEqual`）。
- **HTTP 400 语义保留**（tasks 4.2）：同文件断言不合法入参下 `buildPairedCohortPlan` 抛 `PlanInputError`、
  而 `buildPlanWithInputMapping` 抛 `BadRequestException` 且**文案逐字相同**（`跨院配对至少需要两家持有方`）。
- **在册值**：`resolveTemplateOrThrow('rws.nope')` 抛错且错误里**列出已注册清单**（fail-closed，不回退默认模板）。
- api 构建通过；**api mdop 31 套件 / 183 用例通过**（原 30/178 + 5 条新用例）。

## 3. 棘轮

| 口径 | 本刀前 | 本刀后 |
|---|---|---|
| 棘轮基线 | 163 | **156** |
| 目标布局越界 | 185 | **178** |
| `plan-templates.ts` | 49 | **44** |
| `mdop.controller.ts` | 16 | **14** |
| 依赖方向违规 | 0 | **0** |

## 4. 如实说明的残留

- 控制器仍保留**模板 id 常量**（`PAIRED_COHORT_TEMPLATE_ID` 等）：它们是**平台 API 面**（路由 + 迁移台账 key），
  不是行业知识；这部分不会归零，也不应该归零。同理，`plan-templates.ts` 里其余四个模板与 L4 仍在基座，待后续搬。
- 包内 `buildPairedCohortPlan` 需要调用方给 `space`（原来默认 `currentSpaceId()`）：**spec 一并传 `currentSpaceId()`**，
  与旧默认值完全一致，故计划内容不变。

## 5. 仍未做

- 其余四个模板：`vaccine-scri` / `ve-tnd` / `dedup-incidence` / `l15.disproportionality`（同一形态，逐个搬）。
- L4（`rws.l4.fl-prediction`）：依赖 `FlPredictionTaskSpec`，留待 FL 迁移 5.x 与 DTO 一起动。
