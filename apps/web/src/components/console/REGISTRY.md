# Console 组件注册表（slim）

> **设计规范以 [DESIGN.md](../../../../../DESIGN.md) 为权威**（token / 状态色映射 / 禁止清单）。本文件为组件清单与页面原型的补充明细。

控制台 `(console)/space/*` 的复用组件清单 + 页面原型配方。对齐现有 "Vital Ink" kit
（`console.css` 的 `--cs-*` 令牌 / `cs-*` 工具类），不引入 antd / ProTable / 新设计语言。
既是设计参考，也是喂编码 agent 的结构化 spec。

> 维护：goly ｜ 落地：`components/console/`

---

## 1. 组件清单（节点）

### 原子 atoms — `components/ui/*`（shadcn）
`button · input · select · checkbox · badge · card · dialog · label · textarea`
> 注意：仅这几个基元被 vendor 进来；其余 shadcn 基元尚未引入，按需添加。

### 分子 / 组织 molecules — `components/console/`
| 组件 | 文件 | layer | 用途 |
|---|---|---|---|
| `PageHeader` | `ui.tsx` | organism | 页头：kicker + 标题 + 描述 + 主操作槽 |
| `Panel` | `ui.tsx` | molecule | 仪表面板容器（`cs-panel`，`ticks` 角标变体） |
| `Stat` | `ui.tsx` | molecule | KPI 数值卡（accent: cyan/green/amber/red） |
| `TaskStatusBadge` | `ui.tsx` | atom+ | 任务状态点 + 文案 |
| `NodeStateBadge` | `ui.tsx` | atom+ | 节点态徽标 |
| `StatusChip` | `ui.tsx` | atom+ | 非任务类状态徽章（账号 / 认证 / 证书 / 应用）；语义由 `lib/status-tone` 的 `statusTone` 给出 |
| `Banner` | `ui.tsx` | molecule | 页顶反馈条：提交级错误（`role="alert"`）与操作结果；控制台尚无 toast，成功确认也走这里 |
| `Field` | `ui.tsx` | atom+ | 标签-值对（`cs-label` + 值，`mono` 可选） |
| **`AsyncBoundary`** | `data.tsx` | molecule | **装载/错误/空 三态统一**；`variant: panel\|bare` |
| **`ResourceList<T>`** | `data.tsx` | organism | **卡片行列表**；自带行 Panel 壳 + 三态 |
| **`DataGrid<T>`** | `data.tsx` | organism | **12 列仪表表格**；列模型 `GridColumn<T>` + 三态 |
| `CdmCoverageSummary` · `CoverageFreshnessBadge` | `cdm-coverage.tsx` | molecule | CDM 数据产品覆盖元数据（CDM / 词汇表版本、表数量级、观察期月粒度跨度、新鲜度 fresh/stale/pending；文案注明「该院自报，非平台质量背书」）；嵌在 `catalog` 行内 |
| `L0ValidationPanel` | `orchestration/l0-validation-panel.tsx` | organism | rws-algorithm-validation L0 结果表（按数据源分列 Se/Sp/PPV/NPV + CI；抑制态 vs 已出具态显著区分；合成数据 §7.3 警告横幅） |

### 横切 cross-cutting — `components/console/`
| 组件 | 文件 | 用途 | 对应后端 |
|---|---|---|---|
| `RoleGate` | `role-gate.tsx` | 按角色显隐（`roles={["provider"]}`） | RBAC |
| `AuthGate` | `auth-gate.tsx` | 登录门 | auth |
| `RouteGuard` | `route-guard.tsx` | 布局层整页角色门控：按导航清单 `roles` 拦截，统一无权限卡片（D-UI-2）。页面内不再手写整页门控 | RBAC |
| `matchEntry` / `menuFor` / `ROLES` | `lib/nav` | 导航清单 `nav.manifest.json` 的类型化访问：路径→条目、按角色出菜单、角色枚举 | — |
| `SpaceNav` | `space-nav.tsx` | 侧栏：只列清单里的分区，入口指向分区内当前角色可见的第一个页面 | RBAC |
| `SectionBar` | `section-bar.tsx` | 内容区顶部的面包屑 + 分区局部 tab（`cs-tab`），由清单 `parent` 链与分区生成；页面不自写回程 | — |
| `useTaskList` / `toTaskRows` | `hooks/use-task-list` · `lib/task-list` | 统一任务列表：四个通道 + 提供方入站分派映射成同一行模型；分面解析 / 筛选 / 地址；`taskHrefIndex` 供账本按任务 ID 反查详情地址 | 编排 |
| `useAuditLogs` | `hooks/use-audit-logs` | 审计日志的唯一取数口径（审计日志页、告警视图、合规总览共用） | audit |
| `DeliverableDetail` | `deliverable-detail.tsx` | 联邦任务详情的「交付物」视图（仅使用方） | secretflow |
| `WorkbenchPanel` / `buildWorkbench` | `workbench-panel.tsx` · `lib/workbench` · `hooks/use-workbench` | 首页角色化待办区：按角色算出计数 + 直达链接；复用 `Stat` | 各域 |
| `CommandPalette` | `command-palette.tsx` | ⌘K 命令面板：跳转 / 发起类动作 / 按 ID 直达；命令来自 `lib/nav` 的 `searchCommands` | — |
| `useAuth` / `roleLabel` | `lib/auth` | 当前角色/就绪态 | session |

