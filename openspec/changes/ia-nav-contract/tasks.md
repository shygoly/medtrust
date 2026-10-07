## 1. 导航清单

- [x] 1.1 新增 `apps/web/src/nav.manifest.json`：`roles`、`groups`、31 条 `entries`（保持现有 6 组与菜单顺序）、`waivers.duplicateList`
- [x] 1.2 新增 `apps/web/src/lib/nav.ts`：类型与 `matchEntry` / `menuFor` / `canAccess` / `menuAncestor`
- [x] 1.3 新增 `apps/web/src/lib/nav.test.ts`：静态路由优先于动态路由、按角色出菜单、父链回溯、图标名在册
- [x] 1.4 `components/console/space-nav.tsx` 改由清单生成，激活态用 `menuAncestor`

## 2. 守护

- [x] 2.1 新增 `scripts/check-nav.mjs`：纯函数 `runNavCheck` + 读盘入口，覆盖 spec 的全部守护规则
- [x] 2.2 新增 `scripts/check-nav.test.mjs`：每条规则的负例与合法样例
- [x] 2.3 根 `package.json` 增加 `check:nav` 并接入 `test`

## 3. 布局层门控

- [x] 3.1 新增 `components/console/route-guard.tsx`（含无权限卡片），挂入 `(console)/layout.tsx`
- [x] 3.2 删除整页门控：`compliance`、`compliance/alerts`、`rbqm`、`deliverables`（列表与详情）
- [x] 3.3 `atlas/[layer]` 的页内角色判断：核对后保留——两处都是带只读回落分支的三元渲染，`RoleGate` 没有回落槽，属于 design 允许的条件渲染

## 4. 修断链

- [x] 4.1 `tasks/new/rws/page.tsx`：提交后的跟进链接按通道分流
- [x] 4.2 `infer/[taskId]`：确认有回到任务详情的链接，没有则补
- [x] 4.3 `rbqm/page.tsx`：开放越限行接上 `acknowledgeQtlBreach`
- [x] 4.4 `admin/users/page.tsx`：角色下拉改用清单角色

## 5. 清 mock 与死代码

> 实施中发现并行会话正在做同一件事：`apps/web/src/lib/space-overview.ts`（"只由真实接口的返回值算出，不含任何演示数字"）于本变更实施期间新增。为避免两边同时改 `/space/page.tsx`、`ui.tsx`、`space-mock.ts`，5.1–5.2 交由该会话完成，本变更不动这些文件；原计划为总览抽取的 `use-orchestration-tasks` hook 随之取消。

- [x] 5.1 `/space` 总览改接真实查询——并行会话已完成（`space/page.tsx` 改用 `lib/space-overview.ts` 的 `buildSpaceOverview`）；本变更核对：页面不再引用任何演示数据
- [ ] 5.2 `components/console/ui.tsx` 脱离 `space-mock`，删除 `lib/space-mock.ts`——并行会话已把该文件裁到只剩状态标签与类型（不再导出演示数据），剩余是改名与类型本地化，待其收尾后处理
- [x] 5.3 删除 `components/console/train-product-button.tsx`
- [x] 5.4 修正 `tasks/page.tsx` 的 SecretFlow 发起文案（指向密算编排）

## 6. 治理同步

- [x] 6.1 `DECISIONS.md` 登记 D-UI-2
- [x] 6.2 `DESIGN.md §3`、`§8`；`ARCHITECTURE.md` 角色行；`REGISTRY.md` 登记 `RouteGuard`
- [x] 6.3 `CLAUDE.md`、`AGENTS.md`：核对后不改——`AGENTS.md` 明言守护清单以 `package.json` 的 `test` 链为准；新增页面须登记的规则已写入 `DESIGN.md §3`，违规时守护报错自带指引
- [x] 6.4 `docs/前端信息架构改进计划.md` 同步本变更对计划的三处调整

## 7. 验证

- [x] 7.1 `pnpm check:nav` 与 `node --test scripts/check-nav.test.mjs` 通过
- [x] 7.2 `apps/web`：`pnpm test`、`pnpm lint`、类型检查通过
- [x] 7.3 根守护链（`check:meta`、`governance`、`governance:negative`）通过
- [x] 7.4 浏览器走查（暗色主题，对桩后端）：五个角色的菜单、无权限卡片且受限页请求未发出、详情/表单页高亮所属菜单、RBQM 确认。未走查：MDOP 提交后跳转（需真实合约数据，仅代码核对）、总览数值（属并行会话改动）
