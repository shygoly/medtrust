## Why

阶段 0（`ia-nav-contract`）让导航有了清单和守护，但用户看到的结构没变：侧栏仍是 22 项平铺、6 个分组混用四种分类法，详情页没有统一回程，流程相邻的页面之间缺链接。本变更是 `docs/前端信息架构改进计划.md` 的阶段 1：把清单用起来，搭出导航骨架。路由地址不变。

## What Changes

- 侧栏从 22 项降为 6 个分区入口：工作台、数据与合约、研究与任务、合规与监查、平台、能力与准入。原一级项降为分区内的局部 tab。
- 新增内容区顶部的面包屑与局部 tab（由清单生成，所有页面自动获得）。
- 新增 ⌘K 命令面板：跳转到页面、发起类动作、按 ID 直达对象详情。
- 页头标题取自清单：`PageHeader` 的 `title` 可省略，静态路由页面不再写字面量标题；5 个 admin 页改用 `PageHeader`。守护新增"标签同源"规则。
- 发起任务的三个表单页按服务端守卫限定为 `consumer`。
- 补互链：数字合约页给出合规预审入口；密算编排提交后链到产出任务；签发合约的数据产品改为从本院目录选择。
- 治理同步：`DESIGN.md §3` 重写 AppShell，`REGISTRY.md` 登记新组件。

## Capabilities

### New Capabilities

无。

### Modified Capabilities
- `console-navigation`: 新增分区导航、面包屑、命令面板、标签同源、流程相邻页面互链的要求（该能力由未归档的 `ia-nav-contract` 引入，本变更只做 ADDED）。

## Impact

- 前端：`nav.manifest.json`、`lib/nav.ts`、`components/console/{space-nav,section-bar,command-palette,nav-title,ui,issue-contract-button}.tsx`、`(console)/layout.tsx`、`(console)/console.css`、约 20 个页面的页头一行、5 个 admin 页页头、`contracts`、`atlas/yaml`。
- 脚本：`scripts/check-nav.mjs` 与其负例。
- 治理文档：`DESIGN.md`、`REGISTRY.md`。
- 后端：无改动。
- 用户可见变化：侧栏结构变化；每页顶部多出面包屑与 tab；部分页面标题改为与菜单一致；非 `consumer` 打开发起任务表单会看到无权限卡片。对外演示材料中涉及侧栏的截图需重截。
