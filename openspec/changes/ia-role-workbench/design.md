## Context

- `/space` 已由并行会话改为真实数据总览（`lib/space-overview.ts`），对所有角色显示相同内容。
- atlas 的 `atlas.css` 定义了 14 个 `--at-*` 令牌，注释自述"bespoke atlas tokens → cs values"，取值与 `--cs-*` 逐一相同；另有 `at-label`、`at-mono`、`at-reveal` 等与 `cs-*` 同义的类，以及条带、裁决印章、落地芯片等 atlas 专属组件样式。4 个页面各写了一个大号展示页头。
- atlas 的弹层（shadcn `Dialog` / `Select`）经 portal 渲染到 `body`，靠 `.codex` 类拿到 shadcn 令牌；而 `--cs-*` 只定义在 `.cs` 上，portal 内取不到。
- 自注册用户登录后若未分配角色，`AuthGate` 显示"账号待分配参与方角色"并只给退出按钮。
- 阶段 2 已提供带分面的任务列表地址、告警视图地址，可直接作为待办的落点。

## Goals / Non-Goals

**Goals:**

- 每个业务角色打开首页，首屏能看到自己的待办及数量，并一步到达处理页面。
- 仓库内不再有 `--at-*` 令牌与 `at-*` 类；atlas 页头与其余页面一致。
- 待分配角色的用户知道下一步去哪里。

**Non-Goals:**

- **admin 五个页面的正文暗色化**。阶段 1 只换了页头，正文仍是浅色 Tailwind 样式和裸 `<table>`。按规范改需要逐页换成 `DataGrid` 与 `cs-*` 控件，是五个页面的重写，不是样式替换；它不在计划阶段 3 的条目里，单独立项。
- 用工作台替换总览。总览已是真实数据，保留在待办区下方。
- atlas 页面的布局与交互改造。只换令牌、类名与页头。

## Decisions

### 1. 待办是纯函数算出来的计数加链接

`lib/workbench.ts` 的 `buildWorkbench(role, 我方参与方, 数据源)` 返回待办项列表；每项有标签、计数、说明、落点地址、语气色。数据源读取失败时计数为空（界面显示"—"），不以 0 冒充。取数放 `hooks/use-workbench.ts`，按角色只请求需要的来源，并复用已有查询键。

| 角色 | 待办项 | 落点 |
|---|---|---|
| provider | 本院执行中的任务 / 本院执行受阻 / 待本院签发的合约申请 | 任务列表（分派给本院 + 状态）/ 数字合约 |
| consumer | 进行中的任务 / 受阻的任务 / 已完成可查看 / 待提供方签发的合约 | 任务列表（我发起的 + 状态）/ 数字合约 |
| compliance | 高危告警 / 开放的 QTL 越限 | 审计日志告警视图 / RBQM |
| operator | 同 compliance，另加待审的机构认证 | 机构认证审核 |
| admin | 无 | 产品里没有面向平台管理员的待办来源，不显示待办区 |

展示复用 `Stat`，外包链接；不新增页面原型。

### 2. atlas 令牌并入 `--cs-*`，`.codex` 降为适配层

- `console.css` 的令牌块选择器由 `.cs` 改为 `.cs, .codex`，使 portal 到 `body` 的弹层也能取到 `--cs-*`；`.cs` 的布局属性拆到单独规则。
- `atlas.css` 删除全部 `--at-*`；`.codex` 只把 shadcn 令牌指向 `--cs-*`（取值与原先逐一相同，视觉不变）。
- 同义类直接换用：`at-label` → `cs-label`、`at-mono` → `cs-mono`、`at-reveal` → `cs-reveal`。`at-key` 是通用的"键名芯片"，改名 `cs-key` 并移入 `console.css`。
- atlas 专属组件样式（条带、层号、裁决印章、落地芯片）留在 `atlas.css`，类名改为 `cs-atlas-*` / `cs-land-*`，只引用 `--cs-*`。
- 守护新增规则：`apps/web/src` 下出现 `--at-` 即报错。

### 3. atlas 页头换成 `PageHeader`

4 个页面删除自造页头，改用 `PageHeader`（静态页面标题取清单 label，能力层页面传层名）。大号两行展示标题因此取消，这是"并入 console 设计系统"的直接后果。atlas 布局去掉阶段 1 临时加的页边距，各页正文包在 `p-8` 里，与其余页面一致。

### 4. 待分配角色的去向

`AuthGate` 的待分配界面增加前往 `/account/identity` 的入口。机构认证审核页与用户管理页在"平台"分区里已是相邻 tab，只在两页说明里写明上下游（审核通过 → 到用户管理分配角色），不另加链接。

## Risks / Trade-offs

- atlas 是整块换令牌与类名，可能有漏改导致样式丢失 → 取值逐一相同，守护禁 `--at-`，四个页面与弹层逐一截图核对。
- `.cs, .codex` 共享令牌后，`.codex` 弹层依赖 `console.css` 已加载 → 它由 console 布局引入，atlas 只存在于 console 内。
- 待办计数依赖各列表接口，角色无权的来源不请求；接口失败显示"—"。
- 没有真实后端联调，合约状态词（`draft` = 待签发）取自合约页现有文案与代码。

## Migration Plan

纯前端改动。回滚 = 回退提交。

## Open Questions

无。
