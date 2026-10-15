## ADDED Requirements

### Requirement: 电力时序数据标准格式
系统应定义电力时序数据的标准格式 `PowerTimeSeriesRecord`，确保跨场景一致性。

#### Scenario: 时间戳格式
- **WHEN** 数据包含时间戳字段
- **THEN** 应符合 ISO 8601 标准：
  - 格式：`YYYY-MM-DDTHH:mm:ss.sssZ`
  - 时区：UTC 或带时区偏移（如 `+08:00`）
  - 示例：`2026-10-15T08:30:00.000Z`

#### Scenario: 必填字段
- **WHEN** 数据记录被解析
- **THEN** 应包含以下必填字段：
  - `timestamp`（时间戳，字符串）
  - `entityId`（实体标识，字符串）

#### Scenario: 可选功率字段
- **WHEN** 数据记录包含功率字段
- **THEN** 应支持以下可选字段：
  - `activePower`（有功功率，数值，单位：kW）
  - `reactivePower`（无功功率，数值，单位：kVar）
  - `voltage`（电压，数值，单位：V）
  - `current`（电流，数值，单位：A）

#### Scenario: 扩展字段支持
- **WHEN** 数据记录包含扩展字段
- **THEN** 应：
  - 接受任意额外字段（不拒绝未知字段）
  - 扩展字段可用于特定场景（天气、生产状态等）
  - 类型：`[key: string]: unknown`

#### Scenario: 数值范围校验
- **WHEN** 数据记录包含数值字段
- **THEN** 应校验合理范围：
  - `activePower` ≥ 0（有功功率非负，除非明确标记为负功率窃电）
  - `reactivePower` 可正可负
  - `voltage` > 0（电压为正）
  - `current` ≥ 0（电流非负）

#### Scenario: 缺失值表示
- **WHEN** 数据字段缺失
- **THEN** 应：
  - 使用 `null` 或 `undefined` 表示缺失
  - 不使用魔法值（如 -999）

### Requirement: 电力特征格式
系统应定义特征提取输出的标准格式 `PowerFeatures`。

#### Scenario: 时间窗口字段
- **WHEN** 特征输出包含时间窗口
- **THEN** 应包含：
  - `windowStart`（窗口起始，ISO 8601）
  - `windowEnd`（窗口结束，ISO 8601）

#### Scenario: 实体标识字段
- **WHEN** 特征输出包含实体标识
- **THEN** 应：
  - `entityId`（与输入数据的 `entityId` 一致）

#### Scenario: 统计特征字段
- **WHEN** 特征输出包含统计特征
- **THEN** 应包含：
  - `mean`（均值，数值）
  - `std`（标准差，数值）
  - `max`（最大值，数值）
  - `min`（最小值，数值）

#### Scenario: 周期性特征字段
- **WHEN** 特征输出包含周期性特征
- **THEN** 应包含：
  - `hourOfDay`（小时，0-23）
  - `dayOfWeek`（星期，0-6，0 = 周日）
  - `isWeekend`（是否周末，布尔值）

#### Scenario: 趋势特征字段
- **WHEN** 特征输出包含趋势特征
- **THEN** 应包含：
  - `trend`（趋势分量，数值）
  - `seasonality`（季节性分量，数值）

#### Scenario: 样本数字段
- **WHEN** 特征输出包含样本数
- **THEN** 应：
  - `nSamples`（样本数，正整数）
  - 用于加权聚合

### Requirement: 数据采样频率
系统应支持常见的电力数据采样频率。

#### Scenario: 支持的采样频率
- **WHEN** 数据源指定采样频率
- **THEN** 应支持以下频率：
  - 15 分钟（标准电表采样）
  - 1 小时（负荷预测常用）
  - 5 分钟（高频采集）
  - 1 天（日负荷曲线）

#### Scenario: 采样频率验证
- **WHEN** 算子接收时序数据
- **THEN** 应：
  - 检测数据的实际采样频率
  - 验证是否与预期频率一致
  - 如果不一致，抛出警告或错误

#### Scenario: 重采样支持
- **WHEN** 数据采样频率不匹配
- **THEN** 应支持：
  - 上采样（插值）
  - 下采样（聚合）
  - 默认方法：线性插值（上采样）/ 均值聚合（下采样）

### Requirement: 数据质量检查
系统应对输入数据进行质量检查。

#### Scenario: 时间戳单调性检查
- **WHEN** 算子接收时序数据
- **THEN** 应验证：
  - 时间戳严格单调递增
  - 如果不满足，抛出错误"时间戳非单调"

