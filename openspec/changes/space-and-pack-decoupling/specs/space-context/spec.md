# space-context

请求级空间上下文：每个请求解析出空间、校验成员关系、写入上下文载体，并保证仓储层强制按空间过滤。空间上下文的强制校验是"切换空间"能生效、且不发生静默跨空间泄漏的前提。

## ADDED Requirements

### Requirement: 请求级空间上下文来源与优先级
系统 SHALL 从 JWT 声明解析空间，并 MAY 允许 `X-Space-Id` 请求头覆盖；请求头覆盖 SHALL 仅在该用户已属于该空间时被接受。

#### Scenario: 头部覆盖仅限本用户空间
- **WHEN** 用户携带属于其成员集合的空间 id 请求
- **THEN** 该空间成为本次请求的上下文空间

#### Scenario: 伪造空间被拒
- **WHEN** 用户携带不属于其成员集合的空间 id
- **THEN** 返回 403，且不泄漏该空间是否存在

### Requirement: SpaceGuard 强制校验
每个业务端点 SHALL 经 SpaceGuard 校验，缺失或非法空间上下文即拒绝（fail-closed）。

#### Scenario: 无空间上下文的请求被拒
- **WHEN** 请求未携带任何空间声明且无法从默认空间推导
- **THEN** 返回 403，业务逻辑不执行

#### Scenario: 合法上下文放行
- **WHEN** 请求携带用户所属空间且成员状态为 active
- **THEN** 请求以该空间为上下文继续执行

### Requirement: 上下文载体取代环境变量
运行时 SHALL 经 `AsyncLocalStorage`（或等价请求作用域载体）传递空间，业务代码 MUST NOT 直接读取 `process.env.SPACE_ID`；过渡期 SHALL 保留环境变量为默认空间并输出弃用告警。

#### Scenario: 业务代码不再读环境变量
- **WHEN** 检查改造后的运行时代码
- **THEN** 不存在直接读取 `process.env.SPACE_ID` 的业务路径，仅保留默认空间兜底并输出弃用告警

### Requirement: 仓储层强制注入
仓储访问 SHALL 统一注入 `WHERE space_id = ?`；越权查询由仓储层拦截，MUST NOT 依赖逐个 service 自行过滤。

#### Scenario: 漏改的查询仍被拦
- **WHEN** 某 service 未显式过滤空间
- **THEN** 仓储层仍只返回本空间数据

### Requirement: 空间切换
系统 SHALL 提供 `POST /auth/switch-space`：校验成员关系后返回该用户可切换空间列表或换发令牌。

#### Scenario: 切换到自己所属的空间
- **WHEN** 用户请求切换到其成员集合中的空间
- **THEN** 返回该空间的新令牌（或可切换空间列表）

#### Scenario: 切换到非成员空间被拒
- **WHEN** 用户请求切换到其非成员空间
- **THEN** 403，且不泄漏该空间是否存在

### Requirement: 单空间行为零变更与越权负例
改造后单空间部署的行为 SHALL 与改造前一致；系统 SHALL 提供"伪造 spaceId 访问越权数据即报错"的负例测试。

#### Scenario: 单空间回归
- **WHEN** 以单空间配置运行既有测试套件
- **THEN** 全部通过，行为与改造前一致

#### Scenario: 越权访问负例报错
- **WHEN** 以 A 空间身份请求 B 空间的数据
- **THEN** 请求被拒且在测试中报错
