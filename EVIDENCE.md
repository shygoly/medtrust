# EVIDENCE.md — 研究效度契约（RWS 方法学）

> **机器可校验的研究效度契约**。规范锚点 = 药监《真实世界数据支持药品安全性主动监测的
> 研究设计和分析指导原则》（征求意见稿，下称《指导原则》）+《一般原则》（2025）。
> 校验由 `node scripts/check-meta-docs.mjs` 强制（接入根 `pnpm check:meta`）。
>
> **与 [TRUST.md](./TRUST.md) 的分工（勿混）**：TRUST 管**数据可信**——威胁是泄露、重识别、
> 信任虚标，控制点 `CTL-x`；本册管**结论可信**——威胁是偏倚、混杂、p-hacking、选择性报告，
> 控制点 `EVD-x`。同一个输出闸门在 TRUST 是"防重识别"，在本册不重复登记。
>
> **读者**：药物流行病学 / PV 岗 / 申办方统计师；改任何 RWS 任务规格字段
> （`TteSpec` / `RwsAnalysis`）前必读 §1 覆盖矩阵对应行。
> **命名空间**：`EVD-x`（本册）与 `CTL-x`（TRUST）/ `INV-x`（DOMAIN）/ `D-x`（DECISIONS）
> / `FLOW-x` / `TD-x` 正交。定义与量纲（时间窗、方法值域）的唯一出处在
> [DOMAIN.md](./DOMAIN.md)·派生公式与单位约定，本册只管**约束**，不重复定义。

---

## 1. 要素覆盖矩阵（《指导原则》要素 ↔ 代码承载）

规范要求的研究设计要素与本仓字段的对应关系。**checker 强制**：`承载字段` 非 `—` 时，
该字段必须在 `apps/connector/src/domain/types.ts` 中检索得到；`—` 必须配 `缺口`。
状态值域：`已承载` | `部分承载` | `缺口`。

| # | 规范要素 | 章节 | 承载字段 | 状态 |
|---|---|---|---|---|
| 1 | 零时刻（进入队列时点） | §2.6 | `TteSpec.timeZeroRule` | 已承载 |
| 2 | 暴露组 / 对照组 | §2.7.1 | `TteSpec.exposureArm` / `TteSpec.comparatorArm` | 已承载 |
| 3 | 宽限期（grace period） | §2.7.2 | `TteSpec.graceDays` | 已承载 |
| 4 | 洗脱期 / 回顾期（新用药识别） | §2.7.2 | `TteSpec.washoutDays` | 已承载 |
| 5 | 删失机制 | §2.7.3 | `TteOutcomeSpec.censoring` | 已承载 |
| 6 | 安全性结局定义 | §2.7.4 | `TteOutcomeSpec.event` | 部分承载 |
| 7 | 纳入 / 排除标准 | §2.6 | `TteSpec.inclusion` / `TteSpec.exclusion` | 部分承载 |
| 8 | 协变量 | §2.7.5 | `TteSpec.matchingCovariates` | 部分承载 |
| 9 | 分析产物范围（预先指定） | §3.1 | `RwsAnalysis.allowedArtifacts` | 已承载 |
| 10 | 混杂控制方法 | §3.3 | `RwsAnalysis.method`（`CausalMethod`） | 部分承载 |
| 11 | 编码列表 / 识别算法 | §2.1·§2.6 | `RwsAnalysis.algorithm`（`IdentificationAlgorithm` + `CodeSet`） | 已承载 |
| 12 | 算法准确性指标（灵敏度·特异度） | §2.6·§2.7.4 | `ValidationMetrics.sensitivity`（Se/Sp/PPV/NPV + 95%CI） | 已承载 |
| 13 | 流行病学设计类型及选型理由 | §2.5 | `RwsAnalysis.designType`（六值封闭集 + `RwsAnalysis.rationale`，Phase 2 起全局必填） | 已承载 |
| 14 | 诱导期 / 滞后期 | §2.7.2 | — | 缺口 |
| 15 | 随访窗口上下界 | §2.7.3 | — | 缺口 |
| 16 | 统计分析计划（SAP） | §3.1 | `RwsAnalysis.sap`（`SapPlan`，Phase 2 起 L2/L3/L4 必填） | 已承载 |
| 17 | 样本量与检验效能假设 | §3.2 | `SapPlan.sampleSizeAssumption`（+ `SapPlan.power`） | 已承载 |
| 18 | 多重性 α 校正 | §3.1 | `SapPlan.multiplicityAlphaAdjustment`（Phase 2 起多重比较时必填） | 已承载 |
| 19 | 缺失值机制与填补策略 | §3.4 | `RwsAnalysis.missingness`（`MissingnessDeclaration`） | 部分承载 |
| 20 | 敏感性分析 | §3.5 | `RwsAnalysis.sensitivityAnalyses`（`SensitivityAnalysisDeclaration` + 回传对账 EVD-10） | 已承载 |
| 21 | 方案版本留痕（版本号+日期+内容+原因） | §1.2 | `RwsTaskEntity.protocolVersion`（+ `revisionReason` / `revisedAt`，Phase 3 `/revise` 端点） | 已承载 |

