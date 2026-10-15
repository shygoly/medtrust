## ADDED Requirements

### Requirement: 分类计数算子的下标位宽
`rws.categorical-count` 算子 SHALL 接受最多 4096 个分类键，分类下标在 ABI 输入区以 **u16**（2 字节步长）编码；
宿主 SHALL 以 `categorical-count@2` 声明该 ABI，模块 SHALL 导出 `abi_version = 2`。

#### Scenario: 分类键超过旧上限
- **WHEN** 一份计划的闭合分类键有 67 项（AMR 研究编码：specimen/organism/resist）
- **THEN** 节点执行成功，且各分类计数与 TS 参考实现逐字段一致

#### Scenario: 超过新上限
- **WHEN** 闭合分类键超过 4096 项
- **THEN** 阶段以参数非法拒绝执行（fail-closed），不静默截断

#### Scenario: 跨 ABI 版本混跑
- **WHEN** 宿主以 `categorical-count@2` 声明而模块自述 `abi_version = 1`（或反之）
- **THEN** 实例化前校验失败并拒绝执行，不产生任何计数

### Requirement: 分类键与分层键的上限不得混用
分类键（闭合标签集）的上限 SHALL 独立于分层键（`<年龄段>|<性别>`）的 64 上限；提升分类键上限 MUST NOT 放宽分层键校验。

#### Scenario: 分层键仍受 64 上限约束
- **WHEN** 一份计划给出的分层键超过 64 项
- **THEN** 阶段仍以「至多 64 个」拒绝
