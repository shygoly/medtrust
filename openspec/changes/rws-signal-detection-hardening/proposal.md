# 医疗真实世界研究（RWS）药物不良反应信号探测全链路加固

## 为什么

对医疗空间信号探测三条主线（`disproportionality`、`adverse-event-signal`、`vaccine-scri`）进行代码与单测审查后，确认存在四项直接影响研究可靠性、合规闭环与界面认知的问题：

1. **生产接线丢失纳排与缺失处理，且 MDOP L1.5 绕过协议校验**：
   - `apps/connector/src/wiring/wire-l15.ts` 未消费阶段参数中的 `cohortDefinition` 与 `missingnessDeclaration`（仅测试接线 `local-l15-wiring.ts` 实现了它），导致生产环境下 L1.5 队列纳排静默失效；
   - 前端 `rws/page.tsx` 提交 `/mdop/jobs/l15` 时未传入队列定义、缺失声明或设计类型，且 `/mdop/jobs/l15` 未触发 `validateRwsAnalysisLadder` 对 `designType` / `rationale` 的协议强制校验。
2. **跨院小单元格抑制（`OutputGate`）后丢失标记与分母口径失真**：
   - 单家医院某结局 `0 < a < minCell(5)` 时，`OutputGate` 为防反推将整格 `(a, b, c, d)` 清零并置 `suppressed: true`；但平台 `mergeDisproportionalityAggregates` 直接求和既丢弃 `suppressed` 状态，又在部分医院被抹零后产生无提示的分母口径变化。
3. **缺少用药-事件时间先后判定与 BCPNN 可信下界 `IC025`**：
   - L1.5 目前仅做患者级共现构表（无用药先于发病校验，也未显式去重）；
   - `disproportionality.ts` 只输出点估计 `ic`，缺少药物警戒标准判据 `IC025`（小样本假阳性收敛下界）；前端结果面板也未展示已算出的 `chiSqYates` 与 `ic`。
4. **`adverse-event-signal` 名称与表单误导 + 过滤/词典断层**：
   - 前端将其标为“不良反应信号”并展示/预填无效的 `outcome`（`"acute pancreatitis"`），实际后端 `ae-signal.ts` 仅做无对照组的 `adverseEvents[].organSystem` 分类计数；
   - `seal.ts` 用药过滤采用严格全等（无法匹配别名/子串），且默认器官系统词典与常见中文系统命名不一致时触发 fail-closed 抛错。

## 做什么

1. **生产接线补齐 + 强制协议校验 + 同步改旧测试**：
   - 抽出共用的 `prepareDisproportionalityRows` 供 `wire-l15.ts` 与 `local-l15-wiring.ts` 统一执行队列规则检验/过滤及缺失声明处理；
   - 在医疗行业包 `industries/med/src/templates/l15.ts` 内严格校验 `designType`（闭集）与 `rationale`（必填）、配对 `missingnessDeclaration`、`cohortDefinition` 与 `temporalWindow`（抛 `PlanInputError` 映射到 HTTP 400，**不破坏 MDOP 基座纯度**）；
   - 扩展 `wire-mdop-rws.ts`、`apps/web` 的 L1.5 表单与 API 客户端，并同步补充既有 L1.5 测试/演示用例中的 `designType` 与 `rationale`。
2. **跨院小单元格抑制状态传播与有效分母披露**：
   - 在不打破节点清零隐私红线前提下，`mergeDisproportionalityAggregates` 聚合出 `suppressed`（全站抑制）、`partialSuppression`（部分抑制）、`suppressedSites`、`effectiveSites`、`totalSites` 与 `effectiveCohortSize`；全站抑制时不产出假 `PRR=1`；
   - 同步适配 `c3-facts.ts`、`c3-interpret-payload.ts`、`mdop-result-view.ts` 与 `mdop-result-panel.tsx`。
3. **Drug-before-Event 时间先后窗（允许无日期回退）、去重与 BCPNN `IC025`**：
   - 为 `AdverseEvent` / `RawPatientRecord` / `InternalRecord` 扩展可选 `onsetDate` 与 `medicationExposures`（兼容无日期老记录），`Deidentifier` 与 `fhir-bundle-loader` 透传日期；
   - 在宿主投影阶段实现患者内事件词条去重与 Drug-before-Event 过滤（**允许无日期数据集回退为 `undated-cooccurrence` 并附显式元数据提示**，仅当 `requireTemporalOrder: true` 时拒绝无日期数据；**不改动 Wasm 二进制 ABI**）；
   - 在 `disproportionality.ts` 实现基于 Norén 收缩 Gamma 后验分位数的精确 `ic025` / `ic975` 与 `signalBcpnn`（保留 Evans 作为 `signal` 主字段兼容旧契约），并在前端展示 `χ²` 与 `IC (IC025~IC975)`。
4. **`adverse-event-signal` 语义纠偏与通用参数化容错**：
   - 前端将 `adverse-event-signal` 文案纠偏为“不良事件器官分布（描述性计数）”，移除无效 `outcome` 输入与预填，补齐结果频次表格；
   - 行业包 `ae-signal.ts` 与 `category-dictionaries.ts` 通过通用阶段参数向 `seal.ts` 下发药物别名子串匹配与默认词典同义/兜底映射（`seal.ts` 不包含任何医学行业词）。

## 不做什么

- 不修改 `packages/wasm-algorithms` 中既有 `.wasm` 模块 ABI 与二进制 SM3 摘要；
- 不放宽节点侧 `OutputGate` 对单院 `0 < a < minCell` 整格清零的隐私门禁，也不在平台侧重构被抑制站点的格值；
- 不在本变更内开放生产 OMOP CDM 直接分析（`CdmAnalysisNotOpenError` 仍保留，待 Circe 队列定义接入）；
- 不修改基座目录纯度守则 `check-kernel-purity` 基线（新增行业词汇全部留在包层、领域层与前端）。

## 影响

- **接口与模板行为变化（Breaking on L1.5）**：`buildL15Plan` / `POST /mdop/jobs/l15` 强制校验 `designType` 与 `rationale`，需同步更新存量无设计字段的测试与演示夹具；
- **结果 JSON 增补字段**：C3 合并产物新增 `ic025`、`ic975`、`signalBcpnn`、`partialSuppression`、`suppressedSites`、`effectiveSites`、`effectiveCohortSize`、`temporalMode`；`c3-facts.ts` 同步放行上述白名单字段；
- **旧链/新链对齐**：生产与本地 MDOP L1.5 两条接线共享同一队列与缺失预处理函数。
