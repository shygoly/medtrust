# L0/L1 三型对拍证据（批次 2 / 2.1·2.2·2.3）

> 可执行证据：`apps/connector/src/mdop/node/l01-equivalence.spec.ts`（3 条，`pnpm --filter @medtrust/connector test -- l01-equivalence` 复跑）。

## 为什么需要这一条

design D6 认定：旧链三型（`cohort-count` / `condition-prevalence` / `adverse-event-signal`）是同一件事 ——
「按某分类字段**计数出现次数**」。现在这件事有**两份实现**：旧链在 `apps/connector/src/domain/rws-executor.ts`
（节点内本地聚合），新路径是「封存投影 -> `categorical-count` 模块 -> 回填」。两份各自改过而另一份没跟上，
迁移前后的数就说不清。所以用**同一组夹具**同时跑两条路，逐字段比。

## 夹具

6 条记录（全部取目标药），刻意包含：

- **重复行**：`lk-1` 两行 —— 去重主体口径（`distinct-count`）会少算，本口径必须各算一次；
- **多标签行**：`lk-2` 带 `糖尿病` + `高血压`（现患一行的多标签各计一次）；
- **无标签行**：`lk-3` / `lk-4` / `lk-5`（现患走占位分类，不是丢弃）；
- **多事件行**：`lk-4` 三起事件分属两个器官系统（不良事件一行多事件各计一次）。

## 结果：分类计数**逐字段一致** ✅

| 型 | 旧链（`rws-executor`） | 新路径（投影 -> 模块 -> 回填） |
|---|---|---|
| `cohort-count` | 40-49:2 / 50-59:2 / 60-69:1 / 70-79:1 | **完全相同** |
| `condition-prevalence` | 糖尿病:3 / 高血压:1 / 无明确慢病标签:3 | **完全相同** |
| `adverse-event-signal` | 肝胆系统:2 / 血液系统:1 | **完全相同** |

`cohort-count` 还额外断言了旧链的派生量 `rate = count / 行数` 可由新路径的 `rowCount` 复现。

## 尚未闭合的两处差异（已在任务册登记，**不当作已一致**）

### 差异 A：没有「按目标药过滤队列」的参数（任务 2.1a）

旧链三型都可选按 `drug` 先过滤队列（`matchesMedication(medications, drug)`）；新路径的模板**没有这个参数**。
本次对拍夹具**全部取目标药**，把这条差异隔离出去 —— 也就是说：上表的"逐字段一致"是在**同队列**前提下成立的。

### 差异 B：分母语义不同（任务 2.2b / 2.3b）

旧链的 `cohortSize` = **队列记录数**（现患/不良事件两型里它是率的分母），新路径的 `rowCount` = **分类行数**：

- `cohort-count`：一行恰好一个分类 -> 两者相等（旧链的 rate 可复现）；
- `condition-prevalence`：一行多标签 -> 分类行数 > 记录数（本次 7 vs 5）；
- `adverse-event-signal`：一行多事件 -> 事件行数 ≠ 记录数（本次 3 vs 6，量纲都不同）。

平台若要复现旧链的 `rate`，节点侧必须把**记录数分母**随载荷一并带出。这一条未做之前，三型**不置** `migrated`。
