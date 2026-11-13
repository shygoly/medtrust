# Spec Delta

## ADDED Requirements

### Requirement: 合约列表顺序稳定
控制面数字合约列表（`GET /contracts`）SHALL 按稳定键排序返回；默认 MUST 为最近创建（或等价时间字段）优先，并以合约 id 作为并列次序键。客户端 MUST NOT 依赖数据库默认物理顺序。

#### Scenario: 两次列表次序一致
- **WHEN** 同一查看者连续两次请求合约列表且中间无写入
- **THEN** 两次返回的合约 id 序列 MUST 相同

### Requirement: 合约列表呈现参与方与产品可读名
合约列表行 SHALL 以使用方与提供方的登记显示名、以及数据产品标题（或等价可读名）辅助扫读；MUST NOT 将参与方 id 与产品 id 作为关系行/产品行的唯一主文案。登记名或产品标题不可用时 MAY 回退为 id。

#### Scenario: 有登记名与产品标题
- **WHEN** 使用方打开合约列表，且该合约的提供方/使用方已有登记名、数据产品已有标题
- **THEN** 列表行 MUST 显示机构显示名与产品标题，MUST NOT 仅显示 `p-…` 与 `dp-…` 作为主关系/产品文案

#### Scenario: 名称不可用时回退
- **WHEN** 无法解析某一侧显示名或产品标题
- **THEN** 该位置 MUST 回退显示对应 id，且 MUST NOT 因解析失败隐藏整行

### Requirement: 合约列表以用途为标题并收敛条款摘要
合约列表主标题 SHALL 为合约目的（`purpose`）；条款类信息（留存、输出、minCell 等）SHALL 以简短摘要呈现，MUST NOT 把完整合约 id、完整参与方 id 串与 pinnedModules 截断串作为默认副行的主要噪音来源。

#### Scenario: 用途作主标题
- **WHEN** 合约 `purpose` 为「胰岛素暴露·胰腺炎信号演示研究」
- **THEN** 列表行主标题 MUST 为该用途文案

#### Scenario: 副行可读摘要
- **WHEN** 合约含 retention、output 与 minCell
- **THEN** 列表 MUST 能扫读到这些条款要点，且 MUST NOT 默认用完整合约 id 占据副行主视觉

### Requirement: 合约列表状态徽章覆盖签署子态
合约列表状态徽章 SHALL 反映对浏览方有意义的有效状态，并对「已生效」区分持签进度（已持签 / 待连接器签署 / 待持签，或等价闭集）；已知状态码 MUST 有可读中文（或登记文案），MUST NOT 对常见状态仅输出未解释英文码。

#### Scenario: 已持签
- **WHEN** 合约有效状态为生效且持有方已完成签署（holderSigned）
- **THEN** 列表徽章 MUST 显示「已持签」或登记的等价文案

#### Scenario: 待审批草稿
- **WHEN** 合约有效状态为 draft
- **THEN** 列表徽章 MUST 显示「待审批」或登记的等价文案

### Requirement: 合约列表不承载 C2 策略编辑面板
生效中合约的 C2 证明策略编辑界面 SHALL NOT 作为合约列表行的默认内嵌内容。列表 MAY 提供只读提示或入口，编辑体验 MUST 在列表行之外完成（抽屉、侧面板或独立视图）。

#### Scenario: 列表行无 C2 编辑表单
- **WHEN** 使用方打开含生效合约的数字合约列表
- **THEN** 列表行内 MUST NOT 渲染完整的 C2 策略编辑表单（链型多选、确认勾选与提交控件作为行内默认子树）

#### Scenario: 仍可到达 C2 配置
- **WHEN** 提供方需要对某份生效合约配置 C2 策略
- **THEN** 系统 MUST 仍提供从该合约可达的编辑入口，且该入口不位于列表行内嵌编辑面板

### Requirement: 合约列表页头与列表项类型可维护
数字合约列表页 SHALL 具备明确的页头标题；客户端合约列表项 SHALL 使用显式类型描述字段，MUST NOT 以无文档的 `any[]` 作为长期契约。

#### Scenario: 页头有标题
- **WHEN** 用户打开 `/space/contracts`
- **THEN** 页头 MUST 显示可读标题（例如「数字合约」），不得仅有 kicker/描述而无 title
