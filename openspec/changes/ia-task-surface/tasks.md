## 1. 审计日志单一口径

- [x] 1.1 新增 `hooks/use-audit-logs.ts`；审计日志页与合规总览改用
- [x] 1.2 告警表搬为 `audit/alerts-view.tsx`，审计日志页加 `?view=alerts` 视图；删除 `compliance/alerts/page.tsx`

## 2. 统一任务列表

- [x] 2.1 新增 `lib/task-list.ts`（行模型、五个来源的适配、分面解析 / 筛选 / 链接）与单测
- [x] 2.2 新增 `hooks/use-task-list.ts`；`tasks/page.tsx` 改用并加分面条
- [x] 2.3 连接器页入站队列改为摘要加链接
- [x] 2.4 删除 `mdop/jobs/page.tsx`、`federated/page.tsx`、`deliverables/` 列表及 `use-consumer-deliverables`

## 3. 清单、重定向与守护

- [x] 3.1 `nav.manifest.json`：删除被合并条目、调整父级与实体、清空豁免、新增 `redirects`
- [x] 3.2 `next.config.ts` 由清单生成重定向；`lib/nav.ts` 把带 `label` 的重定向纳入命令；单测
- [x] 3.3 `check-nav.mjs` 新增 N10 与负例；改掉源码中指向旧地址的链接

## 4. SecretFlow 单一详情

- [x] 4.1 交付详情正文搬为 `components/console/deliverable-detail.tsx`
- [x] 4.2 `federated/[taskId]` 加视图切换；删除 `deliverables/[taskId]`

## 5. 账本反查与查询键

- [x] 5.1 结算行按任务 ID 经统一任务列表反查并链接到任务详情；存证行核对后已带归属对象链接（并行会话此前完成），未改
- [x] 5.2 `/catalog` 查询键收敛（合规总览一处）；`/capability/{layer}` 核对后已是一致的层级键 `["atlas", …]`，未改

## 6. 治理与验证

- [x] 6.1 `DESIGN.md`、`REGISTRY.md`、`docs/前端信息架构改进计划.md` 同步
- [x] 6.2 守护、单测、类型检查、lint、`next build`
- [x] 6.3 浏览器走查（暗色主题，对桩后端）：任务列表六行四通道与分面组合、提供方入站任务、五条旧地址重定向中的四条（`/space/deliverables` 列表未单独点，与 `/space/federated` 同一规则）、告警视图与总览告警数一致、联邦详情两种视图（使用方 / 其他角色）、结算行反查、连接器页摘要。未在真实后端联调
