# Console 组件注册表（slim）

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
| **`AsyncBoundary`** | `data.tsx` | molecule | **装载/错误/空 三态统一**；`variant: panel\|bare` |
| **`ResourceList<T>`** | `data.tsx` | organism | **卡片行列表**；自带行 Panel 壳 + 三态 |
| **`DataGrid<T>`** | `data.tsx` | organism | **12 列仪表表格**；列模型 `GridColumn<T>` + 三态 |

### 横切 cross-cutting — `components/console/`
| 组件 | 文件 | 用途 | 对应后端 |
|---|---|---|---|
| `RoleGate` | `role-gate.tsx` | 按角色显隐（`roles={["provider"]}`） | RBAC |
| `AuthGate` | `auth-gate.tsx` | 登录门 | auth |
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
| contracts | `api.getAccessRequests` | — |
| connectors | `lib/space-mock`（静态） | 发布按钮 → provider |
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
