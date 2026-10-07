## Context

五个 admin 页面合计约 650 行，其中约 80 行使用浅色 Tailwind 类（`text-gray-*`、`bg-white`、`bg-red-50`、`bg-blue-600` 等），4 个页面共 6 张裸 `<table>`，三态各自手写。页头已在 `ia-nav-shell` 改为 `PageHeader`。

console 现有原语里没有：页顶反馈条、非任务类状态的徽章、标签-值对。`DESIGN.md §2` 的铁律是"新增状态必须先在此表登记"。控制台没有 toast 设施。

## Goals / Non-Goals

**Goals:**

- 五个页面不再有浅色主题类、裸表格和手写三态。
- 状态配色有登记、有单一实现。

**Non-Goals:**

- 改取数方式（仍是 `useEffect` + `useState`）。迁到 TanStack Query 会连带改刷新与提交后的重载逻辑，与"只换表现层"的目标无关。
- 引入 toast 或自绘确认弹层。成功提示先用页顶 `Banner`，不可逆操作先用浏览器原生确认框。
- 改这些页面的角色、清单条目或接口。

## Decisions

### 1. 三个新原语放进 `components/console/ui.tsx`

- `Banner`：`tone` 取 `error` / `success` / `warn`，同色描边的面板条。错误带 `role="alert"`。
- `StatusChip`：`tone` 取 `ok` / `attention` / `blocked` / `neutral`，对应 green / amber / red / faint，`cs-chip` 同色描边，静态不脉冲。
- `Field`：`cs-label` 标签加值，`mono` 可选。

### 2. 状态到语义的映射只有一处

`lib/status-tone.ts` 的 `statusTone(status)` 是闭集查表：`active`、`approved` → ok；`pending`、`submitted` → attention；`disabled`、`rejected`、`revoked` → blocked；其余 → neutral。同时登记进 `DESIGN.md §2`。中文标签留在各页面。

### 3. 表格一律 `DataGrid`，申请卡片用 `ResourceList`

每张表一个列模型；行内的编辑控件（用户管理里的参与方输入、角色与状态下拉）作为单元格内容保留。机构认证申请是图文混排的卡片，按 `DESIGN.md §4` 的选型规则用 `ResourceList`。

### 4. 不可逆操作加确认

证书吊销、应用吊销目前点击即执行。按 `DESIGN.md §7` 加确认并写明后果。这是唯一的行为变化。

## Risks / Trade-offs

- 用户管理的行内编辑控件挤在 12 列栅格里，窄屏会拥挤 → 控件用小号字并给固定最小宽度；宽屏为主。
- 成功提示用 `Banner` 而非 `DESIGN.md §7` 写的 toast → 控制台尚无 toast 设施，在 `REGISTRY.md` 注明。
- 没有真实后端联调 → 只换表现层，取数与提交代码逐行保留；用桩后端截图核对。

## Migration Plan

纯前端改动。回滚 = 回退提交。

## Open Questions

无。
