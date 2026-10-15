# 任务

## 1 计划携带声明
- [ ] 1.1 包侧模板：`source.dataset` / `seal.envelope` 阶段纳入 `tte` 与 `missingness` 声明（逐字保留策略文本）；
- [ ] 1.2 api 计划编译：把协议里的 `tte`/`missingness` 写进阶段参数（含 schema 校验与失败文案）；

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
