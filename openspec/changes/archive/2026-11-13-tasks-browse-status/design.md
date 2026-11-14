# Design

## Context

See proposal.md — Why。现状：`TaskBadge = running | completed | blocked`；`mdopBadge` 将 `PURGED`/`CLOSED` 收成 `completed`；`TaskStatusBadge` 文案 `blocked`→「已拦截」；工作台 `workbench.ts` / `space-overview.ts` 仍按 `blocked` 计数。MDOP 作业机（`packages/mdop` `JOB_TRANSITIONS`）：`SUCCEEDED`/`FAILED`/`ABORTED` → `PURGED`；`cp_mdop_job.rejectReason` 在失败/拒绝路径会写入且列保留。`DESIGN.md` §2 已有 `failed`/`cancelled` 色表，与列表三态脱节。

## Goals / Non-Goals

**Goals:**

- 前端浏览闭集与映射表单一事实源（`task-list` + 与 overview 对齐），列表/详情/分面/工作台计数一致。
- `PURGED` 推断可测、可回退；成功销毁仍显示已完成，失败销毁不冒充成功。
- 徽章文案与 `DESIGN.md` §2 对齐。

**Non-Goals:**

- 不改作业状态机、不强制新 DB 列（可选后续 `terminalOutcome`）。
- 不扩展阶段级主徽章。
- 不改 `displayTitle` / 历史 chip / 详情壳布局（仅徽章类型与文案）。

## Decisions

### D1 — 四态闭集，弃用列表 `blocked`

| 键 | 文案 | §2 色 |
|----|------|-------|
| `running` | 进行中 | cyan |
| `completed` | 已完成 | green |
| `failed` | 失败 | red |
| `cancelled` | 已取消 | amber |

**替代案**：保留 `blocked` 兼指失败+闸门 → 否决（与用户看到的「失败却像已完成/已拦截」冲突）。闸门语义留在节点态 / 次要文案。

`TaskStatus` / `TaskStatusBadge`：作业浏览路径改用上述四态；若全局 `TaskStatus` 仍含 `draft`/`awaiting-auth`/`blocked`，作业列表与详情 MUST 不再把作业主徽章打成 `blocked`。

### D2 — 通道映射表（实现落点）

- **MDOP `mdopBadge(job)`**  
  - `SUCCEEDED` → `completed`  
  - `FAILED` → `failed`  
  - `ABORTED` | `REJECTED` → `cancelled`  
  - `SUBMITTED`…`RELEASING`（及未知进行态）→ `running`  
  - `PURGED` → 见 D3  
  - 去掉把 `closed`/`purged` 一律当 `completed` 的规则

- **`mapOrchestrationStatus`（RWS/L4/SF 共用）**  
  - `completed` / `COMPLETED` → `completed`  
  - `failed` / `FAILED` / `partial` → `failed`  
  - `refused` / `REFUSED` / `cancelled` / `aborted` → `cancelled`  
  - 其余 → `running`

- **入站 inbox**：`failed` → `failed`；其余保持 completed/running，不把失败折成 blocked。

### D3 — `PURGED` 推断顺序

1. 非空 `rejectReason` → `failed`（含 `REJECT`/`ABORT`/`取消` 等 → `cancelled`）。  
2. 显式 `hasResult === false` → `cancelled`（反证非成功）。  
3. 否则（无原因，或 `hasResult === true`/未提供）→ `completed`。  
   依据：控制面失败/中止进 `PURGED` 前会写 `rejectReason`；成功销毁通常为空（例：`job-mwee2lv4` 全阶段 SUCCEEDED 后 PURGED 且无原因）。

列表摘要类型携带 `rejectReason`（`MdopJobSummary` + `listMdopJobs`）。

**替代案**：`PURGED` 单独第五态 → 首版不采用。无原因默认 `cancelled` 已否决（会把走完的成功作业标成已取消）。

### D4 — 联动面

- `STATUS_OPTIONS`、分面 URL、`filterTaskRows`  
- `workbench`：`mine-blocked` / `inbound-blocked` → 按 `failed`（+ 可选合计 `cancelled`）重命名文案与 href  
- `space-overview` 本地 `mdopBadge` 与任务列表对齐（`PURGED` 不再 `null` 或误 completed，按 D3）  
- `DESIGN.md` 编排任务浏览段：四态 + PURGED 规则；删除「PURGED→completed」句

### D5 — 兼容

旧书签 `?status=blocked`：解析时忽略或映射为 `failed`（实现选一种并单测）；新链接只写四态。

## Risks / Trade-offs

- [Risk] `PURGED` 且无 `rejectReason`、无结果的成功作业被标成「已销毁/已取消」→ Mitigation：步骤 3 用结果载荷；可选后续 API 写 `terminalOutcome`。  
- [Risk] 工作台「受阻」合并了失败与取消，拆开后计数变少 → Mitigation：文案改为「失败的任务」，取消可另计或次期加。  
- [Risk] `TaskStatusBadge` 全局类型与作业四态并存 → Mitigation：扩展联合类型或作业路径专用映射，禁止作业再传 `blocked`。

## Migration Plan

1. 改映射与类型 → 单测绿。  
2. 改列表分面、详情壳、工作台、overview。  
3. 更新 DESIGN。  
4. 无需 DB 迁移；回滚即恢复三态映射（纯前端）。

## Open Questions

- 是否在本期为 `PURGED` 增加独立显示文案「已销毁」（键仍 `cancelled`）——默认 **是**（仅当走 D3 步骤 4）。  
- `rejectReason` 是否已在 list 接口返回——实现时核对；若无则 get 详情不进列表推断，列表走步骤 4，或小补 list DTO。
