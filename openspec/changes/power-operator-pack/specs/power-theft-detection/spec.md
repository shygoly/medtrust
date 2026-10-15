## ADDED Requirements

### Requirement: 窃电检测计划模板
系统应提供 `power.theft-detection` 计划模板，支持跨区域窃电检测场景。

#### Scenario: 模板输入校验
- **WHEN** 用户提交窃电检测计划
- **THEN** 系统应校验以下必填字段：
  - `purpose`（计划目的）
  - `applicant`（申请方，包含 org 和 project）
  - `contracts`（合约列表，至少 1 份）
  - `participants`（参与方列表，至少 2 个供电局）
  - `spec.detectionPeriod`（检测周期，单位：天）
  - `spec.anomalyThreshold`（异常阈值，0-1）
  - `spec.topK`（输出疑似用户数）
  - `notBefore` 和 `notAfter`（计划有效期）

#### Scenario: 拒绝非法输入
- **WHEN** 用户提交的输入不满足约束
- **THEN** 系统应拒绝并返回明确错误：
  - 参与方少于 2 方 → "窃电检测至少需要 2 个供电局参与"
  - 检测周期 < 30 天 → "检测周期至少需要 30 天"
  - 异常阈值 ∉ [0, 1] → "异常阈值应在 0-1 之间"
  - `topK` ≤ 0 → "topK 必须为正整数"

### Requirement: 窃电检测阶段链
窃电检测计划应生成包含异常检测、脱密、跨区域聚合的完整阶段链。

#### Scenario: 各供电局阶段链
- **WHEN** 构建窃电检测计划
- **THEN** 每个供电局应有 3 个阶段：
  - `source.dataset@1.0.0`（数据源）
  - `power.anomaly-detection@1.0.0`（异常检测）
  - `declassify.small_cell@1.0.0`（小单元脱密）

#### Scenario: 平台聚合阶段
- **WHEN** 构建窃电检测计划
- **THEN** 应生成一个 `power.theft-merge@1.0.0` 阶段：
  - 输入：所有供电局的脱密检测结果
  - 参数：`spec`（透传用户输入的 spec）
  - 节点：`platform`

### Requirement: 异常检测算子
`power.anomaly-detection@1.0.0` 算子应检测典型窃电模式。

#### Scenario: 输入数据格式
- **WHEN** 算子接收输入数据
- **THEN** 数据应包含：
  - 用户用电时序数据（至少 30 天）
  - 用户类型（工业 / 商业 / 居民）
  - 历史异常记录（可选）

#### Scenario: 检测典型窃电模式
- **WHEN** 算子执行异常检测
- **THEN** 应识别以下模式：
  - 零功率（长期读数为 0）
  - 负功率（功率倒流）
  - 功率突变（短时间内剧烈变化）
  - 异常低功率（显著低于同类用户）
  - 周期性异常（特定时段出现异常）

#### Scenario: 支持多种检测算法
- **WHEN** 算子执行检测
- **THEN** 应支持以下算法之一（可配置）：
  - 孤立森林（Isolation Forest）
  - 自编码器（AutoEncoder）
  - 统计检验（Z-score / IQR）
  - 集成方法（投票）

#### Scenario: 输出异常评分
- **WHEN** 算子完成检测
- **THEN** 输出应包含：
  - `entityId`（用户标识）
  - `anomalyScore`（异常评分，0-1）
  - `anomalyType`（异常类型，枚举）
  - `detectionMethod`（检测算法）
  - `confidence`（置信度，0-1）
  - `evidencePeriod`（异常时段，[start, end]）

#### Scenario: 异常评分合理性
- **WHEN** 算子输出异常评分
- **THEN** 应满足：
  - 正常用户评分 < 0.3
  - 疑似异常用户评分 0.3 - 0.7
  - 高度异常用户评分 > 0.7

#### Scenario: 边界情况处理
- **WHEN** 算子遇到边界情况
- **THEN** 应正确处理：
  - 全正常 → 所有评分 < 0.3
  - 全异常 → 所有评分 > 0.7（不太可能，需人工复核）
  - 新用户冷启动 → 使用同类用户基准（如有）或标记"数据不足"

