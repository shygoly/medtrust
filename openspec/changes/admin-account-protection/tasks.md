## 1. 服务端规则

- [x] 1.1 `AdminService.updateUser` / `resetPassword` 增加三条拒绝规则；控制器传入当前用户 ID
- [x] 1.2 `admin.service.spec.ts` 补负例与正例

## 2. 服务器侧命令

- [x] 2.1 新增 `admin-role.ts`（参数解析与授予 / 撤销逻辑）与单测
- [x] 2.2 新增 `admin-role.cli.ts`（直连数据库的入口）

## 3. 前端

- [x] 3.1 `lib/nav.ts` 导出可分配角色；用户管理页下拉改用，admin 行与本人行只读

## 4. 治理与验证

- [x] 4.1 `DECISIONS.md` 登记 D-ID-3；`DESIGN.md §8` 补一条
- [x] 4.2 API 单测、类型检查；web 类型检查与单测；`check:nav`、`check:meta`、`governance`
- [x] 4.3 浏览器核对用户管理页（对桩后端）：角色下拉不含平台管理员、admin 行只读且无重置密码、本人行角色只读、筛选下拉仍含五个角色
