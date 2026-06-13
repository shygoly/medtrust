## ADDED Requirements

### Requirement: 主体+数据双认证
空间准入 SHALL 同时校验参与方主体身份与其注册数据资源;主体认证与数据资源认证 MUST 均通过方可接入。

#### Scenario: 双认证通过
- **WHEN** 一个参与方完成主体身份认证且其注册的数据资源通过认证
- **THEN** 中心控制面 MUST 允许其接入空间

#### Scenario: 数据资源未认证被拒
- **WHEN** 参与方主体身份已认证但其数据资源未通过认证
- **THEN** 中心控制面 MUST 拒绝接入

### Requirement: 数据确权与分级分类
注册到空间的数据资源 SHALL 先确权再授权,且 MUST 带有分级分类标签;未确权或未分类的数据资源 MUST NOT 被授权使用。

#### Scenario: 先确权再授权
- **WHEN** 一份数据资源在未完成确权的情况下被发起授权
- **THEN** 系统 MUST 拒绝授权并提示需先确权

#### Scenario: 分级分类约束
- **WHEN** 一份数据资源注册到空间目录
- **THEN** 其元数据 MUST 包含分级分类标签

### Requirement: 国密证书身份
连接器与参与方身份 SHALL 由中心 CA 签发的 SM2 证书标识,证书 MUST 可被吊销;吊销后的身份 MUST NOT 继续参与任务交互。

#### Scenario: 证书吊销生效
- **WHEN** 中心 CA 吊销某连接器的 SM2 证书
- **THEN** 该连接器后续的任务交互请求 MUST 被拒绝
