## ADDED Requirements

### Requirement: 侧栏按分区呈现
侧栏 SHALL 只列出清单中的分区，每个分区一个入口，指向该分区内当前角色可见的第一个页面；没有可见页面的分区 SHALL NOT 显示。任一角色可见的侧栏入口 SHALL NOT 超过 6 个。

#### Scenario: 提供方的侧栏
- **WHEN** 角色为 `provider` 的用户登录
- **THEN** 侧栏不显示"平台"分区，其余分区各显示一个入口

#### Scenario: 分区入口指向可见页面
- **WHEN** `provider` 点击"合规与监查"
- **THEN** 进入该分区内其可见的第一个页面，而不是无权限卡片

### Requirement: 分区内局部导航
内容区顶部 SHALL 显示当前分区内对当前角色可见的页面作为局部 tab，并标出当前页所属的 tab；可见页面只有一个时 SHALL NOT 显示 tab 条。

#### Scenario: 详情页高亮所属 tab
- **WHEN** 用户打开某任务的详情页
- **THEN** "研究与任务"分区的 tab 条显示，且"编排任务"为当前 tab

#### Scenario: 单页面分区
- **WHEN** 用户位于只有一个可见页面的分区
- **THEN** 不显示 tab 条

### Requirement: 面包屑回程
每个控制台页面 SHALL 显示由清单父链生成的面包屑；面包屑中当前页之前的每一级 SHALL 可点击并到达对应页面。

#### Scenario: 详情页回到列表
- **WHEN** 用户在 MDOP 作业详情页点击面包屑中的"MDOP 作业"
- **THEN** 回到 MDOP 作业列表

#### Scenario: 跨路径的父级
- **WHEN** 用户在本地推理页点击面包屑中的"任务详情"
- **THEN** 回到同一任务的联邦预测详情

### Requirement: 命令面板
控制台 SHALL 提供以 ⌘K 或 Ctrl+K 开合的命令面板，支持键盘选择与执行，列出当前角色可见的页面跳转与发起类动作；输入不匹配任何命令时 SHALL 提供按该输入作为 ID 打开对象详情的选项。命令面板 SHALL NOT 列出当前角色无权访问的页面。

#### Scenario: 按名称跳转
- **WHEN** 用户按 ⌘K 输入"结算"并回车
- **THEN** 进入结算页

#### Scenario: 按 ID 直达
- **WHEN** 用户在面板输入一个任务 ID
- **THEN** 面板给出打开任务详情、MDOP 作业详情、联邦任务详情的选项，选择后进入对应详情页

#### Scenario: 无权限的页面不出现
- **WHEN** `provider` 在面板输入"审计"
- **THEN** 结果中没有审计日志

### Requirement: 页面标题与菜单名同源
静态路由页面的页头标题 SHALL 取自清单 label；页面 SHALL NOT 以字符串字面量指定页头标题。动态详情页可以使用对象自身的标题。

#### Scenario: 页面写了字面量标题
- **WHEN** 某静态路由页面的 `PageHeader` 带字符串字面量 `title`
- **THEN** `pnpm check:nav` 报错

#### Scenario: 标题随清单变化
- **WHEN** 修改清单中某页面的 label
- **THEN** 侧栏 tab、面包屑、页头标题、命令面板同时变化

### Requirement: 发起任务仅对使用方开放
发起任务的入口页与表单页 SHALL 只对 `consumer` 角色可见，与服务端提交接口的角色守卫一致。

#### Scenario: 非使用方打开发起表单
- **WHEN** 角色为 `provider` 的用户访问 `/space/tasks/new/rws`
- **THEN** 显示无权限卡片

### Requirement: 流程相邻页面互链
流程中存在硬前置或直接产出关系的页面 SHALL 互相给出入口：申请合约处 SHALL 给出合规预审入口；密算编排提交成功后 SHALL 给出所产出任务的链接；签发合约时数据产品 SHALL 从本机构的数据产品中选择，而非手工输入 ID。

#### Scenario: 从合约页去预审
- **WHEN** `consumer` 打开数字合约页
- **THEN** 页头可见前往合规预审的入口

#### Scenario: 编排提交后跟进
- **WHEN** 用户在密算编排页提交成功并获得任务 ID
- **THEN** 页面出现指向该联邦任务详情的链接

#### Scenario: 签发合约选择产品
- **WHEN** `provider` 打开签发合约表单
- **THEN** 数据产品为下拉选择，选项是本机构已发布的数据产品
