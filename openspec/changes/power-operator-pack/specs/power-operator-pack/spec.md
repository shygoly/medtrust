## ADDED Requirements

### Requirement: 电力算子包结构
电力算子包 `@medtrust/domain-power` 应遵循行业包标准结构，包含模板、沙箱、收集器、算子四个主要模块。

#### Scenario: 包目录结构完整
- **WHEN** 开发者检查 `industries/power/` 目录
- **THEN** 目录应包含以下子目录：
  - `src/templates/` - 计划模板（S2）
  - `src/sandboxes/` - 节点侧沙箱（S2）
  - `src/collectors/` - 平台侧收集器（S2）
  - `src/connector-operators/` - 连接器侧算子接线（S2）
  - `src/analysis/` - 分析算子（领域逻辑）
  - `src/manifest.ts` - 算子清单
  - `src/seams.ts` - SPI 接缝定义

#### Scenario: package.json 配置正确
- **WHEN** 开发者读取 `industries/power/package.json`
- **THEN** 配置应包含：
  - 包名：`@medtrust/domain-power`
  - 版本：`0.1.0`（初始版本）
  - 依赖：`@medtrust/mdop`、`@nestjs/common`
  - 构建脚本：`tsc`
  - 主入口：`dist/index.js`

### Requirement: SPI 注册函数
电力包应导出标准 SPI 注册函数，供 API 模块和连接器模块调用。

#### Scenario: 注册计划模板
- **WHEN** API 模块调用 `registerPowerTemplates()`
- **THEN** 应返回包含 3 个模板的数组：
  - `power.load-forecast`（负荷预测）
  - `power.demand-response`（需求响应）
  - `power.theft-detection`（窃电检测）

#### Scenario: 注册节点侧沙箱
- **WHEN** 连接器模块调用 `registerPowerSandboxes(registry)`
- **THEN** 应向注册表注册以下沙箱：
  - `power.feature-extraction`（时序特征工程沙箱）
  - `power.anomaly-detection`（异常检测沙箱）

#### Scenario: 注册平台侧收集器
- **WHEN** API 模块调用 `registerPowerCollectors(registry)`
- **THEN** 应向注册表注册以下收集器：
  - `power-load-forecast`（负荷预测收集器）
  - `power-theft-detection`（窃电检测收集器）

### Requirement: 算子清单声明
电力包应声明所有算子的清单，包含算子 ID、版本、类型、描述。

#### Scenario: 算子清单完整
- **WHEN** 开发者读取 `src/manifest.ts` 中的 `POWER_OPERATORS`
- **THEN** 应包含 6 个算子：
  - `power.feature-extraction@1.0.0` (wasm)
  - `power.load-forecast-merge@1.0.0` (system)
  - `power.dr-potential@1.0.0` (wasm)
  - `power.dr-optimize@1.0.0` (system)
  - `power.anomaly-detection@1.0.0` (wasm)
  - `power.theft-merge@1.0.0` (system)

#### Scenario: 算子类型正确
- **WHEN** 算子清单声明算子类型
- **THEN** 应满足以下规则：
  - 承载隐私计算逻辑的算子为 `wasm`（特征提取、异常检测）
  - 平台侧合并/优化算子为 `system`（预测合并、优化求解）

### Requirement: 与医疗包架构一致
电力包应复用医疗包的架构模式，确保一致性和可维护性。

#### Scenario: 目录结构与医疗包对齐
- **WHEN** 对比 `industries/power/` 与 `industries/med/` 的目录结构
- **THEN** 应保持相同的目录层级和命名规范

#### Scenario: SPI 接口与医疗包一致
- **WHEN** 对比电力包与医疗包的 SPI 函数签名
- **THEN** 注册函数应遵循相同的接口约定（参数类型、返回类型）

### Requirement: TypeScript 类型安全
电力包应提供完整的 TypeScript 类型定义，确保类型安全。

#### Scenario: 导出类型定义
- **WHEN** 外部模块引用电力包
- **THEN** 应导出以下核心类型：
  - `PowerTimeSeriesRecord`（时序数据记录）
  - `PowerFeatures`（特征提取输出）
  - `LoadForecastTemplateInput`（负荷预测模板输入）
  - `DemandResponseTemplateInput`（需求响应模板输入）
  - `TheftDetectionTemplateInput`（窃电检测模板输入）

#### Scenario: 类型检查通过
- **WHEN** 运行 `tsc --noEmit` 编译检查
- **THEN** 不应有类型错误（strict mode）

### Requirement: 构建与测试
电力包应支持独立构建和测试，不影响其他包。

#### Scenario: 独立构建成功
- **WHEN** 运行 `pnpm --filter @medtrust/domain-power build`
- **THEN** 应在 `dist/` 目录生成编译产物，无错误

#### Scenario: 单元测试覆盖
- **WHEN** 运行 `pnpm --filter @medtrust/domain-power test`
- **THEN** 测试覆盖率应 ≥ 80%（行覆盖率）

#### Scenario: 不影响其他包构建
- **WHEN** 电力包构建失败
- **THEN** 不应阻塞医疗包或基座的构建（monorepo 隔离）
