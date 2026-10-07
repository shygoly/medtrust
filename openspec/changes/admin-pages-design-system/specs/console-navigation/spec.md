## ADDED Requirements

### Requirement: 平台分区页面遵循控制台设计系统
用户管理、机构认证审核、系统状态、基础设施、丝路数港互认五个页面 SHALL 只使用控制台设计令牌与组件：表格 SHALL 使用 `DataGrid`，加载、错误、空三态 SHALL 由 `DataGrid`、`ResourceList` 或 `AsyncBoundary` 呈现，SHALL NOT 使用浅色主题样式或裸 `<table>`。

#### Scenario: 暗色主题下的表格
- **WHEN** 运营方打开用户管理页
- **THEN** 用户列表以控制台表格样式呈现，背景与文字颜色来自 `--cs-*` 令牌

#### Scenario: 空与加载
- **WHEN** 列表正在加载或没有数据
- **THEN** 表格区域显示统一的加载或空状态文案

### Requirement: 非任务类状态用登记过的语义色
账号、认证申请、证书、开放平台应用、互认主体的状态 SHALL 以 `StatusChip` 呈现，其语义色 SHALL 取自 `DESIGN.md §2` 登记的映射。

#### Scenario: 待审核的认证申请
- **WHEN** 列表中有状态为待审核的申请
- **THEN** 其状态徽章为需关注色（amber）

#### Scenario: 已吊销的证书
- **WHEN** 证书注册表中有已吊销的证书
- **THEN** 其状态徽章为阻断色（red）

### Requirement: 不可逆的吊销操作须确认
吊销证书与吊销开放平台应用 SHALL 在执行前要求确认，确认文案 SHALL 说明后果。

#### Scenario: 取消吊销
- **WHEN** 管理员点击吊销后在确认框中取消
- **THEN** 不发起请求，数据不变
