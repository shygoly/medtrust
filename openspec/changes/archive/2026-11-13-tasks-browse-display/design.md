# Design

## Context

See `proposal.md` Why。统一列表已在 `lib/task-list.ts` + `use-task-list`；MDOP 提交把表单标题写入 `applicant.project`（见 RWS/L4 向导）；`fromMdopJob` 用 `MDOP · purpose`；`mdopBadge` 对未知终态默认 `running`。详情：`/space/tasks/[id]`（RWS/L4）、`/space/mdop/jobs/[id]`、`/space/federated/[id]` 三套页头。P3 正式 `title` 字段不在本变更范围。

## Goals / Non-Goals

**Goals:**

- P0：用户填写的任务标题出现在列表主标题；状态不再误导；MDOP 行不再空洞。
- P1：发起方与时间可读；列表页头完整。
- P2：各通道详情页头/合约侧栏同一契约。

**Non-Goals:**

- 合并路由为单一 `[id]`、删除旧通道、改状态机、新增 DB `title` 列（P3）。

## Decisions

### 1. displayTitle 优先级（P0）

纯函数 `taskDisplayTitle(source)`：

1. MDOP：`applicant.project` 若存在且**不是**占位集合（`rws-l15`、`rws-*` 默认串、`fl-prediction`、空串）→ 用之  
2. 旧 RWS/L4/Inbox：`title` 非空 → 用之  
3. SecretFlow：已有 `SecretFlow · purpose` 逻辑可保留，但若未来有 project 则优先  
4. 否则 `purpose`  
5. 否则 `taskId` / `job.id`

列表 `TaskRow.title` **必须**等于 displayTitle。详情页头 title 同函数。  
占位集合集中维护并单测。

**备选**：立刻加 DB title —— 更好但超 P0；记入后续。

### 2. MDOP 行字段（P0）

扩展 list 使用的 summary 类型：

- `applicantOrg` ← `applicant.org`  
- `displayTitle` 或由前端算  
- `providerCount`：从 `logicalPlan`/`contracts` 可推导则填，否则省略 chip 而非假 0  
- `consumerId` ← `applicant.org`（供角色分面与显示名）

`fromMdopJob` 禁止写死 `consumerId: "—"` 当 org 存在。

### 3. 状态映射（P0）

- 扩展 `mdopBadge`：`purged|closed|published|succeeded|done|completed|merged` → completed（或单独 archived 若 DESIGN 要四态；**默认归 completed**，文案可用「已结束」若需区分可在次要 statusLabel）  
- `failed|rejected|…|partial` → blocked  
- 其余 → running  
- 列表 UI：**只渲染一个** `TaskStatusBadge(badge)`；`statusLabel` 改为次要 mono/tooltip，去掉并排第二枚状态 chip  
- purpose chip：若 `title === purpose` 或 title 已含 purpose，不重复「目的 ·」

### 4. 可读名与时间（P1）

- 发起方：显示名解析（API 附带或共享 helper）；回退 id  
- `createdAt`：本地 `YYYY-MM-DD HH:mm`（DESIGN §6）  
- PageHeader：`title="编排任务"` 或导航 label（补 title）

### 5. 共用详情壳（P2）

抽出 `TaskBrowseHeader`（名可变）：

- props：displayTitle、channelLabel、badge、initiatorLabel、createdAtLabel、contractSummaries[]  
- RWS/L4 shell、MDOP job 页、Federated 页都使用  
- 合约侧栏：优先 purpose/产品短名；id faint  

历史通道：列表对仅旧编排且已迁移类型加 `历史` chip（或 badge 旁注）；详情横幅可保留。

### 6. 与其它 browse change

参与方显示名与 `catalog-browse-display` / `contracts-list-display` 共用模块；本变更可先 id 回退，P1 再接。

## Risks / Trade-offs

- [project 冒充标题语义脏] → P0 可接受；P3 加正式 title；占位过滤降低误用。  
- [PURGED 归 completed 是否合适] → 优于 running；若产品要「已销毁」文案，用次要 statusLabel。  
- [logicalPlan 推 providerCount 脆] → 推不出则隐藏 chip，不显示假 0。

## Migration Plan

无强制数据迁移。回滚 = 回退提交。旧作业无 project 时回退 purpose，行为与今类似但状态更准。

## Open Questions

无。P3（正式 title 字段）不阻塞本变更归档。
