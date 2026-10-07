## Why

"平台"分区的五个页面（用户管理、机构认证审核、系统状态、基础设施、丝路数港互认）在导航重构里只换了页头，正文仍是浅色主题的 Tailwind 类和裸 `<table>`：暗色控制台里出现白底表格，文字对比度不足，也违反 `DESIGN.md §9` 的第 1、2、4、8 条。

## What Changes

- 五个页面的正文改用 console 设计系统：表格用 `DataGrid`，卡片列表用 `ResourceList`，加载 / 错误 / 空三态交给它们；输入、下拉、按钮用 `cs-input` / `cs-btn`；颜色只用 `--cs-*`。
- 新增三个 console 原语并登记：`Banner`（页顶的提交级错误与操作结果）、`StatusChip`（非任务类状态的徽章）、`Field`（标签-值对）。
- `DESIGN.md §2` 登记平台分区用到的状态及其语义色；顺带修正该节仍引用已删除的 `--at-*` 令牌与 `at-*` 类名的一段。
- 证书吊销与开放平台应用吊销增加确认提示并说明后果（`DESIGN.md §7`：不可逆操作须确认）。
- 取数逻辑、接口与权限不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities
- `console-navigation`: 新增"平台分区页面遵循控制台设计系统"的要求（该能力由未归档的 `ia-nav-contract` 引入，本变更只做 ADDED）。

## Impact

- 前端：`(console)/space/admin/{users,certifications,system,infra,interop}/page.tsx`、`components/console/ui.tsx`、新增 `lib/status-tone.ts` 及单测。
- 治理文档：`DESIGN.md`（§2、§5）、`REGISTRY.md`。
- 后端：无改动。
