## Why

控制台导航没有单一事实源，也没有守护：菜单写死在 `space-nav.tsx`，路由、角色门控、流程契约各管各的。审计（`docs/前端信息架构审计与导航重构提案.md`）查出的孤儿页、门控四种写法并存、菜单比服务端严、总览是 mock、提交后跳错详情等问题，都是这一根因的症状。本变更是 `docs/前端信息架构改进计划.md` 的阶段 0：先立契约与守护，再把现存问题修绿。

## What Changes

- 新增导航清单 `apps/web/src/nav.manifest.json`，登记控制台全部 31 个路由；侧栏改由清单生成。本阶段菜单分组与顺序不变。
- 新增守护 `scripts/check-nav.mjs` 与负例自检，接入根 `pnpm test`：无孤儿、无死链、入口可达、流程 actor 在册、角色枚举一致、页面角色与服务端 `@ParticipantRoles` 一致、无重复列表（带豁免名单）、门控单点。
- 新增布局层路由门控 `RouteGuard`，挂在 `(console)/layout.tsx`；删除 5 处页面内整页门控。
- `admin` 正式成为第五角色：`DESIGN.md §8`、`ARCHITECTURE.md` 角色行、用户管理下拉与代码对齐。
- 修断链：RWS 表单走 MDOP 通道提交后链接指向 MDOP 作业详情；丝路数港互认菜单对 `operator` 开放；RBQM 越限行可确认；推理页有回程。
- 清 mock 与死代码：`/space` 总览改接真实查询；删除 `lib/space-mock.ts` 与 `train-product-button.tsx`；修正任务页悬空文案。
- 治理同步：`DECISIONS.md` 登记 D-UI-2（导航清单为唯一事实源）；`DESIGN.md §3`、`REGISTRY.md`、`CLAUDE.md`、`AGENTS.md` 同步。

## Capabilities

### New Capabilities
- `console-navigation`: 控制台导航契约——导航清单、守护规则、布局层角色门控、角色词汇一致性，以及由此保证的入口可达性。

### Modified Capabilities

无。服务端角色守卫行为不变，本变更只让前端与之对齐。

## Impact

- 前端：`apps/web/src/nav.manifest.json`、`lib/nav.ts`、`components/console/{space-nav,route-guard,ui}.tsx`、`(console)/layout.tsx`、`(console)/space/{page,tasks,tasks/new/rws,compliance,compliance/alerts,rbqm,deliverables,admin/users,infer}`、`hooks/use-orchestration-tasks.ts`。
- 脚本：`scripts/check-nav.mjs`、`scripts/check-nav.test.mjs`、根 `package.json` 的 `test` 链。
- 治理文档：`DECISIONS.md`、`DESIGN.md`、`ARCHITECTURE.md`、`REGISTRY.md`、`CLAUDE.md`、`AGENTS.md`。
- 后端：无代码改动。守护只读控制器源码做对拍。
- 用户可见变化：`operator` 多出"丝路数港互认"入口；无权限深链从"页面打开后操作失败"变为统一无权限卡片；总览指标由 6 个减为 4 个真实指标。
