# MedTrust 前端设计规范 — 单一事实源

> **本文件是 UI 的唯一事实源。** agent 生成任何界面前必须遵守本文件；与本文件冲突的生成结果视为 bug。
> 适用范围：`apps/web` 的 `(console)` 控制台（权威主题）。legacy `/dashboard`（浅色 shadcn）正迁移中，新页面一律用 `(console)` 的 Vital Ink 主题。
> 关联：[`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`apps/web/src/components/console/REGISTRY.md`](./apps/web/src/components/console/REGISTRY.md)（组件清单补充）· [`apps/web/src/app/(console)/console.css`](./apps/web/src/app/(console)/console.css)（token 落地）

---

## 0. 定位与原则

- **用户**：药企数据科学家 / 医院信息科 / 平台运营方 / 合规审计员。专业用户，长时间使用控制台查看任务、合约、存证。
- **气质**：**精密仪表盘**（Vital Ink）。安静、可信、紧凑。暗色中性石墨底 + 隐约网格 + 单一翡翠青（jade）信号色——医疗 / 精密仪器的质感，**不是**冷科幻蓝。
- **三条铁律**：
  1. **克制 > 炫技**：这是工作台，不是官网。少一个装饰、少一个动画，胜过任何视觉修饰。
  2. **一致 > 局部最优**：宁可全系统统一的次优方案，不要页面各自的"更好"方案。
  3. **状态完备**：任何页面必须处理 loading / empty / error 三态（通过 `AsyncBoundary`），缺一即不合格。
- **签名元素**：`(console)` 顶栏的 jade 信号色 + 面板角标（`cs-ticks`）+ 状态点（`cs-dot`）动效。全系统同一套，禁止变体。

---

## 1. Design Tokens

落地位置：`apps/web/src/app/(console)/console.css`，scope 在 `.cs` 下。**业务代码禁止出现裸 hex、裸 oklch、自造间距**，只准引用 `--cs-*` token 或 `cs-*` 工具类。

### 1.1 色彩（Vital Ink 暗色**默认**主题 + 受约束的空间主题覆盖层）

| Token | 值（oklch） | 用途 |
|-------|------------|------|
| `--cs-bg` | `0.16 0.006 180` | 页面底色（深石墨） |
| `--cs-bg-2` | `0.205 0.008 180` | 面板渐变起点 / hover 底 |
| `--cs-bg-3` | `0.25 0.010 182` | 更浅的面板层 |
| `--cs-line` | `0.44 0.012 180 / 0.5` | 分隔线、控件描边（实线） |
| `--cs-line-soft` | `0.44 0.012 180 / 0.22` | 行分隔、网格线（弱） |
| `--cs-text` | `0.95 0.005 160` | 主文字 |
| `--cs-dim` | `0.73 0.012 175` | 辅助文字、标签 |
| `--cs-faint` | `0.57 0.013 175` | 占位符、最弱文字 |
| `--cs-cyan` | `0.81 0.125 182` | **主信号色（jade 翡翠青）**——主操作、激活态、运行中 |
| `--cs-cyan-dim` | `0.81 0.125 182 / 0.15` | 选中行底色、运行点光晕 |
| `--cs-glow` | `0.81 0.125 182 / 0.5` | 主操作 hover 辉光 |
| `--cs-green` | `0.84 0.17 148` | 成功、已完成、在线 |
| `--cs-amber` | `0.83 0.13 74` | 待执行、警告 |
| `--cs-red` | `0.66 0.2 25` | 失败、错误、阻断 |

- **主色刻意不用蓝**：与市面后台同质化区分，翡翠青贴医疗 / 精密仪器语境。
- legacy `/dashboard` 用的 shadcn 浅色变量（`--background` / `--primary` 等）**不属于权威主题**，迁移完成后下线。

### 1.2 字体

- 拉丁 / 数字：**IBM Plex Sans**（正文）+ **IBM Plex Mono**（编码 / 哈希 / 数字列），经 `next/font/google` 加载，变量 `--font-plex-sans` / `--font-plex-mono`。
- 中文回退：`"PingFang SC", "Microsoft YaHei", system-ui`。
- **所有数字列、哈希、统计数强制 `font-feature-settings: "tnum" 1`**（已在 `.cs` 上全局开启）。

### 1.3 字号 / 字重

| 角色 | 字号 / 字重 | 用途 |
|------|------------|------|
| 页面标题 | `text-xl` / 600 | 每页一个（`PageHeader`） |
| 区块标题 | `text-base` / 600 | 面板头 |
| 正文 | `text-sm` / 400 | 默认 |
| 辅助 | `text-xs` / 400 | 次要说明 |
| 标签（`cs-label`） | `0.66rem` mono / 大写 / `letter-spacing 0.14em` | KPI 标签、字段标签 |
| KPI 数字 | `Stat` 组件 accent 色 | 仪表盘数值卡 |

### 1.4 间距 / 圆角 / 阴影 / 动效

- **4px 栅格**，常用档 4 / 8 / 12 / 16。
- 圆角：控件 / 面板 **4px**（仪表盘质感，不用大圆角）；状态点全圆。
- 阴影：**边框优先**。面板默认只有 `--cs-line` 边框；仅主按钮 hover 用 `--cs-glow` 辉光。禁止装饰性阴影。
- 动效：面板进场 `cs-reveal`（0.5s opacity + 8px 位移）；状态点 pulse（`cs-pulse` 1.6–2.4s）；拓扑流线 `cs-flow`（dash 动画）。全部克制，尊重 `prefers-reduced-motion`。

---

### 1.5 主题令牌契约（空间主题白名单）

> 级联：**平台默认**（本册 §1）→ **实例品牌**（部署配置兜底 + admin 设置页）→ **空间主题**。
> 空间主题**只能覆盖下表令牌**，业务代码 MUST NOT 接受任意 CSS（D-SPD-15）。
> 本表由 `scripts/check-theme.mjs` 与代码白名单对拍——改表必须同步改代码，否则报红。

| 令牌 | 类型 | 约束 |
|---|---|---|
| `logoKey` | image | 对象存储 key；**禁外链**；上传时净化（禁脚本）；限类型与体积 |
| `faviconKey` | image | 同上 |
| `title` | text | 系统标题；缺省回落实例品牌 → 平台默认 |
| `shortName` | text | 侧栏短名 |
| `primary` | color | `#rrggbb`；与页面底色的对比度须 ≥3.0（WCAG AA 非文本/大字号），防「看不见的品牌色」 |
| `accent` | color | 同上 |

**令牌 → CSS 变量映射**：`primary` → `--cs-cyan`（并派生 `--cs-cyan-dim` / `--cs-glow`）；`accent` → `--cs-green`；`title` / `shortName` / `logoKey` / `faviconKey` 由页面直接消费。

**不可覆盖（硬约束）**：§2 状态→语义色唯一映射、功能层（布局 / 间距 / 字号 / 组件）、能力层（页面与菜单集合）。
**术语 ≠ 主题**：界面术语由能力包术语表提供并受守护（TRUST `P-CTL-8`），空间只能选择，MUST NOT 自造。
**联邦边界**：远端空间只展示名称与标识，MUST NOT 注入其样式令牌。

## 2. 状态 → 语义色 唯一映射表（★ 最高价值）

> **收敛现状**：任务状态色目前硬编码在 `apps/web/src/types/task-status.types.ts` 里用 Tailwind 浅色类（`bg-blue-100` 等），与 `--cs-*` token 脱节。**新代码一律用本表的 `--cs-*` token**，该 types 文件待迁移。

| 状态 | 语义 | token | 点样式（`cs-dot`） | 徽章 |
|------|------|-------|-------------------|------|
| 运行中 `running` | 主信号 | `--cs-cyan` | `cs-dot-run`（pulse + 光晕） | jade 底 |
| 已完成 `completed` | 成功 | `--cs-green` | `cs-dot-on`（pulse） | green 底 |
| 待执行 `pending` | 中性等待 | `--cs-faint` | `cs-dot-off` | faint 底 |
| 失败 `failed` | 错误 / 阻断 | `--cs-red` | `cs-dot-block` | red 底 |
| 已取消 `cancelled` | 警告 / 中止 | `--cs-amber` | `cs-dot-idle` | amber 底 |

**节点状态**（连接器 / worker）沿用同一套：在线 = green（`cs-dot-on`）/ 空闲 = amber（`cs-dot-idle`）/ 离线 = faint（`cs-dot-off`）/ 运行 = cyan（`cs-dot-run`）/ 阻断 = red（`cs-dot-block`）。

**能力落地状态**（七层注册表 `status`，`/space/atlas/*`）：已落地 `active` = green（`--cs-green`）可选 / 未落地 `draft`、已退役 `deprecated` = red（`--cs-red`）虚线描边、不可选。点样式 `cs-land-dot`（**静态不 pulse**——落地是目录属性，不是运行态）；选择芯片 `cs-land-chip`（`data-landed` / `data-on`）。

**CDM 覆盖元数据新鲜度**（omop-data-source-access，`/space/catalog` 的 CDM 数据产品行，`CoverageFreshnessBadge`）：已上报 `fresh` = green（`--cs-green`，`cs-dot-ok`）/ 待刷新 `stale` = amber（`--cs-amber`，`cs-dot-idle`）/ 待上报 `pending` = faint（`--cs-faint`，`cs-dot-off`）。点**静态不 pulse**（目录属性，不是运行态）；徽章为 `cs-chip` 同色描边。「已上报」只表示该院连接器报过、版本是该院自报的事实，**不得**写成「已验证 / 质量合格」。

**平台分区的账号 / 认证 / 证书 / 应用状态**（`/space/admin/*`，徽章 `StatusChip`，映射唯一实现在 `lib/status-tone.ts`）：正常 `active`、已通过 `approved`、证书有效 = green（`--cs-green`）/ 待分配 `pending`、待审核 `submitted` = amber（`--cs-amber`，需要运营方处理）/ 已禁用 `disabled`、已驳回 `rejected`、已吊销 `revoked` = red（`--cs-red`）/ 草稿 `draft` 与未登记的状态 = faint（`--cs-faint`）。徽章为 `cs-chip` 同色描边，**静态不 pulse**。未登记的状态一律中性色，不得染成"正常"。

**铁律**：新增状态必须先在此表登记（token + 点样式 + 徽章），禁止页面内私自配色。

---

## 3. AppShell 与导航

```
┌──────────────────────────────────────────────────────────────┐
│ .cs（Vital Ink 暗色 + 网格 + 顶部 jade 光晕）                   │
├────────────┬─────────────────────────────────────────────────┤
│ SpaceNav   │ SectionBar                                      │
│  ⌘K 触发   │  面包屑：分区 › 菜单页 › 父级 › 当前页 ID          │
│  分区 ×6   │  局部 tab：分区内当前角色可见的菜单页              │
│ (cs-nav    ├─────────────────────────────────────────────────┤
│  link)     │ RouteGuard → 页面内容（PageHeader + 正文）         │
└────────────┴─────────────────────────────────────────────────┘
```

- 整个 `(console)` 包在 `.cs` 下，`AuthGate` 门禁，`ConsoleProviders`（TanStack Query 等）注入。
- **AppShell 固定一屏高（`h-dvh`），导航区与工作区分离、各自内部滚动**：侧栏是满视口列——品牌、空间切换、⌘K 触发常驻不压缩，分区列表 `flex-1 min-h-0 overflow-y-auto` 内部滚动，身份块与状态块 `shrink-0` 钉底；`main` 为独立滚动容器（`overflow-y-auto`）。页面整体不产生滚动条，正文再长也不会把侧栏底部推出视口。
- **导航三层，全部由导航清单 `apps/web/src/nav.manifest.json` 生成（D-UI-2），组件里不写菜单项**：
  1. **侧栏 `SpaceNav`** 只列分区（工作台 / 数据与合约 / 研究与任务 / 合规与监查 / 平台 / 能力与准入），每个角色可见不超过 6 项；分区入口指向其中当前角色可见的第一个页面，没有可见页面的分区不出现。激活态 `data-active="true"` = `--cs-bg-2` 底 + 左侧 2px jade 条。
  2. **`SectionBar`**（`main` 顶部）渲染面包屑与分区局部 tab（`cs-tab`，激活态 = 底部 2px jade 条）。分区只有一个可见页面时不显示 tab 条。
  3. **页面**：详情页、表单页不进菜单，靠清单里的 `parent` 挂到上一级；面包屑逐级可点，**页面不需要也不应自己再写一套回程导航**。
- **新增页面**：在清单登记路由、所属分区（菜单页）或上级页面（详情/表单页）、可见角色；`pnpm check:nav` 守护，未登记 = 红。分区按"用户要做的事"划分，**不得按架构平面、受众、内部职能另起分组**。
- **首页（工作台分区）顶部是角色化待办区 `WorkbenchPanel`**：按当前角色列出"现在该处理什么"，每项是一个计数加一个直达处理页面的链接（落点用分面或视图地址）。计数来自与落点页面相同的查询；读取失败显示"—"，不显示 0。新增待办项改 `lib/workbench.ts`，不要在页面里手写。
- **命令面板 `CommandPalette`**（⌘K / Ctrl+K，侧栏顶部有触发按钮）：跳转页面、发起类动作、按对象 ID 直达详情。命令由清单推导，只列当前角色可见的页面。
- **同一对象只有一个列表、一个详情**。不同受众或不同通道的差异用**分面**（列表，写入地址查询串，如 `/space/tasks?channel=mdop&role=provider`）和**视图**（详情，如 `?tab=deliverables`）表达，不另开页面；分面与视图切换用可点的 `cs-chip`（激活态 `data-active="true"` = jade 描边）。新增重复列表 = `pnpm check:nav` 红，豁免名单已清空。
- **合并或删除页面时旧地址必须重定向**：在清单 `redirects` 登记「旧地址 → 新地址」，`next.config.ts` 由清单生成永久重定向；带 `label` 的同时成为命令面板里的旧名称入口。源码不得再链接旧地址（`pnpm check:nav` 守护）。
- 浮层一律渲染在 `.cs` 作用域内（自绘固定层）；shadcn `Dialog` 走 portal 会丢失 `--cs-*` 令牌，控制台内不用。
- `main` 内由 `RouteGuard` 按清单做整页角色门控（见 §8）。
- 顶栏 jade 光晕（`::before` radial-gradient）+ 48px 网格（`--cs-line-soft`）= 仪表盘氛围，`mask-image` 渐隐。
- `document.title` = `可信数据空间控制台 · MedTrust`。

---

## 4. 页面原型（四类，禁止第五类）

> 来自 `REGISTRY.md` §2。所有页面必须落入以下模板之一；不满足时先扩展模板，不许页面自造布局。

| 原型 | 配方 | 形态 | 实例 |
|------|------|------|------|
| **ListCard** | `PageHeader` + `ResourceList` | 卡片行 | `catalog` · `contracts` |
| **ListTable** | `PageHeader` + `DataGrid` | 12 列表格 | `settlements` · `attestations`（存证账本：类别 / 归属对象 / 哈希与交易 / 区块 / 上链时间） |
| **Detail** | `PageHeader` + 描述区 + 关联子表 | — | `tasks/[id]` |
| **Form** | `PageHeader` + 分组表单 + 动作条 | — | `tasks/new` |

**选型规则**：密集多列 / 对齐数字 → ListTable（`DataGrid`）；稀疏卡片 / 图文混排 → ListCard（`ResourceList`）。两者都把 loading/error/empty 委托给 `AsyncBoundary`，页面不再手写三态。

**已知缺口**（按需再抽）：Form 栈已选 `react-hook-form + zod`（D-UI-1，2026-07）；`FormField / FormLayout` 分子待首个复杂表单（rws-study-protocol-spec §6）落地后再抽。MasterDetail / Dashboard 原型当前无实例，需要时再抽。

---

## 5. 组件词汇表

> 来自 `REGISTRY.md` §1。页面层只准组合 `components/console/` + `components/ui/`（shadcn）原语；以下场景禁止自造。

| 场景 | 必须使用 | 文件 |
|------|----------|------|
| 页头 | `PageHeader` | `ui.tsx` |
| 仪表面板容器 | `Panel`（`cs-panel`，可选 `ticks` 角标） | `ui.tsx` |
| KPI 数值卡 | `Stat`（accent: cyan/green/amber/red） | `ui.tsx` |
| 任务状态展示 | `TaskStatusBadge`（读 §2 映射表） | `ui.tsx` |
| 节点状态展示 | `NodeStateBadge` | `ui.tsx` |
| **装载/错误/空 三态** | **`AsyncBoundary`**（variant: panel\|bare） | `data.tsx` |
| 卡片行列表 | **`ResourceList<T>`**（自带 Panel + 三态） | `data.tsx` |
| 12 列表格 | **`DataGrid<T>`**（列模型 `GridColumn<T>` + 三态） | `data.tsx` |
| 提交级错误 / 操作结果提示 | `Banner`（tone: error/success/warn） | `ui.tsx` |
| 非任务类状态（账号 / 认证 / 证书 / 应用） | `StatusChip`（读 §2 映射表） | `ui.tsx` |
| 标签-值对 | `Field`（标识类的值加 `mono`） | `ui.tsx` |
| 角色显隐 | `RoleGate`（`roles={["provider"]}`） | `role-gate.tsx` |
| 登录门 | `AuthGate` | `auth-gate.tsx` |

shadcn 原子（`components/ui/*`）：`button · input · select · checkbox · badge · card · dialog · label · textarea`。仅这几个基元被 vendor 进来，按需添加。

新原语进入 `components/console/` 需同时登记到 `REGISTRY.md`。

---

## 6. 数据展示格式（全系统统一）

| 类型 | 格式 |
|------|------|
| 哈希 | `SM3:58496e...c4f2`（前 6 + `...` + 后 6，mono 字体） |
| 计数 / 效应量 | tabular-nums，右对齐 |
| 日期 | `YYYY-MM-DD`；含时间 `YYYY-MM-DD HH:mm` |
| 区块高度 | `Block #22`（mono） |
| 空值 | 统一 `—`，禁止空白 / `null` / `0` 冒充 |
| 状态 | 一律 `TaskStatusBadge` / `NodeStateBadge`，读 §2 映射表，禁止裸文字色 |
| 交易哈希 / txHash | mono，截断显示 |

---

## 7. 反馈体系（语义分工，不可混用）

| 载体 | 用途 | 禁止 |
|------|------|------|
| Toast | 成功确认、异步任务已提交 | 禁止用 toast 报错误 |
| 确认 Dialog | 破坏性 / 不可逆操作（撤销合约、结案） | 文案必须说明后果 |
| `AsyncBoundary` | 列表 / 表格 / 详情的 loading / error / empty 三态 | 禁止页面手写三态 |
| Banner（页顶） | 提交级错误、系统公告 | — |
| 状态点（`cs-dot`） | 运行中 / 在线 / 阻断的实时指示 | — |

---

## 8. 权限显示规则

- 无权限的**菜单不出现**：侧栏按导航清单各条目的可见角色过滤。
- 页面内无权限的**操作按钮隐藏**（`RoleGate`），不做禁用置灰——避免"为什么点不了"的困惑。
- 整页无权 → 布局层 `RouteGuard` 按导航清单拦截，显示统一的无权限卡片。**页面内禁止手写整页角色门控**（`pnpm check:nav` 守护）；按角色切换列、按钮的条件渲染不在此限。未登录 → `AuthGate`。
- 平台管理员只能在服务器侧授予（D-ID-3）：用户管理页的可分配角色不含它，平台管理员账号与本人所在行只读展示——接口会拒绝的操作，界面不提供。
- 清单里的可见角色必须与该页主要接口的服务端角色守卫一致（`pnpm check:nav` 对拍）。前端门控只管体验，安全边界在服务端。
- 角色定义：`provider`（数据提供方 / 医院）/ `consumer`（数据消费方 / 药企）/ `operator`（平台运营）/ `compliance`（合规审计）/ `admin`（平台管理员：系统状态与基础设施）。

---

## 9. 禁止清单（agent 逐条自查）

1. **禁裸 hex / 裸 oklch / 自造间距** —— 只准 `--cs-*` token 或 `cs-*` 工具类。
2. **禁裸 `<table>`** —— 表格一律 `DataGrid`。
3. **禁页面私自配色状态色** —— 新增状态先登记 §2 映射表。
4. **禁跳过三态** —— 列表 / 表格 / 详情必须用 `AsyncBoundary` 覆盖 loading / error / empty。
5. **禁引入 antd / ProTable / 第二设计语言** —— 只用 shadcn 原子 + `components/console/` 分子。设计令牌只有 `--cs-*` 一套：能力图谱（atlas）曾带一套取值相同的 `--at-*`，已并入（`pnpm check:nav` 禁止 `--at-*` 再出现）；`.codex` 只是把 shadcn 原子的令牌指向 `--cs-*` 的适配层，页面专属组件样式用 `cs-*` 前缀并只引用 `--cs-*`。
6. **禁装饰性阴影 / 渐变 / 大圆角** —— 仪表盘质感靠边框 + 网格 + 角标，不靠阴影。
7. **禁 emoji 当图标** —— 图标只用 lucide-react。
8. **禁 legacy `/dashboard` 浅色主题用于新页面** —— 新页面一律 `(console)` Vital Ink 暗色主题。
9. **禁 `dangerouslySetInnerHTML` 直插用户内容**。
10. **交付前必须浏览器截图自查**（暗色主题），对照本文件逐节核对。

---

## 10. 落地映射

- Token → `apps/web/src/app/(console)/console.css`（`.cs` scope 下的 `--cs-*`）。
- 组件 → `apps/web/src/components/console/`（`ui.tsx` / `data.tsx` / `role-gate.tsx` / `auth-gate.tsx`）。
- 本文件 §1 / §2 的变更需同步 `REGISTRY.md` 与视觉自查。
- `CLAUDE.md` / `AGENTS.md` 引用本文件为 UI 唯一事实源。

## 附录：格式契约

本文件的解析目标是**术语注册表**、**状态→颜色映射表**、**禁止清单**。

1. 术语注册表首列反引号包裹术语名；禁止清单首列 `D-n` 编号。
2. 禁止清单每条须标注"怎么抓"（grep / 测试符号 / 评审把关）。
3. 架构问题（字段契约/分级职责）不写进本文件，归 ARCHITECTURE.md。
4. 解析空转兜底（MS-8）：术语注册表或禁止清单解析为 0 行 = 格式契约破坏 = 红（防"表格被改成散文后静默通过"）。
