## 1. 清单与访问层

- [x] 1.1 `nav.manifest.json`：`groups` 改为 6 个分区（带 `icon` / `en`），条目按分区重排并去掉条目级图标；推理页加 `parentQuery`；三个发起表单加 `roles` 与 `guards`
- [x] 1.2 `lib/nav.ts`：分区入口、面包屑、命令（跳转 / 动作 / 按 ID 直达）纯函数；`nav.test.ts` 覆盖
- [x] 1.3 `scripts/check-nav.mjs` N0 适配分区字段，负例同步

## 2. 导航骨架

- [x] 2.1 `space-nav.tsx`：侧栏只列分区
- [x] 2.2 新增 `section-bar.tsx`（面包屑 + 局部 tab）并挂入布局；`console.css` 增加 tab 样式
- [x] 2.3 新增 `command-palette.tsx`，侧栏顶部加触发按钮

## 3. 骨架验证与治理

- [x] 3.1 `DESIGN.md §3` 重写 AppShell；`REGISTRY.md` 登记新组件
- [x] 3.2 守护、单测、类型检查、lint
- [x] 3.3 浏览器走查：各角色侧栏、tab、面包屑、⌘K

## 4. 标签与页头

- [x] 4.1 新增 `nav-title.tsx`，`PageHeader` 的 `title` 改为可选
- [x] 4.2 静态路由页面删除字面量标题；5 个 admin 页改用 `PageHeader`
- [x] 4.3 `check-nav.mjs` 新增 N9（标签同源）与负例

## 5. 互链

- [x] 5.1 数字合约页加合规预审入口
- [x] 5.2 密算编排提交后链到产出任务
- [x] 5.3 签发合约的数据产品改为下拉选择

## 6. 收尾验证

- [x] 6.1 守护、单测、类型检查、lint
- [x] 6.2 浏览器走查（暗色主题，对桩后端）：标题取自清单、admin 页头、合约页预审入口、签发合约产品下拉只列本机构产品、非 consumer 打开发起表单见无权限卡片。未走查：密算编排提交后的任务链接（桩后端不产生任务 ID，仅代码核对）
- [x] 6.3 同步 `docs/前端信息架构改进计划.md` 阶段 1 状态
