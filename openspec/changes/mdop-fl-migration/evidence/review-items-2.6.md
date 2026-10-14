# 2.6 三项代码审查条目的落地核对（2026-10-14）

原条目（保留文字）问的是三处「来源是否明确」，逐项核对如下 —— **三项均已在代码里解决**：

| 条目 | 位置 | 结论 |
|---|---|---|
| `l15AnalysisOf` 按 `rws.disproportionality` 阶段取 drug | `mdop-messages.controller.ts:663-678` | ✅ 从**逻辑计划**里找 `op` 以 `rws.disproportionality@` 开头的阶段，读其 `params.drug`；找不到则不带 `drug`（不臆造）。合并阶段与执行阶段因此用**同一个** drug。 |
| 发布审查清单汇总 | `mdop-merge.service.ts:199`（`mergeReleaseManifests(reports.flatMap(...))`） | ✅ 各方清单汇总成同一形状后挂上；此前专门加了「已有清单不覆盖」的分支（收集路径原样带回，重建路径才汇总）。 |
| `expectedNodes` 的参与方集合来源 | `mdop-merge.service.ts:67-88` | ✅ 判据是**阶段声明的输出等级**：只有「产出 C3 的节点」才欠平台一份投递（C2 场景下持有方只做 `source → seal`，按「所有片段节点」收齐会让作业永久卡 RUNNING）；无阶段记录的历史行才退回旧口径「所有片段持有方」。 |

**判据**：三项都以「来源写在代码里 + 注释写明为什么不是另一种取法」为闭合标准；行为侧由既有用例覆盖
（`l4-fl-node-e2e`、`c2-*`、`mdop-merge` 系列），本次核对未改动任何实现。
