# Design

## Context

See `proposal.md` Why。现状：`ContractService.list` 为 `repo.find()` 无 order，再按空间/角色过滤；前端 `ResourceList` 以 `purpose` 为标题，副行拼接 `consumerId → providerId · dataProductId · retention · output · minCell · pinnedModules`；状态 chip 由 `effectiveStatus` + `holderSigned` + `mdopStatus` 推导；`active` 行挂载完整 `C2PolicyPanel`；另查 FL 任务拼「推理入口」。目录侧 `catalog-browse-display` 已规划参与方显示名与 helper——合约列表应复用，不新造第三套 `PARTICIPANT_LABELS`。

## Goals / Non-Goals

**Goals:**

- 列表扫读能回答：谁和谁、为了什么、签哪份产品、现在什么签署态。
- C2 编辑不再撑爆列表行密度。
- 排序与显示名可单测/验收。

**Non-Goals:**

- 改 draft→active 状态机、知悉/签发/撤销 API。
- 完整合约详情站（本变更只需给 C2 一个非列表行的落点）。
- 分页、筛选、搜索。

## Decisions

### 1. 行信息架构

主列：

1. **标题**：`purpose`（空则「未声明目的」）
2. **关系行**：`{consumerDisplayName} → {providerDisplayName}`（缺省回退 id）
3. **产品行**：`dataProductTitle`（缺省回退 `dataProductId`）；可选 faint 短 id
4. **条款摘要**（一行或 chips）：`retention`、`output`、有则 `minCell`；**默认不展示**完整合约 id、不展示 pinnedModules 截断串（有固定模块时用一枚「已固定模块」chip，细节进 C2/详情落点）

右侧：行内动作（知悉/签发/撤销）→ 状态 chip →（条件）推理入口。

### 2. 显示名来源

优先顺序：

1. 列表 API 附带 `consumerDisplayName` / `providerDisplayName` / `dataProductTitle`
2. 前端已有参与方/目录缓存
3. 回退 id；演示 `PARTICIPANT_LABELS` 仅作参与方兜底，与 catalog 共用

**备选**：前端 N+1 查 catalog/participant —— 否决为默认路径；允许过渡，但 tasks 以 API 附带为完成标准。

### 3. 排序

`list`：`createdAt DESC`（若无则 id），或 `updated` 等价字段；过滤保序。前端不二次排序。

### 4. 状态 chip 闭集

保持现有 active 三态（已持签 / 待连接器签署 / 待持签），并补：

| 码 | 文案 |
|----|------|
| draft | 待审批 |
| expired | 已过期 |
| revoked | 已驳回/撤销 |
| approved（若仍出现） | 已批准（或并入已生效路径，实现时与后端 effectiveStatus 对齐） |

颜色沿用 green/amber/red；登记进 DESIGN §2 若尚缺。

### 5. C2 面板移出列表行

- 列表对 `active` 合约至多显示只读 chip/链接：「C2 策略」→ 打开抽屉、侧面板或 `/space/contracts?focus=&c2=` 轻量层。
- `C2PolicyPanel` 编辑 UI **不得**作为 `ResourceList` 行内默认子树。
- 推理入口可保留为链接，但不得再引入第二块重型面板。

### 6. PageHeader 与类型

- `PageHeader` 增加 `title`（如「数字合约」），保留现有 kicker/desc。
- `listContracts` 返回类型改为明确 `ContractListItem`（与后端 list DTO 对齐），去掉页面 `any`。

## Risks / Trade-offs

- [产品标题需 join catalog] → list 侧批量解析；产品缺失时回退 id。
- [C2 挪走改变操作路径] → 列表留入口链接，避免功能回退；DESIGN 写明入口。
- [与 catalog-browse-display 并行] → 参与方显示名共享模块先落地者建文件，后者复用。

## Migration Plan

纯呈现 + 可选 list DTO 字段。无合约条款迁移。回滚 = 回退提交。

## Open Questions

无。C2 落点默认用**同页抽屉/Panel**（少开路由）；若实现时抽屉成本过高，可用独立短路由，规格只要求「不在列表行内编辑」。
