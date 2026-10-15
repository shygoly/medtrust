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

## 两处差异：已闭合（2026-10-14 第二轮）

### 差异 A：按目标药过滤队列 —— **已闭合**

封存投影新增成对的过滤参数（`filterField` + `filterValue`，字段名与值都由行业包给出，基座不写死域词）；
三型模板均暴露可选 `drug` 入参。对拍夹具恢复了一条**不取目标药**的记录（`80-89` 年龄带），
断言它被排除、且旧链与新路径的队列一致。
### 差异 B：分母语义 —— **已闭合**

节点侧随载荷带出 `recordCount`（**过滤后的记录数**），它就是旧链 `cohortSize` 的对应物；收集器同步汇总。
对拍断言三型都满足 `records === old.cohortSize`：

| 型 | `records`（记录数分母） | `rowCount`（分类行数） | 关系 |
|---|---|---|---|
| `cohort-count` | 5 | 5 | 相等（一行一记录） |
| `condition-prevalence` | 5 | 7 | 分类行更多（多标签 + 占位） |
| `adverse-event-signal` | 5 | 3 | 事件行更少（多数记录无事件） |

率用 `recordCount`、分布用 `buckets` —— 两个量各有其用，谁都不会把率算错。

## 结论

三型的**分类计数、分母、队列过滤**三项均与旧链逐字段一致；台账 `equivalenceEvidence` 指向本目录。
**仍保持 `in-migration`**：按本变更任务 2.4，置 `migrated` 前还需 web/入口收敛（旧入口标弃用、新入口落 /space/mdop/jobs）。
