## Why

前三个阶段把导航的结构理顺了，但还剩三件事：首页对所有角色显示同一份总览，回答不了"我现在该处理什么"；能力图谱（atlas）仍带着一套与 console 平行的 `--at-*` 令牌和自造页头，违反 `DESIGN.md §9.5`；注册用户在"待分配角色"界面没有去处。本变更是 `docs/前端信息架构改进计划.md` 的阶段 3。

## What Changes

- **角色化工作台**：`/space` 顶部新增按角色生成的待办区，每项是一个计数加一个直达链接（指向带分面的任务列表、合约页、告警视图、RBQM、认证审核）。原有总览内容保留在下方。
- **atlas 并入 console 设计系统**：删除全部 `--at-*` 令牌与 `at-*` 类；`.codex` 只保留 shadcn 令牌到 `--cs-*` 的适配；4 个 atlas 页改用 `PageHeader`。
- **跨边界衔接**：待分配角色界面给出前往机构认证页的入口；机构认证审核与用户管理的说明互相指明上下游。
- 收尾：`components/console/ui.tsx` 脱离 `lib/space-mock`，删除该文件。
- **不做**：admin 五个页面的正文暗色化（见 design）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities
- `console-navigation`: 新增角色化待办、单一设计语言、待分配角色用户去向的要求（该能力由未归档的 `ia-nav-contract` 引入，本变更只做 ADDED）。

## Impact

- 前端：`lib/{workbench,task-status}.ts`、`hooks/{use-workbench,use-audit-logs}.ts`、`components/console/{workbench-panel,ui,auth-gate}.tsx`、`(console)/console.css`、`(console)/space/page.tsx`、`(console)/space/atlas/**`、`components/atlas/**`、`admin/{certifications,users}` 的说明文案；删除 `lib/space-mock.ts`。
- 脚本：`scripts/check-nav.mjs` 新增对 `--at-*` 的禁用规则。
- 治理文档：`DESIGN.md`、`REGISTRY.md`、`docs/前端信息架构改进计划.md`。
- 后端：无改动。
- 用户可见变化：首页顶部多出待办区；atlas 四个页面的页头变为标准页头（原来的大号展示标题取消）。
