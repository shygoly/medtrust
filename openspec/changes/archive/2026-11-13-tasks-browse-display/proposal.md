# Proposal

## Why

`/space/tasks` 已由 `ia-task-surface` 收成统一入口，但浏览仍混乱：表单「任务标题」在 MDOP 路径写入 `applicant.project`，列表却用 `purpose` 当主标题；状态双徽章且 MDOP `PURGED` 等被误判为进行中；MDOP 行丢掉发起方/医院信息；详情按通道拆到不同壳，页头/合约侧栏仍是裸 id。需要按 P0–P2 把**显示标题、状态闭集、行字段、共用详情壳**收成可验收契约，而不推倒多通道实现。

## What Changes

### P0（止血）

- 定义 `displayTitle` 优先级：非占位的 `applicant.project` / 旧通道 `title` → `purpose` → id；列表与 MDOP/联邦详情页头一致使用。
- 扩展 MDOP 列表摘要与 `TaskRow`：带上发起方、可推导的连接器/合约规模；禁止 `consumerId: "—"` 且 `providerCount: 0` 的空洞行（在数据可得时）。
- 修正通道→统一 badge 映射（含 MDOP 终态如 `PURGED`）；列表只保留一个主状态徽章，细状态降为次要文案。
- 去掉与主标题重复的「目的 · purpose」硬刷（目的改次行）。

### P1（可读）

- 发起方显示名（对齐 catalog/contracts 的参与方解析策略）；创建时间本地可读格式。
- 任务列表 PageHeader 补齐 title。

### P2（壳对齐）

- 各通道详情共用同一页头/侧栏信息契约（displayTitle、通道、统一状态、发起方名、时间；合约可读摘要）。
- 路由可暂留 `/space/mdop/jobs/[id]`、`/space/federated/[id]`，但页头组件与字段语义必须一致。
- 旧 RWS/L4 只读历史在列表可识别（如「历史」标记），避免与现行 MDOP 混同。

### 非目标（P3 及以外）

- 不在本变更强制新增 MDOP 独立 `title` 列（可在 design 记为后续；P0 先用 project 回填显示）。
- 不删除旧 RWS/FL API、不重做发起向导、不分页搜索、不内联 SecretFlow YAML 编排。

## Capabilities

### New Capabilities

- `task-browse`: 控制台联邦/编排任务的**浏览呈现**（统一列表行模型的标题与状态、多通道详情页头/侧栏最小信息架构）。不定义作业执行语义（仍归 rws-compute / mdop 等）。

### Modified Capabilities

无。

## Impact

- Web：`lib/task-list.ts`、`hooks/use-task-list.ts`、`space/tasks/page.tsx`、`orchestration-task-detail` 壳、`mdop/jobs/[id]`、`federated/[id]` 页头；可能共享参与方显示名 helper（与 `catalog-browse-display` / `contracts-list-display`）。
- API（推荐）：MDOP jobs list/get 暴露 `applicant`（及足以算 displayTitle 的字段）；不必改作业状态机。
- 治理：`DESIGN.md` 任务 ListCard 与详情壳；单测覆盖 displayTitle 与 mdopBadge。
- 依赖：可与未归档的显示名类 change 共用解析模块；本变更不阻塞于它们（可先 id 回退）。