**部分承载**的四条口径（为何不算已承载）：
- 第 6 项：`event` 是自由文本事件名；`IdentificationAlgorithm`（EVD-05）已可作为结局操作性定义的载体，
  但 `TteOutcomeSpec.event` 字段本身未要求或未引用算法——两种形式并存，自由文本仍被接受（rws-study-protocol-spec 定强制时点）。
- 第 7 项：`inclusion[]` / `exclusion[]` 是自由文本，操作性定义载体已存在（EVD-05）但未在该字段强制引用。
- 第 8 项：协变量平铺为字符串数组，无类型区分（时依混杂 / 中介 / 效应修饰 / 碰撞），无 DAG 结构。
- 第 10 项：值域仅 `psm | iptw | cox`，规范表3 的 IV / G 方法 / Poisson·负二项 / SEM 均无实现。

**测试数据注（D-DATA-1）**：`data/rws-test-data/` 中的编码错分（Se/Sp）是 TS 注入层**故意注入的 faithful 噪声**，
不是真实 EHR 编码误差的估计。L0 / 阶梯 e2e 对拍的是 answer-key 注入值（复原管道）；演示产出的 Se/Sp、
观测 OR **不得**当作真实流行病学精度或监管申报证据（见 TRUST CTL-12）。观测 OR < 注入 HR 是非差异错分向零衰减，属正确现象。
> FL 演示模型（pancreatitis-risk FedAvg LR）若 `trainedOnSynthetic=true`，其 AUC/风险分同样受 CTL-12 约束，MUST NOT 用于监管申报或临床决策。


---

## 2. 效度控制点登记（EVD-x）

```yaml evidence
id: EVD-01
title: 分析产物预先指定，出域前经 PEP 白名单强制
norm: [指导原则 §3.1 SAP 事先制订, TC609-6-2025-15 使用控制, D4]
risk: 事后扩大输出范围以捞取"阳性"产物（选择性报告的一种形态）
enforcement:
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
  - ts:apps/connector/src/domain/types.ts#RwsArtifactKind
spec: apps/connector/src/domain/policy-enforcement.spec.ts
```

```yaml evidence
id: EVD-02
title: 因果方法值域封闭，新增方法必须同步登记
norm: [指导原则 §3.3 表3 须说明所选方法的假设与局限性, 附1]
risk: 方法随意替换而不声明假设与局限，结论适用边界失控
enforcement:
  - ts:apps/connector/src/domain/types.ts#CausalMethod
  - ts:apps/connector/src/domain/causal/causal-executor.ts
spec: apps/connector/src/domain/causal/causal-executor.spec.ts
```

```yaml evidence
id: EVD-03
title: 研究设计要素以 TteSpec 为唯一载体，要素覆盖矩阵机检
norm: [指导原则 §2.2 目标试验模拟框架, §2.6-2.7 关键变量定义]
risk: spec 字段悄悄增删导致规范要素静默丢失（无人察觉的设计退化）
enforcement:
  - ts:apps/connector/src/domain/types.ts#TteSpec
  - ext:scripts/check-meta-docs.mjs（§1 覆盖矩阵 ↔ types.ts 对拍）
spec: apps/connector/src/domain/rws-analytics-ladder-scenarios.spec.ts
```

