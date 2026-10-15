## ADDED Requirements

### Requirement: 需求响应计划模板
系统应提供 `power.demand-response` 计划模板，支持多用户需求响应优化场景。

#### Scenario: 模板输入校验
- **WHEN** 用户提交需求响应计划
- **THEN** 系统应校验以下必填字段：
  - `purpose`（计划目的）
  - `applicant`（申请方，包含 org 和 project）
  - `contracts`（合约列表，至少 1 份）
  - `participants`（参与方列表，至少 2 方）
  - `spec.targetLoad`（目标负荷曲线，24 小时）
  - `spec.incentiveBudget`（激励预算，单位：元）
  - `spec.timeWindow`（调节时间窗口，[start, end]）
  - `notBefore` 和 `notAfter`（计划有效期）

#### Scenario: 拒绝非法输入
- **WHEN** 用户提交的输入不满足约束
- **THEN** 系统应拒绝并返回明确错误：
  - 参与方少于 2 方 → "需求响应至少需要 2 方参与"
  - 激励预算 ≤ 0 → "激励预算必须为正数"
  - `targetLoad` 长度 ≠ 24 → "目标负荷曲线应包含 24 小时数据"
  - 时间窗口无效（start ≥ end）→ "调节时间窗口无效"

### Requirement: 需求响应阶段链
需求响应计划应生成包含潜力评估、脱密、优化的完整阶段链。

#### Scenario: 各参与方阶段链
- **WHEN** 构建需求响应计划
- **THEN** 每个参与方应有 3 个阶段：
  - `source.dataset@1.0.0`（数据源）
  - `power.dr-potential@1.0.0`（可调节负荷潜力评估）
  - `declassify.small_cell@1.0.0`（小单元脱密）

#### Scenario: 平台优化阶段
- **WHEN** 构建需求响应计划
- **THEN** 应生成一个 `power.dr-optimize@1.0.0` 阶段：
  - 输入：所有方的脱密潜力评估
  - 参数：`spec`（透传用户输入的 spec）
  - 节点：`platform`

### Requirement: 可调节负荷潜力评估算子
`power.dr-potential@1.0.0` 算子应评估用户的可调节负荷潜力。

#### Scenario: 输入数据格式
- **WHEN** 算子接收输入数据
- **THEN** 数据应包含：
  - 历史负荷曲线（至少 7 天）
  - 用户类型（工业 / 商业 / 居民）
  - 可调节设备清单（可选）
  - 舒适度约束（温度范围、照明要求等，可选）

#### Scenario: 评估可削减容量
- **WHEN** 算子评估峰时可削减容量
- **THEN** 应计算：
  - 各时段最大可削减功率（kW）
  - 可持续时长（分钟）
  - 削减成本（元/kWh）

#### Scenario: 评估可转移容量
- **WHEN** 算子评估谷时可转移容量
- **THEN** 应计算：
  - 各时段最大可接受功率（kW）
  - 可持续时长（分钟）
  - 转移意愿（权重 0-1）

#### Scenario: 考虑舒适度约束
- **WHEN** 算子评估潜力时
- **THEN** 应：
  - 遵守用户指定的舒适度约束（温度、照明等）
  - 不超过设备额定容量
  - 不违反安全运行规则

#### Scenario: 输出格式
- **WHEN** 算子完成潜力评估
- **THEN** 输出应包含：
  - `entityId`（用户标识）
  - `peakReduction`（峰时可削减潜力，24 × 3 数组：[时段, 容量, 成本]）
  - `valleyShift`（谷时可转移潜力，24 × 3 数组）
  - `baselineCurve`（基准负荷曲线）
  - `constraints`（约束条件）

#### Scenario: 边界情况
- **WHEN** 算子遇到边界情况
- **THEN** 应正确处理：
  - 零潜力（无可调节负荷）→ 输出空潜力数组
  - 满负荷（无削减空间）→ `peakReduction` 全为 0
  - 负荷波动剧烈 → 取保守估计（下界）

