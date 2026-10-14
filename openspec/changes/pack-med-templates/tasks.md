## 1. SPI 与领域错误

- [x] 1.1（2026-10-14）`packages/space-kernel-spi`：新增 `PlanTemplate`（`id` + `build(input, ctx)`）与 `TemplateRegistry`；`OperatorPack` 增可选 `declareTemplates?(ctx)`。
- [x] 1.2（2026-10-14）`@medtrust/mdop`：新增 `PlanInputError`（文案承载；零 HTTP 依赖）并导出。

## 2. 基座

- [x] 2.1（2026-10-14）`apps/api/src/mdop/template-registry.ts`：域中立注册/解析；未知模板 id fail-closed（含已注册清单）。
- [x] 2.2（2026-10-14）`LogicalPlanDraft` 提升到 `@medtrust/mdop`；`plan-templates.ts` 保留再导出（调用点不破）。
- [ ] 2.3 控制器：端点经注册表取模板；捕获 `PlanInputError` → `BadRequestException(message)`；入口闸门顺序不变。

## 3. 行业包（竖切 paired-cohort）

- [ ] 3.1 `industries/med/src/templates/paired-cohort.ts`：逐字搬移（阶段链 / `at` / 条件展开不动），`space` 改为入参。
- [ ] 3.2 包导出 `medTemplates()` / `registerMedTemplates(registry)`；`medOperators.declareTemplates` 声明之。
- [ ] 3.3 组装根 `apps/api/src/app.module.ts` + jest `setupFiles` 注册。
- [ ] 3.4 引用方（9 个 spec + 控制器）改从包引用。

## 4. 验收（双闸）

- [ ] 4.1 api mdop 30 套件 / 178 用例全绿；`plan-templates.spec.ts` 等逐字段相等（搬移前后同入参）。
- [ ] 4.2 端点 400 语义用例仍在（校验失败仍是 400，文案不变）。
- [ ] 4.3 棘轮：重新生成基线，**163 → ≤128**（本刀目标）；`pnpm test` 链通过。

## 5. 其余四个模板

- [ ] 5.1 搬 `vaccine-scri` / `ve-tnd` / `dedup-incidence` / `l15.disproportionality`（同一形态，逐个验证）。
- [ ] 5.2 L4（`rws.l4.fl-prediction`）**留待** FL 迁移 5.x 与 DTO 一起动——在 TD-12 写明。

## 6. 治理同步

- [ ] 6.1 `docs/tech-debt.md` TD-12 更新计数与剩余项（仅 L4 模板 + `mdop.controller.ts` 的台账语义）。
- [ ] 6.2 证据：搬移前后同入参计划逐字段相等；端点 400 用例截图式记录（命令 + 输出）。