```yaml evidence
id: EVD-04
title: L3 结论表述不得声称已控制全部混杂
norm: [指导原则 附1·2 倾向评分仅能处理可观测混杂, §3.5 残余混杂须敏感性分析]
risk: 把"已调整可观测混杂"表述为"已控制混杂"，因果强度虚标（与 D-RWS-4 的 TEE 虚标同类）
enforcement:
  - ext:DOMAIN.md·派生公式与单位约定（统计方法值域与选型·边界约束句）
  - ext:人工评审（UI / 报告 / 对外材料文案）
spec: TODO
```

```yaml evidence
id: EVD-05
title: 变量识别算法的准确性指标经 L0 验证产出，混淆矩阵任一格被抑制则全部指标不出域
norm: [指导原则 §2.1 概念性/操作性定义, §2.6 报告编码/算法准确性, §2.7.4 结局定义四要素, §2.8 错分偏倚以算法验证为首要控制措施]
risk: 用未经验证或样本量不足的识别算法直接产出研究结论，错分偏倚不可评估（规范最硬要求之一）；小格残留诱导使用者用残缺矩阵做整体判断
enforcement:
  - ts:apps/connector/src/domain/algorithm-validation/confusion-matrix.ts#computeConfusionMatrixInTee
  - ts:apps/connector/src/domain/output-gate.ts#passValidation
  - ts:apps/connector/src/domain/algorithm-validation/grammar-validator.ts#validateAlgorithmGrammar
  - ts:apps/connector/src/domain/algorithm-validation/synthetic-gold-standard.ts#goldFromInjectedTruth
  - ts:apps/connector/src/domain/algorithm-validation/synthetic-gold-standard.ts#resolveGoldStandard
  - ext:DOMAIN.md·派生公式与单位约定（Se/Sp/PPV/NPV + Wilson score interval 唯一出处）
spec: apps/connector/src/testdata/injected-ladder-e2e.spec.ts
note: |
  测试路径（D-DATA-1）：L0 金标准 = 注入真值 `truePancreatitis`（`goldFromInjectedTruth` /
  `truth.json`），对拍 answer-key 注入 Se/Sp；非 flip 占位标签。§1 注明测试错分是注入的
  faithful 噪声。生产路径仍用医院本地金标准库（`local_gold_standard`）。
```

```yaml evidence
id: EVD-06
title: 结局定义与暴露定义的编码集无交集（§2.7.4 硬红线）；自由文本路径降级为警告
norm: [指导原则 §2.7.4 药品暴露不应作为结局定义的组成部分, §2.8 信息偏倚]
risk: 把"用药后某事件"作为结局，循环论证——暴露本身就是结局的一部分，效应量被构造而非发现
enforcement:
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#validateRwsAnalysisLadder
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#computeProtocolWarnings
spec: apps/api/src/compute-task/dto/rws-study-protocol.spec.ts
note: |
  rws-study-protocol-spec Phase 1 落地：结构化 `outcomeAlgorithm` × `exposureAlgorithm`/
  `comparatorAlgorithm` 编码集交集检查 fail-closed；自由文本路径（无 algorithm 引用）
  通过 `computeProtocolWarnings` 在任务记录上标记「独立性未校验」但不阻断。完全生效
  （自由文本路径亦阻断）依赖 Phase 2 将结构化引用转必填。
```

```yaml evidence
id: EVD-07
title: 倾向评分变量（matchingCovariates）与 allowedArtifacts 在派发后冻结
norm: [指导原则 §3.1 SAP 事先制订, 附1·2 预先指明 PS 变量避免反复调参]
risk: 看到数据后反复调整倾向评分模型以获得"理想"结果（p-hacking 的隐形形态）
enforcement:
  - ts:packages/database/src/control-plane/index.ts#frozenAt
  - ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#RwsOrchestratorService
spec: apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.spec.ts
note: |
  rws-study-protocol-spec Phase 3 已落地：pullPending 首次派发（pending → running）
  时写 frozenAt（幂等，re-dispatch 不覆盖）；冻结后任何冻结集字段变更只能经
  POST /rws/tasks/:id/revise 创建新版本，且必须带 revisionReason。非冻结字段
  （标题、目标参与方列表）派发后仍可改，不产生新版本。
```

