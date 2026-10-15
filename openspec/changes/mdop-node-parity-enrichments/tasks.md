# 任务

## 1 计划携带声明
- [x] 1.1 包侧模板：L1.5 模板的**算子阶段**参数纳入 `cohortDefinition` 与 `missingnessDeclaration`（逐字保留策略文本）
      —— 落在算子阶段而非 source/envelope：节点正是在 `runProportionality` 里消费它们（2026-10-15 实现，与连接器参数名一致）；
- [x] 1.2 api 侧通道：`mdop.controller` 把 `body.input` **透传**给模板（模板用 `PlanInputError` 校验）——
      声明由**申请方提交**带入，平台无需另写编译逻辑（2026-10-15 勘明，无需改动）；
      *申请方界面*（web 侧 L1.5 表单）如何录入声明不在本变更范围（且属他人 WIP，不触碰）。

## 2 节点侧应用
- [ ] 2.1 节点取数后、投影前应用队列收窄（复用既有 `passesCohortDefinition` 口径）；
- [ ] 2.2 再应用缺失值处理（复用 `applyMissingness`），并把 `missingnessLog` 挂到聚合；
- [ ] 2.3 本地装配（`wiring/local-*`）与生产装配（`wiring/wire-l15`、节点服务）同步接线；

## 3 对拍与证据
- [ ] 3.1 `cohort-definition-gap.spec` / `missingness.spec` 改指 MDOP 并全绿；
- [ ] 3.2 与 `retained(test-reference)` 逐字段对拍（队列规模、计数、日志字段）；

## 4 之后才能做
- [ ] 4.1 删 `cohort-count` 旧分发（参照函数 + 台账 `retained` + spec 改指）；
- [ ] 4.2 删 `condition-prevalence` 旧分发（其 demo 还需 `mdop-categorical-count-u16`）；
- [ ] 4.3 删 L1.5 连接器侧旧分发（需本变更 + `cmp` 对拍）。
