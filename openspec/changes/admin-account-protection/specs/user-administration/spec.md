## ADDED Requirements

### Requirement: 控制台接口不得授予平台管理员角色
用户管理接口 SHALL 拒绝把任何用户的角色设为 `admin`，并返回 403。

#### Scenario: 运营方尝试授予 admin
- **WHEN** 运营方通过用户管理接口把某用户的角色设为 `admin`
- **THEN** 接口返回 403，该用户的角色不变

#### Scenario: 分配其余角色
- **WHEN** 运营方把某用户的角色设为 `provider`、`consumer`、`operator` 或 `compliance`
- **THEN** 更新成功

### Requirement: 控制台接口不得修改平台管理员账号
用户管理接口 SHALL 拒绝修改当前角色为 `admin` 的账号的任何属性，包括角色、参与方、状态、姓名与密码，并返回 403。

#### Scenario: 重置 admin 的密码
- **WHEN** 运营方对一个 admin 账号调用重置密码
- **THEN** 接口返回 403，密码与会话不变

#### Scenario: 禁用或降级 admin
- **WHEN** 运营方把一个 admin 账号的状态设为禁用，或把其角色改为其他值
- **THEN** 接口返回 403，账号不变

### Requirement: 不得修改自己的角色
用户管理接口 SHALL 拒绝调用者修改自己的角色，并返回 403；调用者修改自己的其他属性不受此限。

#### Scenario: 运营方改自己的角色
- **WHEN** 运营方把自己的角色改为另一个值
- **THEN** 接口返回 403

#### Scenario: 运营方改自己的姓名
- **WHEN** 运营方只修改自己的姓名
- **THEN** 更新成功

### Requirement: 平台管理员只能在服务器侧授予与撤销
系统 SHALL 提供只能在 API 所在服务器上执行的命令，按邮箱授予或撤销 `admin` 角色；授予与撤销 SHALL 吊销该用户的全部刷新令牌，并输出一条包含时间、目标用户、前后角色的记录。

#### Scenario: 授予
- **WHEN** 运维对一个存在且未被禁用的账号执行授予命令
- **THEN** 该账号角色变为 `admin`，待分配状态的账号变为可用，其刷新令牌被吊销

#### Scenario: 撤销
- **WHEN** 运维对一个 admin 账号执行撤销命令并指定新角色
- **THEN** 该账号角色变为指定角色，其刷新令牌被吊销

#### Scenario: 目标不合法
- **WHEN** 邮箱不存在、授予目标已被禁用、撤销目标不是 admin，或撤销时未指定合法的新角色
- **THEN** 命令以非零状态退出并说明原因，数据不变

### Requirement: 用户管理页不提供无法执行的操作
用户管理页 SHALL NOT 在可分配角色中列出 `admin`；对 admin 账号 SHALL 只读展示；对当前登录用户所在行 SHALL NOT 提供角色修改控件。

#### Scenario: 角色下拉
- **WHEN** 运营方展开某用户的角色下拉
- **THEN** 选项为提供方、使用方、运营方、合规方，不含平台管理员

#### Scenario: admin 所在行
- **WHEN** 列表中有 admin 账号
- **THEN** 该行显示其角色与状态，不提供修改参与方、角色、状态与重置密码的控件