```yaml evidence
id: EVD-08
title: 研究方案版本化留痕（版本号 + 修订原因 + 修订时间）
norm: [指导原则 §1 方案先行, §1.2 任何实质性修改须留痕]
risk: 方案静默变更，研究记录不可追溯；事后调整分析以迎合结果无法被发现
enforcement:
  - ts:packages/database/src/control-plane/index.ts#protocolVersion
  - ts:packages/database/src/control-plane/index.ts#revisionReason
  - ts:packages/database/src/control-plane/index.ts#revisedAt
  - ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#revise
spec: apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.spec.ts
note: |
  rws-study-protocol-spec Phase 3 已落地：初始提交 protocolVersion=1；POST
  /rws/tasks/:id/revise 创建新版本（protocolVersion+1，必填 revisionReason，frozenAt
  重置，旧 assignment 丢弃重排）。越权（非任务发起方）修订被拒。
```

```yaml evidence
id: EVD-09
title: 统计分析计划（SAP）声明——显著性水平 / 检验效能 / 样本量假设 / 多重性校正
norm: [指导原则 §3.1 SAP 事先制订, §3.2 样本量与检验效能, §3.1 多重性 α 校正]
risk: 事后调整统计策略以获得显著结果；多重比较不做校正导致假阳性率失控
enforcement:
  - ts:apps/connector/src/domain/types.ts#SapPlan
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#validateRwsAnalysisLadder
spec: apps/api/src/compute-task/dto/rws-study-protocol.spec.ts
note: |
  rws-study-protocol-spec Phase 2 已落地：SapPlan 字段 + 形状校验（α∈(0,1)、
  power∈(0,1)、样本量正有限）+ 按层级必填（D4：L2/L3/L4 必填，L1.5 单组合豁免，
  多组合须声明 multiplicityAlphaAdjustment）。
```

```yaml evidence
id: EVD-10
title: 敏感性分析全报——声明项与回传项的集合对账，缺项不出具
norm: [指导原则 §3.5 完整报告所有敏感性分析结果, 不一致时须探讨原因]
risk: 选择性省略与主分析不一致的敏感性分析，是最隐蔽的报告偏倚
enforcement:
  - ts:apps/connector/src/domain/types.ts#SensitivityAnalysisDeclaration
  - ts:apps/connector/src/domain/types.ts#SensitivityAnalysisResult
  - ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#reconcileSensitivityAnalyses
spec: apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.spec.ts
note: |
  2026-08-08：敏感性分析执行器尚未接线。validateRwsAnalysisLadder 对非空
  sensitivityAnalyses 直接拒收（EVD-10 fail-closed）；控制台表单禁用声明入口。
  completeAssignment 中 reconcileSensitivityAnalyses 对账闸仍保留，作为执行器
  接线后的第二道闸（声明项 vs sensitivityResults[].id，缺项则 failed + merged=null）。
  未声明敏感性分析的任务豁免（§5.2）。
```

```yaml evidence
id: EVD-11
title: 缺失值机制假设（MCAR/MAR/MNAR）与填补策略必须同时声明
norm: [指导原则 §3.4 缺失值处理]
risk: 只声明填补方法而不交代机制假设，无法判断填补是否恰当（不同机制下同一方法可能引入偏倚）
enforcement:
  - ts:apps/connector/src/domain/types.ts#MissingnessDeclaration
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#validateRwsAnalysisLadder
spec: apps/api/src/compute-task/dto/rws-study-protocol.spec.ts
note: |
  rws-study-protocol-spec Phase 1 落地（机制 + 策略配对校验已启用：只声明其一即拒）。
  missingness 本身未按层级转必填——继续作为可选声明字段，由 computeProtocolWarnings
  在缺失时发出告警（非阻断）。
```

```yaml evidence
id: EVD-12
title: 流行病学设计类型显式化（六值封闭集）+ 选型理由必填；系统不内置优劣排序
norm: [指导原则 §2.5 不推荐认定某设计一定优于其他]
risk: 设计类型含糊或事后变更；系统隐式引导某种设计而抑制对真正适配研究问题的选型
enforcement:
  - ts:apps/connector/src/domain/types.ts#RwsDesignType
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#RWS_DESIGN_TYPES
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#validateRwsAnalysisLadder
spec: apps/api/src/compute-task/dto/rws-study-protocol.spec.ts
note: |
  rws-study-protocol-spec Phase 2 已落地：designType 六值封闭集 + rationale 配对校验
  （选了 design 就必须说理由）+ 全局必填（algorithm-validation L0 例外，因其是验证
  而非研究）。系统不内置任何设计类型的优劣排序（§2.5）。
```

