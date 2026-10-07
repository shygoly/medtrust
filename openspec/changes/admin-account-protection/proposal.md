## Why

平台管理员（`admin`）独占系统状态与基础设施页面（空间、CA 证书生命周期、开放平台应用）。但用户管理接口 `PATCH /admin/users/:id` 对运营方开放且不限制可授予的角色：运营方可以把任何人（包括自己）设为 `admin`，也可以重置 admin 的密码后接管其账号。演示账号播种不创建 admin，所以这条接口目前同时是 admin 账号的唯一来源。

维护者裁决（2026-10-07）：admin 只能由有服务器权限的人授予与管理，控制台接口不提供这条路径。

## What Changes

- 用户管理接口拒绝三类操作：把任何用户的角色设为 `admin`；修改现有 admin 账号的任何属性（角色、参与方、状态、姓名、密码）；修改自己的角色。
- 新增服务器侧命令 `admin-role.cli`：按邮箱授予或撤销 admin，直接操作数据库，只能在 API 所在的服务器/容器内执行。
- 用户管理页不再提供"平台管理员"作为可分配角色；admin 账号与本人所在行显示为只读。
- 登记决策 D-ID-3。

## Capabilities

### New Capabilities
- `user-administration`: 运营方的用户管理边界，以及平台管理员账号的授予方式。

### Modified Capabilities

无。

## Impact

- 后端：`apps/api/src/admin/{admin.service,admin.controller}.ts` 及单测；新增 `admin-role.ts`、`admin-role.cli.ts` 及单测。
- 前端：`apps/web/src/lib/nav.ts`、`(console)/space/admin/users/page.tsx`。
- 治理文档：`DECISIONS.md`（D-ID-3）、`DESIGN.md §8`。
- **部署影响**：上线后控制台无法再产生 admin。已有的 admin 账号不受影响；新增 admin 需在服务器上执行一次命令。
