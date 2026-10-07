## ADDED Requirements

### Requirement: 导航清单为单一事实源
控制台 `(console)/space` 下的每个页面路由 SHALL 在 `apps/web/src/nav.manifest.json` 中恰好登记一次；侧栏菜单 SHALL 由该清单生成，不得在组件内另写菜单项。

#### Scenario: 新增页面未登记
- **WHEN** 在 `(console)/space` 下新增一个 `page.tsx` 而未在清单登记
- **THEN** `pnpm check:nav` 报错并指出该路由

#### Scenario: 清单登记了不存在的路由
- **WHEN** 清单中某条目的 `route` 没有对应的 `page.tsx`
- **THEN** `pnpm check:nav` 报错并指出该条目

#### Scenario: 侧栏按角色显示
- **WHEN** 用户以某角色登录
- **THEN** 侧栏只显示清单中 `entry` 为 `menu` 且该角色可见的条目，没有可见条目的分组不显示

### Requirement: 非菜单页面必须可达
`entry` 为 `contextual` 的条目 SHALL 声明 `parent`，其父链 SHALL 终止于一个菜单条目，且前端源码中 SHALL 至少有一处指向该路由的链接。

#### Scenario: 详情页没有任何入口链接
- **WHEN** 某 `contextual` 条目的路由在其自身目录之外没有任何链接引用
- **THEN** `pnpm check:nav` 报错

#### Scenario: 父链成环或悬空
- **WHEN** 某条目的 `parent` 指向不存在的路由，或父链成环
- **THEN** `pnpm check:nav` 报错

### Requirement: 流程契约中的页面必须在清单中标注
`FLOWS.md` 中以 `(console)/space` 下 `page.tsx` 为 actor 的每个步骤，其页面 SHALL 在清单中登记，且条目的 `flows` SHALL 包含该 FLOW 编号；清单中出现的 FLOW 编号 SHALL 在 `FLOWS.md` 中存在。

#### Scenario: 流程终点页未标注
- **WHEN** `FLOWS.md` 把某控制台页面登记为 FLOW-RWS-04 的 actor，而清单中该页条目的 `flows` 不含 FLOW-RWS-04
- **THEN** `pnpm check:nav` 报错

#### Scenario: 清单引用了不存在的流程
- **WHEN** 清单条目的 `flows` 含 `FLOWS.md` 中没有的编号
- **THEN** `pnpm check:nav` 报错

### Requirement: 页面可见角色与服务端一致
声明了 `guards` 的清单条目，其 `roles` SHALL 等于各 guard 端点 `@ParticipantRoles` 角色的并集；端点无方法级角色时取控制器类级角色，两者都没有时视为全部角色。

#### Scenario: 菜单比服务端严
- **WHEN** 服务端端点允许 `operator` 与 `admin`，而清单条目的 `roles` 只有 `admin`
- **THEN** `pnpm check:nav` 报错

#### Scenario: 菜单比服务端松
- **WHEN** 服务端端点只允许 `compliance` 与 `operator`，而清单条目对全部角色可见
- **THEN** `pnpm check:nav` 报错

#### Scenario: guard 指向的端点找不到
- **WHEN** 条目的某个 `guards` 在控制器源码中定位不到对应路由
- **THEN** `pnpm check:nav` 报错，而不是跳过对拍

### Requirement: 角色词汇一致
系统 SHALL 只有五个参与方角色：`provider`、`consumer`、`operator`、`compliance`、`admin`。清单的 `roles`、前端会话类型、服务端用户更新 DTO 的角色枚举、`DESIGN.md` 的角色定义四处 SHALL 完全一致。

#### Scenario: 文档与代码角色不一致
- **WHEN** 四处中任意一处的角色集合与清单不同
- **THEN** `pnpm check:nav` 报错并指出不一致的位置

#### Scenario: 用户管理可选角色
- **WHEN** 运营方打开用户管理页的角色下拉
- **THEN** 可选项恰为清单中的五个角色

### Requirement: 角色门控在布局层统一执行
控制台布局 SHALL 按当前路径匹配清单条目并校验角色；角色不在条目 `roles` 内时 SHALL 渲染统一的无权限卡片而不渲染页面。`(console)/space` 下的页面 SHALL NOT 自行实现整页角色门控。

#### Scenario: 无权限用户打开深链
- **WHEN** 角色为 `provider` 的用户直接访问 `/space/audit`
- **THEN** 显示无权限卡片，列出该页面向的角色，并提供返回总览的入口，页面内容与其请求不发出

#### Scenario: 有权限用户访问
- **WHEN** 角色为 `compliance` 的用户访问 `/space/audit`
- **THEN** 正常渲染页面

#### Scenario: 页面内重新出现整页门控
- **WHEN** `(console)/space` 下的源码出现手写的整页角色早返回
- **THEN** `pnpm check:nav` 报错

### Requirement: 同一对象不得有两个菜单列表
两个 `entry` 为 `menu` 且 `viewLayer` 相同的条目 SHALL NOT 共享 `entities`，除非该组合登记在清单的豁免名单中并写明原因与负责消除它的变更；不再成立的豁免 SHALL 被视为错误。

#### Scenario: 新增重复列表页
- **WHEN** 新增一个菜单列表页，其 `entities` 与已有菜单列表页有交集且未登记豁免
- **THEN** `pnpm check:nav` 报错

#### Scenario: 豁免已过期
- **WHEN** 豁免名单中某条对应的两个条目已不再重叠
- **THEN** `pnpm check:nav` 报错，要求删除该豁免

### Requirement: 导航守护随测试执行并自证有效
`scripts/check-nav.mjs` SHALL 接入根 `pnpm test`；每条规则 SHALL 有负例测试证明违规会被抓住，并有合法样例证明不误报。

#### Scenario: 守护接入测试链
- **WHEN** 运行根 `pnpm test`
- **THEN** 导航守护与其负例测试被执行，任一失败则整体失败

### Requirement: 任务提交后的跟进链接指向所属通道
任务提交成功后给出的"查看"链接 SHALL 指向该任务实际所在通道的详情页。

#### Scenario: 经 MDOP 通道提交
- **WHEN** 用户在 RWS 表单勾选经 MDOP 执行并提交成功
- **THEN** 跟进链接指向 `/space/mdop/jobs/{jobId}`

#### Scenario: 经 RWS 通道提交
- **WHEN** 用户未勾选 MDOP 并提交成功
- **THEN** 跟进链接指向 `/space/tasks/{taskId}?workload=rws`

### Requirement: 总览只展示真实数据
`/space` 总览的指标与列表 SHALL 来自与对应明细页相同的后端查询，SHALL NOT 使用静态演示数据；列表行的链接 SHALL 指向真实存在的详情。

#### Scenario: 数值与明细页一致
- **WHEN** 同一用户先后打开总览与编排任务页
- **THEN** 总览的最新任务取自同一任务集合，点击任一行进入的详情页能查到该任务

#### Scenario: 后端查询失败
- **WHEN** 某项查询失败
- **THEN** 对应区块显示错误态，不回落到演示数据

### Requirement: QTL 越限可在界面确认
RBQM 监查页 SHALL 允许有权限的角色对处于开放状态的 QTL 越限执行确认，确认后该行状态更新为已确认。

#### Scenario: 确认开放越限
- **WHEN** `compliance` 或 `operator` 角色在开放越限行点击确认
- **THEN** 调用确认接口，成功后该行显示为已确认，开放越限计数相应减少
