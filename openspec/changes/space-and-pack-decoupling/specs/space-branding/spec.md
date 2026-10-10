# space-branding

实例品牌与空间主题：受约束的 token 覆盖层。主题管"长什么样"，不管"有哪些功能"；术语由包提供，空间不可自造。

## ADDED Requirements

### Requirement: 主题级联
主题 SHALL 按 平台默认 → 实例品牌 → 空间主题 级联解析；任一层缺失 SHALL 回落到上一层，MUST NOT 出现空标题或无图占位。

#### Scenario: 空间未配置主题
- **WHEN** 某空间未设置任何品牌字段
- **THEN** 使用实例品牌；实例品牌亦缺省时使用平台默认

#### Scenario: 字段级回落
- **WHEN** 空间只设置了 logo 与标题，未设置主色
- **THEN** 主色回落到实例品牌或平台默认，其余字段取空间值

### Requirement: 受约束的 token 覆盖
空间主题 SHALL 只允许覆盖白名单令牌（logo、favicon、系统标题、短名、主色、强调色），且 MUST NOT 接受任意 CSS 文本。

#### Scenario: 白名单外令牌被拒
- **WHEN** 提交白名单之外的样式定义
- **THEN** 拒绝

#### Scenario: 任意 CSS 被拒
- **WHEN** 提交包含任意 CSS 规则或选择器的载荷
- **THEN** 拒绝

### Requirement: 不可覆盖项
系统 MUST NOT 允许覆盖状态语义色映射、功能层与能力层。

#### Scenario: 尝试覆盖状态语义色
- **WHEN** 空间主题提交对状态语义色映射的覆盖
- **THEN** 拒绝，且状态语义色保持设计规范定义值

#### Scenario: 主题不裁剪功能
- **WHEN** 空间主题被应用
- **THEN** 页面与菜单集合由能力包启用集决定，不受主题影响

### Requirement: 术语边界
界面术语 SHALL 由能力包术语表提供并受守护；空间 MAY 选择，MUST NOT 自造。

#### Scenario: 空间自造术语被拒
- **WHEN** 空间提交对界面术语的自定义文本
- **THEN** 拒绝，术语只从所启用能力包的术语表解析

### Requirement: 联邦标识边界
对远端空间，系统 SHALL 只展示其名称与标识，MUST NOT 注入其样式令牌。

#### Scenario: 远端空间不注入样式
- **WHEN** 展示来自联邦的远端空间
- **THEN** 只使用其名称与标识，页面样式仍为本地主题

### Requirement: 资源安全与可访问性
logo / favicon 上传 SHALL 经服务端校验与净化（禁脚本）、限类型与体积、禁外链；可配置主色 SHALL 通过对比度校验。

#### Scenario: 含脚本的 SVG 被拒或净化
- **WHEN** 上传含脚本的 SVG
- **THEN** 拒绝或净化为不含脚本的图片，且不引入可执行内容

#### Scenario: 对比度不足被拒
- **WHEN** 提交与文字对比度低于阈值的颜色
- **THEN** 拒绝该主题变更

### Requirement: 主题变更留痕
主题变更 SHALL 记审计并支持回滚。

#### Scenario: 主题变更可回滚
- **WHEN** 回滚到上一版主题
- **THEN** 品牌字段恢复为上一版值，且回滚本身也写入审计
