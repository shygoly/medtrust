## ADDED Requirements

### Requirement: 负荷预测计划模板
系统应提供 `power.load-forecast` 计划模板，支持多方负荷预测场景。

#### Scenario: 模板输入校验
- **WHEN** 用户提交负荷预测计划
- **THEN** 系统应校验以下必填字段：
  - `purpose`（计划目的）
  - `applicant`（申请方，包含 org 和 project）
  - `contracts`（合约列表，至少 1 份）
  - `participants`（参与方列表，至少 2 方）
  - `spec.forecastHorizon`（预测时长，单位：小时）
  - `spec.features`（特征列表，非空）
  - `spec.model`（预测模型，枚举：lstm / transformer）
  - `notBefore` 和 `notAfter`（计划有效期）

#### Scenario: 参与方角色定义
- **WHEN** 用户指定参与方
- **THEN** 每个参与方应包含：
  - `participantId`（参与方 ID）
  - `dataProductId`（数据产品 ID）
  - `role`（角色，枚举：grid / weather / industrial）

#### Scenario: 拒绝非法输入
- **WHEN** 用户提交的输入不满足约束
- **THEN** 系统应拒绝并返回明确错误：
  - 参与方少于 2 方 → "负荷预测至少需要 2 方参与"
  - 合约列表为空 → "至少需要一份合约"
  - 预测时长 ≤ 0 或 > 168 小时 → "预测时长应在 1-168 小时之间"
  - 特征列表为空 → "至少需要一个特征"
  - 模型类型无效 → "只支持 lstm 或 transformer 模型"

### Requirement: 负荷预测阶段链
负荷预测计划应生成包含特征提取、脱密、聚合、预测合并的完整阶段链。

#### Scenario: 各参与方阶段链
- **WHEN** 构建负荷预测计划
- **THEN** 每个参与方应有 3 个阶段：
  - `source.dataset@1.0.0`（数据源）
  - `power.feature-extraction@1.0.0`（特征提取）
  - `declassify.small_cell@1.0.0`（小单元脱密）

#### Scenario: 节点间安全聚合
- **WHEN** 构建负荷预测计划
- **THEN** 应为每个参与方生成一个 `secure_aggregate@1.0.0` 阶段：
  - 输入：所有方的脱密输出
  - 参数：`aggregation: "fedavg"`
  - 节点：本参与方的节点 URN

#### Scenario: 平台合并阶段
- **WHEN** 构建负荷预测计划
- **THEN** 应生成一个 `power.load-forecast-merge@1.0.0` 阶段：
  - 输入：所有方的聚合结果
  - 参数：`spec`（透传用户输入的 spec）
  - 节点：`platform`

### Requirement: 时序特征工程算子
`power.feature-extraction@1.0.0` 算子应从电力时序数据中提取统计、周期性、趋势特征。

#### Scenario: 输入数据格式
- **WHEN** 算子接收输入数据
- **THEN** 数据应符合 `PowerTimeSeriesRecord` 格式：
  - `timestamp`（ISO 8601 时间戳）
  - `entityId`（用户/站点标识）
  - `activePower`（有功功率，kW，可选）
  - `reactivePower`（无功功率，kVar，可选）
  - `voltage`（电压，V，可选）
  - `current`（电流，A，可选）
  - 扩展字段（天气、生产状态等）

#### Scenario: 提取统计特征
- **WHEN** 算子处理时序数据
- **THEN** 应计算以下统计特征：
  - `mean`（均值）
  - `std`（标准差）
  - `max`（最大值）
  - `min`（最小值）
  - `nSamples`（样本数，用于加权聚合）

#### Scenario: 提取周期性特征
- **WHEN** 算子处理时序数据
- **THEN** 应计算以下周期性特征：
  - `hourOfDay`（小时，0-23）
  - `dayOfWeek`（星期，0-6）
  - `isWeekend`（是否周末，布尔值）

#### Scenario: 提取趋势特征
- **WHEN** 算子处理时序数据
- **THEN** 应使用 STL 分解计算趋势特征：
  - `trend`（趋势分量）
  - `seasonality`（季节性分量）

#### Scenario: 输出格式正确
- **WHEN** 算子完成特征提取
- **THEN** 输出应符合 `PowerFeatures` 格式：
  - 包含所有统计、周期性、趋势特征
  - 包含时间窗口（`windowStart` / `windowEnd`）
  - 包含实体 ID（`entityId`）

