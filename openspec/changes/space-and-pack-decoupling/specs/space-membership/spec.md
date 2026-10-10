# space-membership

两层成员体系与入域流程：机构为权威主体、人为派生；入域 = 邀请 + 审批（不开放）。

## ADDED Requirements

### Requirement: 空间由 operator 创建
空间创建与删除 SHALL 仅对 `operator` 开放；系统 MUST NOT 提供用户自建空间的路径。

#### Scenario: operator 建空间
- **WHEN** operator 以非空且未占用的 id 创建空间
- **THEN** 创建成功并返回 active 状态

#### Scenario: 普通用户建空间被拒
- **WHEN** 非 operator 用户提交创建空间
- **THEN** 403，且不创建任何空间

### Requirement: 两层成员关系
系统 SHALL 以 `cp_space_member(spaceId, subjectType, subjectId, role, status, ...)` 表达成员关系；`subjectType` SHALL 能区分机构与用户。

#### Scenario: 机构入域派生人员资格
- **WHEN** 某机构成为空间成员
- **THEN** 该机构人员获得该空间的成员资格（派生），并经域内角色判定可见范围

#### Scenario: 个人跨机构受邀入域
- **WHEN** 一名用户以个人身份被直接邀请入域
- **THEN** 其成员关系以 subjectType=user 单独记录，不改变其所属机构的其他域关系

### Requirement: 域内角色
域内角色 SHALL 存于成员关系，MUST NOT 由全局用户记录单值承载。

#### Scenario: 同一机构在不同域角色不同
- **WHEN** 某机构在空间 A 为 data-provider、在空间 B 为 data-consumer
- **THEN** 两域角色各自生效，互不覆盖

### Requirement: 邀请
邀请 SHALL 一次性、有期、token 不可枚举，并绑定被邀主体；消费后即失效。

#### Scenario: 邀请不可重放
- **WHEN** 同一邀请 token 被再次使用
- **THEN** 拒绝

#### Scenario: 过期邀请失效
- **WHEN** 使用已过期的邀请 token
- **THEN** 拒绝

#### Scenario: token 不可枚举
- **WHEN** 攻击者尝试猜测邀请 token
- **THEN** token 空间足够大且不可由已知 id 推导

### Requirement: 审批
系统 SHALL 提供机构申请加入 + `operator` 审批的路径；资质腿 SHALL 复用既有机构认证申请。

#### Scenario: 审批通过后入域
- **WHEN** operator 批准某机构的入域申请
- **THEN** 该机构成为成员，状态 active，并写入审计

#### Scenario: 非 operator 无法审批
- **WHEN** 非 operator 用户提交审批决定
- **THEN** 403

### Requirement: 一个用户多空间与切换
用户 SHALL 能同时属于多个空间，并能在其间切换；系统 SHALL 提供可切换空间列表。

#### Scenario: 多空间列表
- **WHEN** 用户属于两个空间并请求可切换列表
- **THEN** 返回两个空间及其在各自域内的角色

### Requirement: 入域操作留痕
入域、邀请、审批、角色授予 SHALL 进审计。

#### Scenario: 角色授予留痕
- **WHEN** 授予或变更某成员在域内的角色
- **THEN** 生成含操作者、被授予者、域、时间与旧值的审计记录