#### Scenario: 性能要求
- **WHEN** 处理 1000 用户
- **THEN** 评估时间应 < 5 秒

### Requirement: 需求响应优化算子
`power.dr-optimize@1.0.0` 算子应求解削峰填谷优化问题。

#### Scenario: 优化目标
- **WHEN** 优化算子求解
- **THEN** 应最小化峰谷差：
  - 目标函数：min(max(load) - min(load))
  - 约束：各用户调节量 ≤ 潜力上限

#### Scenario: 满足激励预算约束
- **WHEN** 优化算子求解
- **THEN** 应：
  - 计算总激励成本 = Σ(调节量 × 单价)
  - 约束：总激励 ≤ `spec.incentiveBudget`

#### Scenario: 求解算法
- **WHEN** 优化算子求解
- **THEN** 应支持以下算法之一：
  - 混合整数规划（MILP，精确解）
  - 遗传算法（GA，启发式）
  - 粒子群优化（PSO，启发式）

#### Scenario: 输出优化方案
- **WHEN** 优化算子完成求解
- **THEN** 输出应包含：
  - `adjustmentPlan`（各时段调节目标，24 小时数组）
  - `incentiveAllocation`（各用户激励分配，按用户组聚合）
  - `peakValleyDiff`（优化后峰谷差，kW）
  - `totalIncentive`（总激励支出，元）
  - `participationRate`（参与率，%）

#### Scenario: 验证方案可行性
- **WHEN** 优化算子输出方案
- **THEN** 应验证：
  - 各用户调节量 ≤ 潜力上限
  - 总激励 ≤ 预算上限
  - 调节后负荷曲线平滑（无突变）

#### Scenario: 边界情况处理
- **WHEN** 优化算子遇到边界情况
- **THEN** 应正确处理：
  - 无可行解 → 抛出错误"无法满足约束条件"
  - 预算不足 → 放松参与用户数（部分用户参与）
  - 单用户主导 → 分散调节（避免单点依赖）

#### Scenario: 性能要求
- **WHEN** 处理 100 用户 × 24 时段
- **THEN** 优化时间应 < 1 分钟

### Requirement: 需求响应收集器
需求响应收集器应聚合优化方案并生成最终执行计划。

#### Scenario: 识别需求响应载荷
- **WHEN** 收集器接收投递载荷
- **THEN** 应按 `analysisType: "demand-response"` 识别需求响应结果

#### Scenario: 输出格式
- **WHEN** 收集器生成最终报告
- **THEN** 输出应包含：
  - `analysisType: "demand-response"`
  - `adjustmentPlan`（各时段调节目标）
  - `incentiveAllocation`（激励分配，用户 ID 脱敏）
  - `peakReduction`（削峰效果，kW 和 %）
  - `valleyFilling`（填谷效果，kW 和 %）
  - `totalIncentive`（总激励支出）
  - `nParticipants`（参与用户数）

### Requirement: 隐私保护
需求响应场景应满足隐私保护要求，不泄露个体用电行为。

#### Scenario: 潜力评估隐私保护
- **WHEN** 潜力评估算子输出
- **THEN** 应满足：
  - 不泄露个体用电曲线（只输出聚合潜力）
  - 可调节负荷潜力按用户组聚合（≥ 5 用户）

#### Scenario: 优化方案隐私保护
- **WHEN** 优化算子输出方案
- **THEN** 应：
  - 用户 ID 脱敏（使用哈希或序号）
  - 激励分配按聚合维度（不细化到个体）
  - 调节量模糊化（分段表示，如 0-10kW / 10-20kW）

#### Scenario: 差分隐私验证
- **WHEN** 输出需求响应结果
- **THEN** 应满足：
  - ε < 0.5（针对可调节负荷）
  - k ≥ 5（针对用户分组）
