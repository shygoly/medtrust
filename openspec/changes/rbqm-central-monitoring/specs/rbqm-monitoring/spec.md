## ADDED Requirements

### Requirement: KRI 定义与 QTL 阈值分层

`rbqm-monitoring` SHALL 允许在控制面登记 KRI（关键风险指标）定义，每个定义 MUST 携带口径方向（`direction`，`higher_worse` | `lower_worse`）、风险分层（`riskTier`，`routine` | `elevated` | `intensive`）与**分层阈值数组**（`thresholds`，每项 `{level: 'warning'|'critical', op, value}`）。

系统 MUST NOT 内置 KRI 之间的优劣或重要性排序——分类分层由 `riskTier` 与阈值配置表达（对齐 CSDR《RBQM 分类分层实施路径》），不由代码硬编码。

#### Scenario: 登记带分层阈值的 KRI
- **WHEN** 登记一个 `direction=higher_worse` 且含 warning/critical 两层阈值的 KRI
- **THEN** 控制面 MUST 持久化该定义并在监查台可查

#### Scenario: 系统不排序 KRI
- **WHEN** 存在多个不同 `riskTier` 的 KRI
- **THEN** 系统 MUST NOT 标注某 KRI 比另一个"更关键"，只按配置的分层呈现

### Requirement: 站点级 KRI 观测仅接收聚合量

`rbqm-monitoring` SHALL 只接收站点级聚合观测（`{numerator, denominator, value, cohortSize}`），MUST NOT 接收任何个体级/行级数据。分母低于小格抑制阈值（硬底 5）的观测 MUST 被标记 `suppressed` 且不携带可反推的原始计数。

#### Scenario: 接收过闸后的站点聚合
- **WHEN** 一个连接器回传某站点某 KRI 的聚合观测
- **THEN** 控制面 MUST 入库该观测，且入库内容 MUST NOT 含个体标识或行级数据

#### Scenario: 小样本观测被抑制
- **WHEN** 某观测的分母 < 5
- **THEN** 该观测 MUST 标记 `suppressed`，MUST NOT 暴露精确分子/分母

### Requirement: QTL 越限检测与存证

观测入库时 `rbqm-monitoring` SHALL 按 KRI 的 `direction` 与分层阈值判定越限；命中时 MUST 生成一条越限记录（`cp_qtl_breach`），记录命中的最高层级（warning|critical）。每条越限的证据摘要 MUST 经 SM3 哈希上链存证；链不可达时 MUST 降级为本地回执而非丢弃（与合约存证同语义）。

越限 MUST 进入合规告警流，供 compliance/operator 角色核验。

#### Scenario: higher_worse 指标越 critical 阈值
- **WHEN** 一个 `higher_worse` KRI 的观测值 ≥ 其 critical 阈值
- **THEN** 系统 MUST 生成 severity=critical 的越限记录并写存证

#### Scenario: 未越限不产生记录
- **WHEN** 观测值未命中任何层级阈值
- **THEN** 系统 MUST NOT 生成越限记录

#### Scenario: 越限存证降级不丢失
- **WHEN** 生成越限时链侧不可达
- **THEN** 系统 MUST 写入本地回执（`0xLOCAL:` 前缀）并保留越限记录

### Requirement: 监查台按角色门控

`rbqm-monitoring` 的监查台 SHALL 仅对 `compliance` 与 `operator` 角色可见，展示 KRI 定义（含 `riskTier`）、站点 × KRI 观测矩阵与 QTL 越限清单。其他角色 MUST NOT 访问该视图。

#### Scenario: 合规角色可见监查台
- **WHEN** compliance 或 operator 角色打开监查台
- **THEN** 系统 MUST 呈现 KRI/观测/越限三视图

#### Scenario: 无关角色被拒
- **WHEN** consumer 或 provider 角色尝试访问监查台
- **THEN** 系统 MUST NOT 返回监查数据