#### Scenario: 性能要求
- **WHEN** 处理 10000 用户 × 90 天数据
- **THEN** 检测时间应 < 10 分钟

### Requirement: 窃电检测合并算子
`power.theft-merge@1.0.0` 算子应聚合跨区域异常评分并生成疑似窃电用户列表。

#### Scenario: 聚合异常评分
- **WHEN** 合并算子接收多个供电局的检测结果
- **THEN** 应支持以下聚合策略之一：
  - 加权平均（按用户数加权）
  - 最大值（取最高异常评分）
  - 投票（多数供电局认为异常）

#### Scenario: 输出疑似窃电用户列表
- **WHEN** 合并算子生成输出
- **THEN** 应包含：
  - `suspiciousUsers`（Top-K 疑似窃电用户，数组）
  - 每个用户包含：
    - `entityId`（脱敏后的用户标识）
    - `aggregatedScore`（聚合异常评分）
    - `detectedBy`（检测到该用户的供电局数量）
    - `anomalyType`（主要异常类型）

#### Scenario: 估计区域窃电率
- **WHEN** 合并算子聚合结果
- **THEN** 应计算：
  - `theftRate`（窃电率，异常用户比例，%）
  - `granularity`（粒度，≥ 1% 模糊化）

#### Scenario: 边界情况处理
- **WHEN** 合并算子遇到边界情况
- **THEN** 应正确处理：
  - 无异常 → 返回空列表
  - 单区域主导 → 不应完全依赖单一供电局
  - 评分冲突 → 按配置的聚合策略处理

#### Scenario: 性能要求
- **WHEN** 处理 10 区域 × 1000 用户
- **THEN** 合并时间应 < 5 秒

### Requirement: 窃电检测收集器
窃电检测收集器应聚合检测结果并生成最终报告。

#### Scenario: 识别窃电检测载荷
- **WHEN** 收集器接收投递载荷
- **THEN** 应按 `analysisType: "theft-detection"` 识别窃电检测结果

#### Scenario: 输出格式
- **WHEN** 收集器生成最终报告
- **THEN** 输出应包含：
  - `analysisType: "theft-detection"`
  - `suspiciousUsers`（疑似窃电用户列表，Top-K）
  - `anomalyPatterns`（异常模式分类统计）
  - `theftRate`（区域窃电率估计）
  - `detectionPeriod`（检测周期）
  - `nRegions`（参与供电局数量）
  - `totalUsers`（总用户数）

### Requirement: 隐私保护
窃电检测场景应满足隐私保护要求，不泄露正常用户用电行为。

#### Scenario: 异常检测隐私保护
- **WHEN** 异常检测算子输出
- **THEN** 应满足：
  - 只输出异常用户（评分 > 阈值）
  - 不输出正常用户的用电模式
  - 异常时段泛化（不精确到时刻）

#### Scenario: 用户标识脱敏
- **WHEN** 输出疑似窃电用户列表
- **THEN** 应：
  - 用户 ID 哈希化（单向不可逆）
  - 只输出 Top-K（不完整列表）
  - 风险评分分段（如 0.7-0.8 / 0.8-0.9 / 0.9-1.0）

#### Scenario: 窃电模式描述泛化
- **WHEN** 输出异常模式
- **THEN** 应：
  - 模式描述泛化（不精确到个体）
  - 统计口径聚合（按类型统计，不枚举）

#### Scenario: 区域窃电率模糊化
- **WHEN** 输出区域窃电率
- **THEN** 应：
  - 粒度 ≥ 1%（如 2-3% / 3-4%）
  - 不精确到小数点后多位

#### Scenario: 差分隐私验证
- **WHEN** 输出窃电检测结果
- **THEN** 应满足：
  - ε < 2.0（针对异常评分）
  - k ≥ 5（针对用户分组）

#### Scenario: 小单元检查
- **WHEN** `declassify.small_cell` 检查检测结果
- **THEN** 应：
  - 验证输出用户数 ≥ minCell（默认 5）
  - 如果不满足，拒绝出域（fail-closed）
