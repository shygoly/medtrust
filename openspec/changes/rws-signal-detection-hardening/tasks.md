# 任务清单：rws-signal-detection-hardening

## 1. 生产接线补齐、协议强校验与旧测试同步升级
- [x] 1.1 在 `apps/connector/src/domain/sandbox/disproportionality-sandbox.ts` 抽出 `prepareDisproportionalityRows`（校验规则合法性、应用 `passesCohortDefinition` 与 `applyMissingness`）。
- [x] 1.2 更新 `apps/connector/src/wiring/wire-l15.ts` 与 `apps/connector/src/wiring/local-l15-wiring.ts`，统一使用 `prepareDisproportionalityRows` 并透传 `temporalWindow`。
- [x] 1.3 升级 `industries/med/src/templates/l15.ts`（`L15TemplateInput`）：必填校验 `designType`（闭集）与 `rationale`，校验可选 `cohortDefinition`、`missingnessDeclaration`、`temporalWindow`，非法抛 `PlanInputError` 并把参数注入算子阶段 `params`。
- [x] 1.4 更新 `apps/connector/src/wiring/wire-mdop-rws.ts` 向 L1.5 模板透传 `designType`、`rationale`、`sap`、`cohortDefinition`、`missingnessDeclaration`。
- [x] 1.5 同步升级既有旧测试与演示调用点以提供 `designType` 与 `rationale`：
  - `apps/api/src/mdop/conformance-e2e.spec.ts`
  - `apps/connector/src/domain/cohort-definition-gap.spec.ts`
  - `apps/connector/src/testdata/injected-ladder-e2e.spec.ts`
  - `apps/connector/src/domain/rws-analytics-ladder-scenarios.spec.ts`
  - `apps/connector/src/domain/connector-task-runner.spec.ts`
  - `apps/connector/src/domain/sandbox/execution-annotation.spec.ts`
  - `apps/connector/src/demo/run-analytics-ladder-e2e.ts` & `run-amr-q3-e2e.ts`
- [x] 1.6 扩展 `apps/web/src/api/client.ts`（`submitMdopL15`）与 `apps/web/src/app/(console)/space/tasks/new/rws/page.tsx`，L1.5 表单增加纳入/排除规则及时间窗上限输入并完整提交协议字段。

## 2. 跨院小单元格抑制传播与有效分母披露
- [x] 2.1 在 `apps/api/src/runtime/rws-orchestrator/disproportionality.ts` 中处理各院 `bucket.suppressed`：汇总 `suppressedSites`、`effectiveSites`、`totalSites`、`partialSuppression`、`suppressed` 与 `effectiveCohortSize`，全站抑制时不产出假 `PRR=1`。
- [x] 2.2 更新 `apps/api/src/result-interpreter/c3-facts.ts` 的 `bucketSchema` 放行统计与抑制字段，并在 `disproportionalityFacts` 生成部分抑制与有效站点/分母事实描述。
- [x] 2.3 更新 `apps/web/src/lib/c3-interpret-payload.ts`、`apps/web/src/lib/mdop-result-view.ts` 与 `apps/web/src/components/console/mdop-result-panel.tsx` 渲染部分抑制及全站抑制标签。

## 3. Drug-before-Event 时间窗（允许无日期）、去重与 BCPNN `IC025`
- [x] 3.1 扩展 `industries/med/src/records/internal-record.ts` 与 `apps/connector/src/domain/types.ts`，增加可选 `AdverseEvent.onsetDate` 与 `medicationExposures`；更新 `deidentifier.ts` 与 `fhir-bundle-loader.ts` 保留/提取日期。
- [x] 3.2 优化 `industries/med/src/analysis/clinical-matching.ts` 的 `matchesMedication` 边界匹配（去除危险反向子串包含）。
- [x] 3.3 在 `apps/connector/src/domain/sandbox/disproportionality-sandbox.ts` 实现患者内事件 `Set` 去重与 Drug-before-Event 过滤（允许无日期记录回退并标注 `temporalMode`，支持 `requireTemporalOrder` 严卡，不改 Wasm ABI）。
- [x] 3.4 在 `apps/api/src/runtime/rws-orchestrator/disproportionality.ts` 新增纯 TS 正则化不完全伽马分位求解 `ic025`、`ic975` 与 `signalBcpnn`，并在 `mdop-result-panel.tsx` 展示 `chiSqYates` 与 `IC (IC025~IC975)`。

## 4. `adverse-event-signal` 语义纠偏与通用参数化容错
- [x] 4.1 修正 `apps/web/src/app/(console)/space/tasks/new/rws/page.tsx` 与 `apps/web/src/lib/mdop-result-view.ts` 中的 `adverse-event-signal` 文案，移出 `showDrugOutcome` 以去掉无效 `outcome` 输入与预填。
- [x] 4.2 在 `industries/med/src/templates/ae-signal.ts` 与 `category-dictionaries.ts` 增加药物别名扩展与 `ORGAN_SYSTEM_SYNONYMS`，以通用阶段参数传入 `seal.ts`。
- [x] 4.3 在 `apps/connector/src/mdop/operators/seal.ts` 实现无行业词汇的通用 `filterValues`（不敏感子串）与 `categoryAliases / fallbackCategory` 映射逻辑。
- [x] 4.4 在 `apps/web/src/lib/mdop-result-view.ts` 与 `mdop-result-panel.tsx` 新增 `categorical-count`（器官系统分布）频次与占比表渲染及无对照组说明。

## 5. 测试与守护验证
- [x] 5.1 增补并跑通 `disproportionality.spec.ts`、`merge-disproportionality.spec.ts`、`c3-facts.spec.ts`、`ae-signal-plan.spec.ts`、`conformance-e2e.spec.ts`。
- [x] 5.2 增补并跑通 `sandbox.spec.ts`、`l15.spec.ts`、`projections.spec.ts`、`local-l15.spec.ts`、`output-gate.spec.ts`、`cohort-definition-gap.spec.ts`、`injected-ladder-e2e.spec.ts` 等连接器单测。
- [x] 5.3 增补并跑通 `apps/web` `mdop-result-view.test.ts` 与 `c3-interpret-payload.test.ts`。
- [x] 5.4 运行 `node scripts/check-kernel-purity.mjs --ratchet scripts/kernel-purity-baseline.json` 验证零基座纯度违规，确认各改动包 `tsc --noEmit` 通过。