---

## 3. 待接入效度控制点（规格超前于代码）

《指导原则》要求、但当前**无字段或无强制点**因而写不出守护方式的条目。按硬度红线，
它们不进 §2 正册；接入后移入并补 enforcement。

| # | 缺口 | 规范锚点 | 现状 | 接入点 |
|---|---|---|---|---|
| ~~P-EVD-1~~ | ~~结局定义独立于暴露~~ | §2.7.4 硬要求 | **部分落地（2026-07-22）→ 移入正册 EVD-06**（结构化 algorithm 引用做编码集交集校验；自由文本降级警告） | — |
| ~~P-EVD-2~~ | ~~变量识别算法准确性指标随结果报告~~ | §2.6·§2.7.4 | **已落地（2026-07-21）→ 移入正册 EVD-05**（L0 验证层：`IdentificationAlgorithm` + `ValidationMetrics` + 混淆矩阵 fail-closed 闸门） | — |
| ~~P-EVD-3~~ | ~~倾向评分变量预先指定且锁定~~ | 附1·2 监管要点 | **已落地（2026-07-22）→ EVD-07**（Phase 3：pullPending 首次派发写 frozenAt；冻结后修改只能经 /revise 开新版本） | — |
| ~~P-EVD-4~~ | ~~方案版本留痕~~ | §1.2 | **已落地（2026-07-22）→ EVD-08**（Phase 3：protocolVersion+1，必填 revisionReason，POST /rws/tasks/:id/revise） | — |
| ~~P-EVD-5~~ | ~~SAP：α 校正 / 效能 / 样本量假设~~ | §3.1·§3.2 | **已落地（2026-07-22）→ EVD-09**（Phase 2：L2/L3/L4 必填；L1.5 单组合豁免；多组合须声明 α 校正） | — |
| ~~P-EVD-6~~ | ~~敏感性分析结果必须全报~~ | §3.5 | **已落地（2026-07-23）→ EVD-10**（声明字段 + 回传对账 fail-closed + 合并产物携带全部结果） | — |
| ~~P-EVD-7~~ | ~~缺失值机制与填补策略声明~~ | §3.4 | **部分落地（2026-07-22）→ EVD-11**（MissingnessDeclaration + 配对校验已启用；missingness 未按层级转必填，仅告警） | — |
| ~~P-EVD-8~~ | ~~流行病学设计类型与选型理由~~ | §2.5 | **已落地（2026-07-22）→ EVD-12**（Phase 2：designType 六值封闭集 + rationale 全局必填；L0 algorithm-validation 例外） | — |
| P-EVD-9 | 阴性结果须重审检验效能 | §3.2 | 无流程 | 结果出具环节的评审项 |
| P-EVD-10 | LLM 生成的方案草稿须有人类署名后方可冻结 | §1 方案先行 · §3.1 预先设定 | 助手已能产出 spec 草稿（FLOW-AI-01），但草稿与人工方案在系统中无区分；LLM 幻觉的参与方/数据产品/统计方法可能被直接提交 | 草稿标记 `authoredBy: llm-draft`；冻结（rws-study-protocol-spec D1）前必须转为人类署名，且 assumptions/warnings 必须被显式确认 |
| ~~P-EVD-11~~ | PSM 匹配策略（层内 / 跨层）须由分析计划预先声明，平台按声明校验 | 3.1 SAP 事先制订  附12 倾向评分方法须预先指明 | **已落地（2026-10-15） D-RWS-10**：① 字段 `RwsAnalysisSpec.matchingStrategy` 封闭枚举（`within-stratum` / `cross-stratum-nearest`），L3 因果（causal-psm / causal-survival）必填、非 L3 给了即拒；② `validateRwsAnalysisLadder` 按迁移台账通道的实际配对行为校验声明值（mdop=层内 / legacy=跨层），不一致即拒（400）；③ MDOP 计划入口（jobs/causal-psm、jobs/causal-survival）在行业包模板内要求并单值化（只收层内策略，基座不放领域校验）；④ RWS 新建页 L3 控件（无默认值，用户显式选；文案说明两者不是同一估计量、策略派发后冻结）；⑤ 历史载荷经 `resolveMatchingStrategy` 解析为 `cross-stratum-nearest`（如实标注旧链口径，不追认为层内配对）；⑥ 权威处 `apps/api/src/compute-task/dto/rws-analysis-spec.ts`，镜像 `apps/api/src/runtime/rws-orchestrator/types.ts`、`apps/connector/src/domain/types.ts`、`apps/web/src/lib/rws-protocol-schema.ts`（zod，且该字段进 FROZEN_FIELDS）+ NestJS DTO 白名单 `apps/api/src/runtime/rws-orchestrator/dto/orchestrate-rws-task.dto.ts`；用例：`rws-study-protocol.spec.ts`、`mdop/causal-psm-plan.spec.ts`、`mdop/causal-survival-plan.spec.ts`、`rws-protocol-schema.test.ts` | RWS 表单未覆盖 C2/节点内场景（paired-cohort / vaccine-scri / ve-tnd / dedup-incidence / external-control 走 MDOP 作业通道） |

