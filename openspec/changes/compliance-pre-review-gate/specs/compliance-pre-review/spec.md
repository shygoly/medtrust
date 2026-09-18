## ADDED Requirements

### Requirement: 预审只能引用已落地能力对象
平台 SHALL 在服务端创建预审组合时校验：场景与各层所选能力对象都必须存在于能力注册表，且落地状态为 `active`。任一对象不存在或未落地，MUST 拒绝创建，并列出不合格对象。

#### Scenario: 选了未落地对象
- **WHEN** 请求创建的预审组合里包含 `status` 为 `draft` 的协议 `tee-sgx`
- **THEN** 平台 MUST 拒绝创建，并在错误中列出 `tee-sgx`

#### Scenario: 引用了不存在的对象
- **WHEN** 预审组合里包含注册表中不存在的 key
- **THEN** 平台 MUST 拒绝创建

#### Scenario: 全部已落地
- **WHEN** 预审组合里的场景与各层对象都存在且为 `active`
- **THEN** 平台创建组合并返回 ID

### Requirement: 风险维度事实优先并标注来源
平台 SHALL 在每次裁决时，对能从系统事实推导的风险维度一律使用推导值：数据敏感度取数据产品的分级标签；参与机构数在任务层取任务实际涉及的医院数；是否含人类遗传资源在有类别对照时由分级标签推导。无法推导的维度使用申请方自报值。裁决结果 MUST 为每个维度标注来源（`derived` / `declared`）。自报值比推导值风险更低时，MUST 记录为维度冲突，并在警告中列出。

#### Scenario: 推导覆盖自报
- **WHEN** 预审自报参与机构数为 2，而任务实际涉及 3 家医院
- **THEN** 复评 MUST 按 3 家计算，该维度标为 `derived`，并记录一条维度冲突

#### Scenario: 无事实来源
- **WHEN** 跨境维度没有任何系统事实可用
- **THEN** 平台使用自报值，并将该维度标为 `declared`

### Requirement: 风险维度可上调风险等级
L2 引擎 SHALL 取「场景声明的风险」与「按维度判定的风险」中较高者作为总体风险：参与机构数不少于 3、或含人类遗传资源时，按维度判定的风险 MUST 为 high。

#### Scenario: 三家机构升为 high
- **WHEN** 场景声明风险为 medium，推导出的参与机构数为 3
- **THEN** 总体风险 MUST 为 high，并按 high 的风险策略计算合规要求

### Requirement: 各风险等级强制所需保障级
L2 引擎 SHALL 对每一个风险等级强制其风险策略所要求的保障级：所选协议推出的保障级低于要求时，裁决 MUST 为驳回（`block-security-below-required`）。各风险等级要求的保障级口径以 DECISIONS 登记的决定为准。

#### Scenario: 保障级不足被驳回
- **WHEN** 总体风险对应的策略要求的保障级高于所选协议能达到的保障级
- **THEN** 裁决 MUST 为驳回，命中规则 `block-security-below-required`

### Requirement: 裁决快照
平台 SHALL 为每次用于合约或任务的裁决生成快照，内容包括：预审 ID、裁决 ID、裁决结论、总体风险、合规要求、各维度取值及来源、维度冲突、所用 L2 规则的摘要（规则稳定序列化后的 SM3），以及裁决时间。

#### Scenario: 快照可追溯规则版本
- **WHEN** 一份合约签发后，L2 规则被修改
- **THEN** 合约快照中的规则摘要 MUST 仍等于签发时所用规则的 SM3，可与当前规则的摘要比对出差异

### Requirement: 任务准入复核预审
平台 SHALL 在创建 RWS、FL 预测、SecretFlow 任务时，对每一份被引用的合约执行同一套复核：
- 合约 MUST 带有预审快照；
- 任务的分析类型 MUST 被预审中至少一个 L3 模型覆盖（按能力对象登记的分析类型对应关系）；分析类型没有登记对应关系时，MUST 拒绝；
- MUST 用任务层推导的风险维度按当前 L2 规则重新裁决：驳回即拒；需审批只有在合约里有医院显式确认时才放行。

任一不满足，MUST 拒绝创建任务，并写明原因。

#### Scenario: 合约没有预审快照
- **WHEN** 创建任务时引用的合约是本变更前签发的，没有预审快照
- **THEN** 平台 MUST 拒绝创建，提示需要重新申请带预审的合约

#### Scenario: 任务超出预审范围
- **WHEN** 合约的预审只包含 `disproportionality-prr-ror`，而任务的分析类型为 `comparative-effect`
- **THEN** 平台 MUST 拒绝创建，提示任务超出预审范围

#### Scenario: 规则收紧后新任务被拒
- **WHEN** 合约签发后 L2 规则收紧，按当前规则复评的结果为驳回
- **THEN** 平台 MUST 拒绝在该合约下创建新任务

#### Scenario: 需审批且已确认
- **WHEN** 复评结果为需审批，且合约里有医院的显式确认
- **THEN** 平台允许创建任务

#### Scenario: SecretFlow 不再接受请求体里的组合 ID
- **WHEN** 创建 SecretFlow 任务的请求体带有 `compositionId`
- **THEN** 平台 MUST 忽略该字段，只按各 provider 方合约的预审快照复核