#### Scenario: 缺失值检查
- **WHEN** 算子接收时序数据
- **THEN** 应：
  - 统计缺失值比例
  - 如果缺失值 > 30%，抛出警告
  - 如果缺失值 > 80%，抛出错误"数据质量不足"

#### Scenario: 异常值检查
- **WHEN** 算子接收时序数据
- **THEN** 应检测异常值：
  - 超出合理范围（如功率 > 10 倍均值）
  - 使用 IQR 方法或 Z-score 方法
  - 标记但不删除异常值（供用户决策）

#### Scenario: 重复记录检查
- **WHEN** 算子接收时序数据
- **THEN** 应：
  - 检测相同时间戳的重复记录
  - 去重策略：保留最后一条（最新数据）

### Requirement: 数据转换工具
系统应提供数据格式转换工具。

#### Scenario: CSV 转标准格式
- **WHEN** 用户上传 CSV 格式数据
- **THEN** 系统应提供转换函数：
  - 输入：CSV 文件路径 + 列映射配置
  - 输出：`PowerTimeSeriesRecord[]`

#### Scenario: JSON 转标准格式
- **WHEN** 用户提供 JSON 格式数据
- **THEN** 系统应验证：
  - JSON 结构符合 `PowerTimeSeriesRecord` 类型
  - 自动类型转换（字符串 → 数值）

#### Scenario: Parquet 转标准格式
- **WHEN** 用户上传 Parquet 格式数据
- **THEN** 系统应提供转换函数：
  - 使用 Apache Arrow 读取 Parquet
  - 输出：`PowerTimeSeriesRecord[]`

### Requirement: TypeScript 类型定义
系统应导出完整的 TypeScript 类型定义。

#### Scenario: PowerTimeSeriesRecord 类型
- **WHEN** 外部模块引用电力包
- **THEN** 应导出以下类型：
```typescript
interface PowerTimeSeriesRecord {
  timestamp: string;
  entityId: string;
  activePower?: number;
  reactivePower?: number;
  voltage?: number;
  current?: number;
  [key: string]: unknown;
}
```

#### Scenario: PowerFeatures 类型
- **WHEN** 外部模块引用电力包
- **THEN** 应导出以下类型：
```typescript
interface PowerFeatures {
  entityId: string;
  windowStart: string;
  windowEnd: string;
  mean: number;
  std: number;
  max: number;
  min: number;
  hourOfDay: number;
  dayOfWeek: number;
  isWeekend: boolean;
  trend: number;
  seasonality: number;
  nSamples: number;
}
```

#### Scenario: 类型守卫函数
- **WHEN** 需要运行时类型检查
- **THEN** 应提供类型守卫函数：
  - `isPowerTimeSeriesRecord(data: unknown): data is PowerTimeSeriesRecord`
  - `isPowerFeatures(data: unknown): data is PowerFeatures`

### Requirement: 向后兼容性
数据格式应支持向后兼容，新版本可处理旧版本数据。

#### Scenario: 新增可选字段
- **WHEN** 新版本添加可选字段
- **THEN** 应：
  - 旧数据缺失新字段时，使用默认值
  - 不强制要求旧数据提供新字段

#### Scenario: 字段重命名
- **WHEN** 需要重命名字段
- **THEN** 应：
  - 同时支持旧字段名和新字段名（过渡期）
  - 在文档中标记旧字段为 `@deprecated`
  - 过渡期后（至少 2 个版本）才移除旧字段

#### Scenario: 类型变更
- **WHEN** 需要变更字段类型
- **THEN** 应：
  - 提供自动转换函数
  - 在转换失败时给出明确错误提示
  - 不静默截断或丢失数据

### Requirement: 文档与示例
系统应提供完整的数据格式文档与示例。

#### Scenario: 数据格式文档
- **WHEN** 开发者查阅文档
- **THEN** 应包含：
  - 字段说明（名称、类型、单位、必填/可选）
  - 取值范围（合理值、边界情况）
  - 使用示例（最简示例、完整示例）

#### Scenario: 示例数据集
- **WHEN** 开发者需要测试数据
- **THEN** 应提供：
  - 最小示例数据（10 条记录）
  - 完整示例数据（1000 条记录，覆盖各种场景）
  - 异常数据示例（缺失值、异常值、边界情况）

#### Scenario: 转换示例
- **WHEN** 开发者需要转换数据
- **THEN** 应提供：
  - CSV → 标准格式（代码示例）
  - JSON → 标准格式（代码示例）
  - Parquet → 标准格式（代码示例）