---

## 2. 页面原型（模板）与实例

| 原型 | 配方 | 形态 | 实例（space/*） |
|---|---|---|---|
| **ListCard** | `PageHeader` + `ResourceList` | 卡片行 | `catalog` · `contracts` |
| **ListTable** | `PageHeader` + `DataGrid` | 12 列表格 | `connectors` · `settlements` |
| **Detail** | `PageHeader` + 描述区 + 关联子表 | — | `tasks/[id]`（已存在，未纳入本次抽取） |
| **Form** | `PageHeader` + 分组表单 + 动作条 | — | `tasks/new`（未抽取；缺 rhf+zod，见下「缺口」） |

> 选型规则：**密集多列/对齐数字 → ListTable(DataGrid)；稀疏卡片/图文混排 → ListCard(ResourceList)。**
> 两者都把 `装载/错误/空` 委托给 `AsyncBoundary`，页面不再手写三态。

---

## 3. 节点元数据（slim schema）

每个复用节点记录：`props` · `states`（必须覆盖的态）· `reuses` · `permission` · `dataDep`。

```
AsyncBoundary
  props: { loading?, error?, empty?, variant, loadingText, errorText, emptyText, children }
  states: 载 / 错 / 空 / 有数据
  reuses: [Panel]

ResourceList<T>
  props: { items, rowKey, renderItem, rowClassName?, className?, loading?, error?, …stateText }
  states: → 委托 AsyncBoundary（empty 由 items.length===0 推导）
  reuses: [Panel, AsyncBoundary]

DataGrid<T>
  props: { columns: GridColumn<T>[], rows, rowKey, loading?, error?, …stateText }
  GridColumn<T>: { header, cell:(row)=>node, className /* col-span + 对齐，表头与单元格共用 */ }
  states: → 委托 AsyncBoundary(variant="bare")
  reuses: [Panel, AsyncBoundary]
```

实例页节点的 `dataDep` / `permission`：

| 页面 | dataDep | permission |
|---|---|---|
| catalog | `GET /data-assets`（`api.getDataAssets`） | 发布按钮 → provider |
| contracts | `api.listContracts` | 申请 → consumer；签发/审批 → provider |
| connectors | `GET /rws/inbox` + `GET /fl-prediction/inbox`（provider 本院队列）+ catalog/contracts 计数 | 整页 → provider；发布按钮 → provider |
| settlements | `api.getSettlements`（`useEffect`） | 行/列随 `role` 变体 |

---

## 4. 复用边（REUSES，本次抽取消除的重复）

```
catalog ─┐
         ├─REUSES→ ResourceList ─REUSES→ AsyncBoundary ─REUSES→ Panel
contracts┘
connectors ─┐
            ├─REUSES→ DataGrid ─REUSES→ AsyncBoundary
settlements ┘
```
此前 `装载/错误/空` 三态 + 行/表脚手架在 4 个页里逐份手写；现收敛到 3 个分子。

---

## 5. 已知缺口（按需再抽，勿预建）

- **Form 栈未定**：`tasks/new` 等表单页缺 `react-hook-form + zod`（均未安装）。要做 `FormField/FormLayout` 前先定表单库。
- **MasterDetail / Dashboard 原型**：当前无主从页；`atlas` / `secretflow` 是定制可视化，非 KPI 看板。**不预建**。
- **`any` 债**：API 行数据全仓用 `any`（`pnpm lint` 既有 ~76 处 `no-explicit-any`）。`data.tsx` 组件本身零 any；页面沿用房风格。要收紧需全局统一 DTO 类型，单独立项。
- **legacy `/dashboard/*`**：旧表格页（原始 `<table>`）正被迁往 `/space`，迁移时同样套 `DataGrid`。