#### Scenario: 处理缺失值
- **WHEN** 输入数据包含缺失值
- **THEN** 算子应：
  - 跳过 `null` / `undefined` 值
  - 如果有效值 < 3 个，抛出错误"有效样本不足"

#### Scenario: 性能要求
- **WHEN** 处理 1000 用户 × 30 天数据
- **THEN** 提取时间应 < 30 秒

### Requirement: 负荷预测合并算子
`power.load-forecast-merge@1.0.0` 算子应聚合多方特征并生成负荷预测结果。

#### Scenario: 聚合多方特征
- **WHEN** 合并算子接收多方聚合结果
- **THEN** 应按样本量加权平均各方特征：
  - 权重 = 各方 `nSamples` / 总 `nSamples`
  - 加权特征 = Σ(特征 × 权重)

#### Scenario: 预测模型训练
- **WHEN** 合并算子训练预测模型
- **THEN** 应根据 `spec.model` 选择模型：
  - `lstm`：LSTM 时序预测模型
  - `transformer`：Transformer 时序预测模型

#### Scenario: 预测输出格式
- **WHEN** 合并算子生成预测结果
- **THEN** 输出应包含：
  - `forecastCurve`（预测曲线，数组，长度 = `forecastHorizon`）
  - `confidenceInterval`（置信区间，[下界, 上界]）
  - `featureImportance`（特征重要性，按贡献度排序）
  - `model`（使用的模型类型）
  - `nSamples`（总样本数）

#### Scenario: 预测精度验证
- **WHEN** 合并算子完成预测
- **THEN** 应计算预测精度指标：
  - MAPE（平均绝对百分比误差）
  - RMSE（均方根误差）
  - 目标：MAPE < 5%（参考行业基准）

#### Scenario: 边界情况处理
- **WHEN** 合并算子遇到边界情况
- **THEN** 应正确处理：
  - 单方数据 → 直接使用该方特征（权重 = 1）
  - 特征缺失 → 使用默认值或跳过该特征
  - 样本量不平衡 → 按权重聚合（不拒绝）

#### Scenario: 性能要求
- **WHEN** 处理 100 方 × 1000 特征
- **THEN** 合并时间应 < 10 秒

### Requirement: 负荷预测收集器
负荷预测收集器应聚合各方的预测结果并生成最终报告。

#### Scenario: 识别负荷预测载荷
- **WHEN** 收集器接收投递载荷
- **THEN** 应按 `analysisType: "load-forecast"` 识别负荷预测结果

#### Scenario: 聚合预测结果
- **WHEN** 收集器聚合多方预测结果
- **THEN** 应：
  - 验证各方 `forecastHorizon` 一致
  - 取所有方的 `forecastCurve` 的平均值作为最终预测
  - 合并 `featureImportance`（按贡献度重新排序）

#### Scenario: 输出格式
- **WHEN** 收集器生成最终报告
- **THEN** 输出应包含：
  - `analysisType: "load-forecast"`
  - `forecastCurve`（最终预测曲线）
  - `confidenceInterval`（聚合置信区间）
  - `featureImportance`（全局特征重要性）
  - `totalSamples`（所有方样本数之和）
  - `nParties`（参与方数量）

### Requirement: 隐私保护
负荷预测场景应满足隐私保护要求，不泄露个体用电行为。

#### Scenario: 特征提取隐私保护
- **WHEN** 特征提取算子输出特征
- **THEN** 应满足：
  - 不输出个体用电曲线（只输出聚合统计特征）
  - 支持 k-匿名脱敏（k ≥ 5，配置项）
  - 支持差分隐私噪声注入（ε < 1.0，可选）

#### Scenario: 小单元检查
- **WHEN** `declassify.small_cell` 检查特征输出
- **THEN** 应：
  - 验证 `nSamples ≥ minCell`（默认 5）
  - 如果不满足，拒绝出域（fail-closed）

#### Scenario: 预测输出隐私保护
- **WHEN** 合并算子输出预测结果
- **THEN** 应：
  - 不存储个体特征（只保留聚合权重）
  - 预测曲线不可逆推个体数据
  - 模型参数不泄露训练数据分布
