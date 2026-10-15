# 设计：节点的分析/证据侧等价性

## D1 声明怎么进计划

- `tte` 与 `missingness` 都是**申请方在协议里声明**的（`TteSpec` / `MissingnessDeclaration`）；
- 平台编译计划时写进 `source.dataset` / `seal.envelope` 阶段的 `params`（与既有 `cohort`、`filterField` 同层），
  保持「计划即契约」：节点只按计划执行，不从任务消息另辟通道；
- 缺失值声明**逐字**保留原文本（`imputationStrategy`），供节点侧分类并与 SAP 对账。

## D2 在哪一步应用

顺序必须是**先声明处理、后投影**（与旧链一致）：取数 → 队列收窄（tte）→ 缺失值处理 → 投影 → 计数 → 降密。
封存纪律不变：行只在节点内部回调里可见，出域的只有聚合与证据字段。

## D3 日志与证据字段

| 字段 | 来源 | 强制性 |
|---|---|---|
| `missingnessLog` | 缺失值处理 | **spec 强制**（`missingness.spec.ts`）|
| `dataAudit` / `qualityReport` / `warnings` | 逐变量审计 | **spec 强制**（`data-audit-gap.spec.ts`，已移植）|
| 队列规模变化 | tte 收窄 | 对拍项（`cohort-definition-gap.spec.ts`）|

## D4 对拍与红线

- 与旧实现（`retained: test-reference`）逐字段对拍：队列规模、各分类计数、`missingnessLog.mechanism/appliedStrategy`；
- 红线：**不得静默把「多重插补」退化成完全病例** —— 日志的 `appliedStrategy` 必须与声明一致（既有 spec 已把这条写进断言）；
- 缺声明时行为**一字不变**（不产日志、不处理）—— 与旧链同。

## D5 完成判据

1. `cohort-definition-gap.spec` 改指 MDOP 后仍断言 `cohortSize=1`（队列被收窄）；
2. `missingness.spec` 的三个断言在 MDOP 路径下全绿；
3. 之后才可逐型删连接器侧旧分发（先 `cohort-count`，再 `condition-prevalence`，最后 L1.5）。
