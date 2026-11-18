# 设计：医疗 RWS 信号探测全链路加固

## D1 架构边界：严格遵守 MDOP 基座纯度守则

`scripts/check-kernel-purity.mjs` 将 `apps/api/src/mdop` 与 `apps/connector/src/mdop` 列为基座目录（禁止新增 `cohort`、`drug`、`adverse`、`rws` 等行业词或反向引入 `@medtrust/domain-med`）。因此本变更所有领域语义按如下分层落地：

| 层次 | 允许包含的语义 | 本变更落点 |
|---|---|---|
| **行业包** (`industries/med/src/`) | RWS 协议字段校验、药名别名表、默认器官系统同义映射 | `templates/l15.ts`（`PlanInputError` 校验）、`templates/ae-signal.ts`、`templates/category-dictionaries.ts`、`records/internal-record.ts`、`analysis/clinical-matching.ts` |
| **连接器装配/领域** (`apps/connector/src/wiring`, `src/domain`) | 纳排规则求值、缺失处理、时间先后窗投影、FHIR 日期抽取 | `wire-l15.ts`、`local-l15-wiring.ts`、`wire-mdop-rws.ts`、`disproportionality-sandbox.ts`、`deidentifier.ts`、`fhir-bundle-loader.ts` |
| **基座算子** (`apps/connector/src/mdop/operators/seal.ts`) | **纯通用机制**（无行业词汇）：多值不敏感子串过滤、通用键别名与兜底替换 | `passesRecordFilter` 支持 `filterValues` + `filterMatch: "contains-insensitive"`；分类投影支持 `categoryAliases` + `fallbackCategory` |
| **API 业务/解释层** (`apps/api/src/runtime`, `src/result-interpreter`) | 跨院四格表统计池化、BCPNN IC025、事实抽取白名单 | `disproportionality.ts`、`c3-facts.ts` |
| **控制台前端** (`apps/web/src/`) | 表单输入、语义纠偏文案、C3 指标与抑制告警渲染 | `rws/page.tsx`、`api/client.ts`、`c3-interpret-payload.ts`、`mdop-result-view.ts`、`mdop-result-panel.tsx` |

## D2 生产 L1.5 接线等价性与协议强校验

- 将 `passesCohortDefinition`、`isSupportedCohortRule`（先校验规则合法性，未知文法直接失败）与 `applyMissingness` 收敛为 `disproportionality-sandbox.ts` 导出的 `prepareDisproportionalityRows(rows, params)`；
- `wire-l15.ts`（生产）与 `local-l15-wiring.ts`（本地测试）均直接调用 `prepareDisproportionalityRows`，消除两套实现漂移；
- 在 `industries/med/src/templates/l15.ts` 中校验 `designType`（6 值闭集）与非空 `rationale`（必填）、成对 `missingnessDeclaration`、`cohortDefinition` 字符串数组与合法 `temporalWindow`，非法输入抛 `PlanInputError` 并由 `template-registry.ts` 映射为 HTTP 400；
- `wire-mdop-rws.ts` 调用 `template.build` 时透传 `analysis.designType`、`analysis.rationale`、`analysis.sap`、`cohortDefinition` 与 `missingnessDeclaration`，同步补齐既有 8 处测试/演示入参。

## D3 跨院小单元格抑制传播与隐私保护

当某院某不良结局 $0 < a_{ik} < \text{minCell}$ 时，`OutputGate` 将该院该桶整格清零为 `a=0, b=0, c=0, d=0, suppressed: true`（防止结合同院其他未抑制结局的边缘总和反推 $a_{ik}$）。平台合并 `mergeDisproportionalityAggregates` **不得打破该隐私红线**，而是按如下口径诚实披露：

