# Tasks

## 1. 闭集与映射

- [x] 1.1 将 `TaskBadge` / `STATUS_OPTIONS` 改为 `running | completed | failed | cancelled`；更新 `mdopBadge`、`mapOrchestrationStatus`、inbox 映射（按 design D2）；验证 `task-list` / orchestration 相关单测：失败→失败、取消→已取消、成功→已完成
- [x] 1.2 实现 `PURGED` 推断（design D3）：扩展列表摘要以携带 `rejectReason`（若 list API 已有则接线；没有则保守回退）；验证 `PURGED`+失败线索≠已完成、`PURGED` 无线索≠进行中/已完成、`SUCCEEDED` 路径=已完成
- [x] 1.3 旧分面 `?status=blocked` 解析策略（忽略或映到 `failed`）写清并单测；验证新分面四态 URL 往返正确

## 2. UI 与联动

- [x] 2.1 `TaskStatusBadge` / `task-status` 文案与色点对齐四态（失败=red，已取消=amber）；作业列表与 `TaskBrowseHeader` 不再传 `blocked`；验证列表主徽章文案为「失败」「已取消」而非「已拦截」
- [x] 2.2 工作台 `workbench` 计数与链接从 `blocked` 迁到 `failed`（文案同步）；验证工作台「失败」入口落到正确分面
- [x] 2.3 `space-overview` 的 MDOP/任务徽章映射与列表对齐；验证 overview 单测不再把失败销毁当成已完成

## 3. 文档与回归

- [x] 3.1 更新 `DESIGN.md` 编排任务浏览段：四态闭集 + `PURGED` 规则；删除「PURGED→completed」；验证与实现一致
- [x] 3.2 跑相关单测（至少 `task-list`、overview/workbench 若有）；浏览器抽查：失败作业主徽章、PURGED 行、分面筛选；验证无回归 displayTitle / 历史 chip

## Workflow follow-up

- 建议在 `tasks-browse-display` 归档后再归档本变更，以便主规格 `task-browse` 先建立再吸收本 delta；若并行归档，合并时注意状态徽章条款以本变更为准。
- Archive after review；可选后续：API `terminalOutcome` 消除 `PURGED` 推断歧义。
