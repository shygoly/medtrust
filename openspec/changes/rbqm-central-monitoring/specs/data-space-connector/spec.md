## ADDED Requirements

> Delta 说明：叠加于既有 `data-space-connector` 能力，新增站点级 KRI 聚合任务类型。既有出域守卫、脱敏、输出闸门行为不变，本 change 复用它们，故用 ADDED。

### Requirement: 站点级 KRI 聚合本地计算

连接器 SHALL 支持一类新任务：站点级 KRI 聚合。给定本地脱敏记录，连接器 MUST 在**院内本地**计算 KRI 的 `{numerator, denominator, value}`，MUST NOT 将任何个体/行级记录用于出域。

聚合结果出域前 MUST 经既有输出闸门：分母低于小格抑制阈值（硬底 5）的 KRI MUST 被抑制（标记 `suppressed`，不携带精确分子/分母）。连接器回传控制面的载荷 MUST 仅为聚合三元组 + 元数据（站点、周期、KRI code），MUST NOT 含行级数据。

#### Scenario: KRI 在本地算、仅回传聚合
- **WHEN** 连接器收到某 KRI 的站点级聚合任务
- **THEN** 连接器 MUST 在本地计算聚合量，回传载荷 MUST NOT 含个体记录

#### Scenario: 小分母 KRI 被抑制
- **WHEN** 某站点某 KRI 的分母 < 5
- **THEN** 输出闸门 MUST 抑制该 KRI，回传的观测 MUST 标记 `suppressed`

#### Scenario: 无有效授权时拒绝
- **WHEN** 发起的 KRI 聚合任务无对应有效合约/授权
- **THEN** 连接器 PEP MUST fail-closed 拒绝该任务（与既有 RWS 任务同语义）
