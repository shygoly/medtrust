## 1. 角色化工作台

- [x] 1.1 新增 `lib/workbench.ts`（按角色算待办项）与单测
- [x] 1.2 新增 `hooks/use-workbench.ts`；`useAuditLogs` 支持按需启用
- [x] 1.3 新增 `components/console/workbench-panel.tsx` 并挂到 `/space` 顶部

## 2. 跨边界衔接与收尾

- [x] 2.1 `AuthGate` 待分配界面加机构认证入口；认证审核页与用户管理页说明写明上下游
- [x] 2.2 新增 `lib/task-status.ts`，`ui.tsx` 改用，删除 `lib/space-mock.ts`

## 3. atlas 并入 console 设计系统

- [x] 3.1 `console.css` 令牌块改为 `.cs, .codex` 共享；`cs-key` 移入
- [x] 3.2 `atlas.css` 删除 `--at-*`，`.codex` 改为 shadcn → `--cs-*` 适配，专属组件类改名
- [x] 3.3 atlas 4 个页面与 `components/atlas/*` 换用 `cs-*` 类与令牌，页头改 `PageHeader`，布局页边距归位
- [x] 3.4 `check-nav.mjs` 新增禁用 `--at-` 的规则与负例

## 4. 治理与验证

- [x] 4.1 `DESIGN.md`、`REGISTRY.md`、`docs/前端信息架构改进计划.md` 同步
- [x] 4.2 守护、单测、类型检查、lint、`next build`
- [x] 4.3 浏览器走查（暗色主题，对桩后端）：provider / consumer / operator 的待办计数与落点、admin 不显示待办区、待分配界面的两个操作、atlas 四页的标准页头与令牌解析、能力层页的新建对象弹层（portal 内 `--cs-*` 可取到）、落地芯片两种状态。未在真实后端联调