---

## 4. 值域预登记（封闭集）

rws-study-protocol-spec Phase 1 已将下列值域实装为 `RwsDesignType`
（`apps/api/src/compute-task/dto/rws-analysis-spec.ts#RWS_DESIGN_TYPES`）；
`MissingnessMechanism` 同步实装。

**流行病学设计类型**（《指导原则》表1，六选一 + 必填理由）：
`cross-sectional`（横断面）| `cohort`（队列）| `case-control`（病例对照）|
`nested-case-control`（巢式病例对照）| `case-cohort`（病例队列）| `case-crossover`（病例交叉）

选型原则（规范明示）：**不推荐认定某设计一定优于其他**；按研究问题与"药品—事件"关联假设
（急性发作 vs 迟发事件）选择。数据可及性受限时，巢式病例对照可取得接近队列的因果推断效力。

**用药设计**：`new-user`（推荐，控幸存者偏倚）| `prevalent-user`（须说明理由与影响）
**对照类型**：`active`（首选：同适应证临床公认替代治疗）| `none` | `historical` | `self`

---

## 5. 偏倚 × 控制措施 × 本仓状态（《指导原则》§2.8）

| 偏倚 | 规范控制措施 | 本仓状态 |
|---|---|---|
| **选择偏倚** | 新用药者设计；避免低特异度编码单独入组 | 部分：`washoutDays` 可表达新用药；编码算法已承载（EVD-05），但选择偏倚与编码准确性的联动分析未实现 |
| **信息 / 错分偏倚** | ①算法验证研究 ②定量偏倚分析 ③不同定义做敏感性分析 | 部分：①已承载（EVD-05，L0；测试路径以注入真值金标准对拍，D-DATA-1）；②③缺口（P-EVD-6） |
| **混杂偏倚** | DAG 识别；PS / IV / G 方法按混杂结构选型 | 部分：PS 系列已实现；DAG、IV、G 方法缺口（EVD-02 值域表） |
| **不死时间偏倚** | 目标试验模拟框架 + 明确零时刻 | 已承载：`timeZeroRule`（EVD-03） |

---

## 附录：格式契约

check-meta-docs.mjs 按以下契约解析本文件：

1. **evidence 块**：围栏 info-string 恰为 `yaml evidence`。必填字段 `id` / `title` / `norm` /
   `risk` / `enforcement` / `spec`。
2. **id 格式**：`EVD-<NN>`，全册唯一。
3. **enforcement token**：同 DOMAIN / TRUST 的强制点 token 语法
   （`ts:路径#符号` | `py:路径` | `ext:说明` | `none`）；`ts:` 做符号级存在性校验。
4. **spec**：相对仓根的测试路径；`TODO` 降级为 warning。
5. **§1 覆盖矩阵**：表头恰为 `| # | 规范要素 | 章节 | 承载字段 | 状态 |`。
   `承载字段` 中形如 `TteSpec.xxx` / `TteOutcomeSpec.xxx` / `RwsAnalysis.xxx` 的引用，
   字段名须在 `apps/connector/src/domain/types.ts` 中检索得到；`—` 必须配状态 `缺口`；
   状态只许 `已承载` | `部分承载` | `缺口`。
6. **待接入表（§3）不校验**（规格超前于代码的登记，非契约）；接入后条目移入 §2 并补 enforcement。
