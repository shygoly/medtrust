## Context

阶段 1 之后的现状：

- 任务列表四处：`/space/tasks`（RWS、L4、SecretFlow 混排）、`/space/mdop/jobs`（MDOP 作业，裸表格）、`/space/federated`（SecretFlow，技术视角）、`/space/deliverables`（SecretFlow，使用方视角，以结算行为行集）。另有提供方在 `/space/connectors` 的入站队列，行内跳同一任务详情。
- SecretFlow 详情两处：`federated/[taskId]` 与 `deliverables/[taskId]`，查询同一任务的状态、合并结果、结算。
- `GET /audit`：审计日志页 limit 100 且按输入框逐次服务端过滤；合规告警页 limit 500；合规总览 limit 200。三套 queryKey。
- 清单豁免名单 4 条，全部登记为由本变更消除。
- 根因是后端三条并行编排加一个 MDOP 内核；MDOP 二期会下线旧编排，届时前端适配层随之缩减。

约束：`FLOWS.md` 把 `/space/infer/[taskId]` 登记为 FLOW-RWS-04 的 actor，`TRUST.md` 把它登记为 CTL-13 的强制点；`next.config` 当前无重定向；部署为 standalone。

## Goals / Non-Goals

**Goals:**

- 任务只有一个列表，SecretFlow 任务只有一个详情。
- 审计日志只有一种取数口径。
- 豁免名单清空；被删除的地址全部重定向。

**Non-Goals:**

- **推理页内联**。计划原定把 `/space/infer/[taskId]` 内联进任务详情以"消灭孤儿"。阶段 0、1 已经用清单登记、面包屑和入口链接解决了可达性；现在搬动它需要改写 `FLOWS.md` 的 actor 和 `TRUST.md` CTL-13 的强制点，而用户得不到新东西。保留原页面。
- **L1.5 双通道详情合并**。等 MDOP 二期删旧通道。
- **通用"关联对象"区与 DOMAIN.md 关系对拍**。各类详情的数据形状不同，通用化需要为每类对象写解析器；当前真实的断点只有"账本行不可点"，直接补链接即可。
- 任务列表的时间分面。列表已按时间倒序，现有数据量不需要。
- 任务列表行改用 `ResourceList` 原型、admin 页暗色化（阶段 3）。

## Decisions

### 1. 列表合并用前端薄适配层，纯函数放 `lib/task-list.ts`

统一行模型在现有 `UnifiedOrchestrationListItem` 上加两个字段：通道新增 `mdop`；`myRole` 取 `initiator`（我方发起）、`provider`（分派给本院）或空。适配函数把五个来源（RWS 任务、L4 任务、SecretFlow 任务、MDOP 作业、提供方入站分派）映射成同一行模型，逐来源独立，旧通道下线时删对应函数即可。取数放 `hooks/use-task-list.ts`，入站分派只在角色为 `provider` 时请求。

分面为通道、状态、我方角色三个，写入查询串（`?channel=mdop&status=running&role=provider`），可分享、可回退。解析、筛选、构造链接都是纯函数，单测覆盖。

备选：后端加聚合端点。否决，因为要给三条即将下线的编排写聚合。

### 2. 被删除的列表页用重定向保留地址，映射登记在清单

清单新增 `redirects`，`next.config.ts` 读清单生成 `redirects()`，全部为永久重定向。带 `label` 的重定向同时作为命令面板的跳转命令，旧名称（联邦密算、MDOP 作业、模型交付、合规告警）仍可检索。

| 旧地址 | 新地址 |
|---|---|
| `/space/mdop/jobs` | `/space/tasks?channel=mdop` |
| `/space/federated` | `/space/tasks?channel=secretflow` |
| `/space/deliverables` | `/space/tasks?channel=secretflow` |
| `/space/deliverables/:taskId` | `/space/federated/:taskId?tab=deliverables` |
| `/space/compliance/alerts` | `/space/audit?view=alerts` |

守护新增 N10：重定向源不得仍有页面或清单条目；目标必须落在已登记的路由上；前端源码不得再链接重定向源；`next.config.ts` 必须从清单取重定向。

### 3. 连接器页保留节点状态，入站队列改为摘要加链接

节点状态条和"待拉取 / 执行中"两个指标继续由入站查询计算；表格移除，换成指向 `/space/tasks?role=provider` 的入口。入站行特有的进度与本院结果提示并入统一行的摘要。

### 4. SecretFlow 详情按组合方式合并

`deliverables/[taskId]/page.tsx` 的正文搬到 `components/console/deliverable-detail.tsx`，去掉自带的页头与返回链接。`federated/[taskId]` 增加视图切换（技术视图 / 交付物），写入 `?tab=`；交付物视图只对 `consumer` 出现，且是其默认视图。两个视图内部各自的结算、哈希展示不做进一步去重——它们面向不同受众，深度合并留给 MDOP 二期后的统一详情骨架。

### 5. 审计日志一个 hook、一个 key

`hooks/use-audit-logs.ts` 的 `useAuditLogs(action?)`：固定 limit 500，key 为 `["audit-logs", action]`。审计日志页、告警视图、合规总览都用它；不带 `action` 时三者共享同一份缓存。告警视图是审计日志页的 `?view=alerts`。

### 6. 查询键

`/catalog` 统一为 `["catalog"]` 或 `["catalog", type]`；`/capability/{layer}` 统一为 `["capability", layer]`。只改 key，不抽新 hook。

## Risks / Trade-offs

- 没有真实后端联调：适配函数靠 API 客户端类型和单测保证形状，浏览器走查用桩后端 → 上线前需在预发环境对四类任务各点一遍。
- 提供方的工作队列换了位置 → 连接器页保留计数与显眼入口；任务列表对提供方默认即显示其入站任务。
- 统一行模型比各列表原先的专用列少（联邦密算的 LoRA 哈希列、交付列表的费用列）→ 这些信息在详情页。
- 重定向是永久的，浏览器会缓存 → 映射经守护校验后再上线。
- 演示话术与申报材料截图涉及被合并的页面 → 上线时间与材料提交错开，或上线后重截。

## Migration Plan

纯前端改动，无数据迁移。旧地址经重定向可达。回滚 = 回退提交；已缓存永久重定向的浏览器需清缓存。

## Open Questions

无。
