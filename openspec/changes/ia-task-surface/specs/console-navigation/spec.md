## ADDED Requirements

### Requirement: 任务只有一个列表
控制台 SHALL 只有一个任务列表页，列出当前用户可见的 RWS 任务、L4 联邦预测任务、SecretFlow 任务与 MDOP 作业；角色为 `provider` 时 SHALL 同时列出分派给本院的入站任务。每一行 SHALL 标明所属通道并链接到该通道的详情页。

#### Scenario: MDOP 作业出现在任务列表
- **WHEN** 用户打开任务列表且存在 MDOP 作业
- **THEN** 作业以 MDOP 通道标记出现在列表中，点击进入 MDOP 作业详情

#### Scenario: 提供方看到入站任务
- **WHEN** 角色为 `provider` 的用户打开任务列表
- **THEN** 分派给本院的任务出现在列表中，并可用"分派给本院"筛出

#### Scenario: 某个来源读取失败
- **WHEN** 其中一个通道的接口读取失败
- **THEN** 其余通道的任务照常显示

### Requirement: 任务列表分面可寻址
任务列表 SHALL 支持按通道、状态、我方角色筛选，筛选条件 SHALL 写入地址查询串，以该地址直接打开 SHALL 得到同样的筛选结果。

#### Scenario: 以带分面的地址打开
- **WHEN** 用户打开 `/space/tasks?channel=mdop`
- **THEN** 列表只显示 MDOP 作业，通道分面显示为 MDOP

#### Scenario: 切换分面
- **WHEN** 用户点击状态分面的"已完成"
- **THEN** 地址更新为包含 `status=completed`，其余分面保持不变

### Requirement: 被合并页面的旧地址重定向
被删除或合并的页面地址 SHALL 登记在导航清单的重定向表中并永久重定向到新地址；重定向目标 SHALL 落在已登记的路由上；前端源码 SHALL NOT 再链接重定向源。

#### Scenario: 打开旧的列表地址
- **WHEN** 用户访问 `/space/federated`
- **THEN** 被重定向到 `/space/tasks?channel=secretflow`

#### Scenario: 打开旧的详情地址
- **WHEN** 用户访问 `/space/deliverables/t-1`
- **THEN** 被重定向到 `/space/federated/t-1?tab=deliverables`

#### Scenario: 源码仍链接旧地址
- **WHEN** 前端源码中出现指向重定向源的链接
- **THEN** `pnpm check:nav` 报错

#### Scenario: 重定向源仍有页面
- **WHEN** 重定向表中某个源地址仍存在 `page.tsx` 或清单条目
- **THEN** `pnpm check:nav` 报错

### Requirement: 旧名称仍可检索
命令面板 SHALL 以被合并页面的原名称提供跳转，指向其新地址。

#### Scenario: 用旧名称检索
- **WHEN** 用户在命令面板输入"联邦密算"
- **THEN** 结果中有一项指向 `/space/tasks?channel=secretflow`

### Requirement: SecretFlow 任务只有一个详情
同一个 SecretFlow 任务 SHALL 只有一个详情页；面向使用方的交付物内容 SHALL 作为该页的一个视图，只对 `consumer` 显示，并且是其默认视图。

#### Scenario: 使用方打开联邦任务详情
- **WHEN** `consumer` 打开某联邦任务详情
- **THEN** 默认显示交付物视图，并可切换到技术视图

#### Scenario: 其他角色打开联邦任务详情
- **WHEN** `operator` 打开同一详情
- **THEN** 只显示技术视图，不出现视图切换

### Requirement: 审计日志单一口径
审计日志页、合规告警视图与合规总览 SHALL 使用同一个查询读取审计日志；合规告警 SHALL 是审计日志页的一个可寻址视图。

#### Scenario: 打开告警视图
- **WHEN** 用户打开 `/space/audit?view=alerts`
- **THEN** 显示从审计日志识别出的告警，并可按级别筛选

#### Scenario: 总览与告警数一致
- **WHEN** 同一用户先后打开合规总览与告警视图
- **THEN** 两处的高危告警数来自同一份审计日志数据

### Requirement: 账本可反查到任务
结算台账与存证账本中带有任务归属的行 SHALL 链接到该任务的详情页。

#### Scenario: 从结算行到任务
- **WHEN** 用户点击结算台账中某一行的任务标识
- **THEN** 进入该任务的详情页
