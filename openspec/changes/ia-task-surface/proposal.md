## Why

同一批任务现在有四个列表（编排任务、MDOP 作业、联邦密算、模型交付）外加提供方在连接器页的入站队列；同一个 SecretFlow 任务有两个详情页；`GET /audit` 被三个页面按三种口径各拉一遍。阶段 0 把其中四组重复登记进了豁免名单。本变更是 `docs/前端信息架构改进计划.md` 的阶段 2：把这些重复合并掉，清空豁免名单，旧地址保持可达。

## What Changes

- **统一任务列表**：`/space/tasks` 成为唯一的任务列表，纳入 MDOP 作业与提供方入站任务，按通道、状态、我方角色分面，分面写入 URL。
- **BREAKING（地址）**：`/space/mdop/jobs`、`/space/federated`、`/space/deliverables` 三个列表页删除，改为重定向到带分面的任务列表；连接器页的入站队列改为摘要加链接。
- **SecretFlow 任务单一详情**：`/space/deliverables/[taskId]` 并入 `/space/federated/[taskId]`，作为仅使用方可见的"交付物"视图；旧地址重定向。
- **审计日志单一口径**：三个页面共用一个查询；合规告警并入审计日志页作为视图，`/space/compliance/alerts` 重定向。
- **账本可反查**：结算、存证行可点到所属任务。
- **重定向入清单**：旧地址映射登记在导航清单，`next.config` 由清单生成重定向；守护新增规则，禁止源码再链接旧地址。命令面板保留旧名称作为检索入口。
- 查询键收敛：`/catalog` 与 `/capability/{layer}` 各用一套 key。
- **不做**：推理页内联（见 design）；L1.5 双通道详情合并（随 MDOP 二期）；通用"关联对象"区（见 design）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities
- `console-navigation`: 新增统一任务列表、旧地址重定向、审计单一口径、SecretFlow 单一详情、账本反查的要求（该能力由未归档的 `ia-nav-contract` 引入，本变更只做 ADDED）。

## Impact

- 前端：`nav.manifest.json`、`next.config.ts`、`lib/{nav,task-list}.ts`、`hooks/{use-task-list,use-audit-logs}.ts`、`(console)/space/{tasks,connectors,audit,compliance,federated/[taskId],settlements,attestations}`、`components/console/{command-palette,deliverable-detail}.tsx`；删除 5 个页面及其专用 hook。
- 脚本：`scripts/check-nav.mjs` 与负例。
- 治理文档：`DESIGN.md`、`REGISTRY.md`、`docs/前端信息架构改进计划.md`。`FLOWS.md`、`TRUST.md` 不改。
- 后端：无改动。
- 用户可见变化：侧栏"研究与任务"下只剩一个列表；提供方的入站任务从连接器页移到任务列表；合规告警成为审计日志的一个视图。演示话术与截图涉及这些页面的需更新。