1. 统计每个结局桶的 `suppressedSites`（`b.suppressed === true` 的院数）与 `effectiveSites`（未抑制并入池的院数）；
2. `effectiveCohortSize = a + b + c + d`（该结局实际入池样本总数），与全局 `cohortSize` 共同保留；
3. `suppressed = suppressedSites > 0 && effectiveSites === 0`（全站抑制时输出 `signal = false`、`signalBcpnn = false`、比值统计量为 `null`，不做 `+0.5` 校正生成虚假 `PRR = 1`）；
4. `partialSuppression = suppressedSites > 0 && effectiveSites > 0`，前端与 `c3-facts.ts` 显著提示「该结果基于 K/N 家未抑制医院计算，存在部分站点小格抑制」。

## D4 Drug-before-Event 时间先后窗、去重与允许无日期策略

- **不改 Wasm ABI**：继续由宿主在 [`projectDisproportionality`](file:///Users/mac/projects/medtrust/apps/connector/src/domain/sandbox/disproportionality-sandbox.ts) 中构造 `(included, exposed, rowTerms)` 送入零能力沙箱；
- **患者/事件去重**：同一患者 `rowTerms[i]` 经 `Set` 去重，确保同一受试者同词条只计 1 次；
- **时间窗过滤规则**：
  - 若目标药存在带 `startDate` 的暴露记录（取匹配药的最早开始日 `minStart`）且不良事件带 `onsetDate`：
    - 默认 `allowSameDay = true`，当 `onsetDate < minStart` 时视为用药前既往事件，不计入暴露不良事件（从该暴露患者的 `rowTerms[i]` 剔除该事件）；
    - 若配置 `temporalWindow.maxDaysAfterStart`（如 30/90 天），超出窗口或晚于 `endDate + maxDaysAfterStart` 的事件亦不计入暴露期事件；
  - **允许无日期回退**：当记录无 `medicationExposures` 或 `onsetDate` 时，默认允许按既往共现口径计算，并输出 `temporalMode: "undated-cooccurrence"`（若全部带日期则为 `"drug-before-event"`，部分带日期为 `"mixed"`）；仅当显式声明 `requireTemporalOrder: true` 时拒绝无日期数据。

## D5 WHO-UMC BCPNN `IC025 / IC975` 与 Evans 双判据并行

依据 Norén 等（2006）收缩对数后验模型：

$$E = \frac{(a+b)(a+c)}{n}, \qquad IC = \log_2 \frac{a + 0.5}{E + 0.5}$$

在后验分布 $\mu \sim \text{Gamma}(\alpha = a + 0.5,\; \beta = E + 0.5)$ 下（等价于 $\text{Gamma}(\alpha, 1) / \beta$），使用纯 TypeScript 实现正则化不完全伽马函数 $P(\alpha, x)$ 并通过牛顿-二分迭代求解分位数 $q_{0.025}$ 与 $q_{0.975}$，得到对任意小样本（含 `a = 0, 1, 2`）数值稳定的精确区间：

$$IC_{025} = \log_2 \frac{q_{0.025}}{E + 0.5}, \qquad IC_{975} = \log_2 \frac{q_{0.975}}{E + 0.5}$$

输出保留 `signal`（Evans：`PRR ≥ 2 && χ² ≥ 4 && a ≥ 3`）确保旧契约不变，并新增 `ic025`、`ic975` 与 `signalBcpnn = ic025 > 0 && a >= 1`。

## D6 `adverse-event-signal` 语义纠偏与参数化容错

- 保留 `"adverse-event-signal"` 与 `/mdop/jobs/ae-signal` 路由/枚举兼容契约，将前端标题与提示修正为「**不良事件器官分布（描述性计数）**」，移出 `outcome` 输入与 `"acute pancreatitis"` 预填；
- `ae-signal.ts` 通过 `params` 向 `seal.ts` 下发药名等价扩展列表与默认器官同义词映射；仅使用默认 12 项器官词典时映射到 `"全身性及其他"` 等对应标准键，调用方显式指定自定义 `categoryKeys` 时仍维持 fail-closed。
