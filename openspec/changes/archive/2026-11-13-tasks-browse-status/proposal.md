# Proposal

## Why

`tasks-browse-display` 已把任务列表收成统一行模型，但主状态仍是三态（`running` / `completed` / `blocked`），文案「已拦截」与作业语义不符。更严重的是：MDOP `PURGED`（成功、失败、中止后都会进入的销毁终态）被映射为「已完成」，导致失败作业在列表上看成成功。`DESIGN.md` §2 已登记 `failed` / `cancelled`，列表与详情徽章却未对齐。需要把浏览主徽章改成可区分成败的闭集，并单独规定 `PURGED` 的推断规则。

## What Changes

- 统一任务列表与详情页头主徽章改为四态闭集：`running`（进行中）/ `completed`（已完成）/ `failed`（失败）/ `cancelled`（已取消）。
- 列表状态分面与工作台计数同步改用该闭集；弃用列表语义上的 `blocked`→「已拦截」作为作业主徽章（闸门/节点阻断仍可另用既有节点态）。
- 通道映射：
  - 成功终态 → `completed`
  - 执行失败 / 部分失败 → `failed`
  - 中止 / 驳回 / 拒绝 → `cancelled`
  - 进行中与待调度等 → `running`
- `PURGED` **禁止默认**映射为 `completed`：优先用销毁前结果（如仍保留的 `rejectReason`、结果载荷、或显式 outcome 字段）；无法还原时用中性「已销毁」呈现（挂在 `cancelled` 或登记的等价态），次要文案保留原始 `PURGED`。
- 回写 `DESIGN.md` 编排任务浏览段与 `TaskStatusBadge` / `task-status` 标签，使之与 §2 色表一致。
- 单测覆盖：`FAILED`≠已完成；`PURGED`+失败线索≠已完成；`SUCCEEDED`/`PURGED` 成功路径=已完成。

### 非目标

- 不改 MDOP / RWS / SecretFlow 作业状态机或合法迁移表。
- 不强制本期新增后端 `terminalOutcome` 列（若现有字段不足推断，先用保守「已销毁」；可在 design 记可选 API 增强）。
- 不把阶段细态（`RETRYING`、`NEGOTIATING` 等）升为主徽章。
- 不重做任务列表布局或 `displayTitle`（已由 `tasks-browse-display` 覆盖）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `task-browse`: 修正「任务列表状态徽章映射」——由三态改为四态闭集，并明确 `PURGED` 与失败/取消的映射与验收场景。

## Impact

- Web：`lib/task-list.ts`（`TaskBadge` / `mdopBadge` / `STATUS_OPTIONS`）、`lib/orchestration-workloads.ts`（`mapOrchestrationStatus`）、`lib/task-status.ts` + `TaskStatusBadge`、`space/tasks` 分面、`TaskBrowseHeader`、`lib/workbench.ts` / `space-overview` 中依赖 `blocked` 的计数与映射。
- API（可选）：列表/详情若已返回 `rejectReason` 等，前端用于 `PURGED` 推断；仅在不足时再议字段。
- 治理：`DESIGN.md` §2 / 编排任务浏览；`task-list` 与 overview 单测。
- 依赖：假定 `tasks-browse-display` 的行模型与 `TaskBrowseHeader` 已落地（或并行时以本变更覆盖徽章类型）。
