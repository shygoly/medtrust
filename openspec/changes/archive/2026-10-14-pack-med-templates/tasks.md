## 1. SPI 与领域错误

- [x] 1.1（2026-10-14）`packages/space-kernel-spi`：新增 `PlanTemplate`（`id` + `build(input, ctx)`）与 `TemplateRegistry`；`OperatorPack` 增可选 `declareTemplates?(ctx)`。
- [x] 1.2（2026-10-14）`@medtrust/mdop`：新增 `PlanInputError`（文案承载；零 HTTP 依赖）并导出。

## 2. 基座

- [x] 2.1（2026-10-14）`apps/api/src/mdop/template-registry.ts`：域中立注册/解析；未知模板 id fail-closed（含已注册清单）。
- [x] 2.2（2026-10-14）`LogicalPlanDraft` 提升到 `@medtrust/mdop`；`plan-templates.ts` 保留再导出（调用点不破）。
- [x] 2.3（2026-10-14）控制器：端点经注册表取模板；捕获 `PlanInputError` → `BadRequestException(message)`；入口闸门顺序不变。

## 3. 行业包（竖切 paired-cohort）

- [x] 3.1（2026-10-14，竖切 paired-cohort）`industries/med/src/templates/paired-cohort.ts`：逐字搬移（阶段链 / `at` / 条件展开不动），`space` 改为入参。
- [x] 3.2（2026-10-14）包导出 `medTemplates()` / `registerMedTemplates(registry)`；`medOperators.declareTemplates` 声明之。
- [x] 3.3（2026-10-14）组装根 `apps/api/src/app.module.ts` + jest `setupFiles` 注册。
- [x] 3.4（2026-10-14：3 个 spec + 控制器）引用方（9 个 spec + 控制器）改从包引用。

## 4. 验收（双闸）

- [x] 4.1（2026-10-14：api mdop 31 套件 / 183 用例）api mdop 30 套件 / 178 用例全绿；`plan-templates.spec.ts` 等逐字段相等（搬移前后同入参）。
- [x] 4.2（2026-10-14：template-registry.spec 断言 400 + 文案原样）端点 400 语义用例仍在（校验失败仍是 400，文案不变）。
- [x] 4.3（2026-10-14：163 → 156）棘轮：重新生成基线，**163 → ≤128**（本刀目标）；`pnpm test` 链通过。

## 5. 其余四个模板

- [x] 5.1（2026-10-14：l15 / vaccine-scri / ve-tnd / dedup-incidence 四条搬入 + 共享助手随行）搬 `vaccine-scri` / `ve-tnd` / `dedup-incidence` / `l15.disproportionality`（同一形态，逐个验证）。
- [x] 5.2（2026-10-14：L4 明确留待 FL 迁移 5.x 与 DTO 一起动，已在 TD-12 与 evidence 写明）L4（`rws.l4.fl-prediction`）**留待** FL 迁移 5.x 与 DTO 一起动——在 TD-12 写明。

## 6. 治理同步

- [x] 6.1（2026-10-14）`docs/tech-debt.md` TD-12 更新计数与剩余项（仅 L4 模板 + `mdop.controller.ts` 的台账语义）。
- [x] 6.2（2026-10-14）证据：搬移前后同入参计划逐字段相等；端点 400 用例截图式记录（命令 + 输出）。
