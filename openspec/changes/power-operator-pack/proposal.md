## Why

电力行业存在大量多方协作的隐私计算需求（负荷预测、需求响应、窃电检测），但缺乏复用 MDOP 基座能力的行业包。电力包复用医疗包架构，快速扩展可信数据空间到电力领域，验证基座的跨行业能力。

## What Changes

- 新增电力行业算子包 `@medtrust/domain-power`（包结构、SPI 注册、算子清单）
- 新增 3 个电力计划模板（负荷预测 / 需求响应 / 窃电检测）
- 新增 6 个电力算子（特征提取、负荷预测、需求响应、异常检测等）
- 新增电力沙箱与收集器（节点侧时序特征工程、平台侧聚合）
- 集成到 API 模块（注册电力模板）与连接器模块（注册电力算子）
- 新增电力时序数据标准格式（`PowerTimeSeriesRecord`）

## Capabilities

### New Capabilities
- `power-operator-pack`: 电力行业算子包的包结构、SPI 接口、注册机制
- `power-load-forecast`: 多方负荷预测场景（时序特征工程 + 联邦预测）
- `power-demand-response`: 需求响应优化场景（可调节负荷评估 + 削峰填谷优化）
- `power-theft-detection`: 跨区域窃电检测场景（异常检测 + 隐私保护聚合）
- `power-time-series-format`: 电力时序数据标准格式与特征提取规范

### Modified Capabilities
<!-- 无现有能力需要修改，电力包为新增行业包 -->

## Impact

**新增代码**：
- `industries/power/` 电力包目录（模板 / 沙箱 / 收集器 / 算子）
- `apps/api/src/power/` API 侧电力路由与集成
- `apps/connector/src/power/` 连接器侧电力算子接线

**集成点**：
- API 模块：注册电力模板到模板注册表（`registerPowerTemplates`）
- API 模块：注册电力收集器到收集器注册表（`registerPowerCollectors`）
- 连接器模块：注册电力算子到执行器（`PowerOperatorWiring`）
- 台账服务：新增电力通道映射（`power.*` → `orchestration.channels`）

**依赖**：
- MDOP 协议 v0.3（节点间安全聚合）✅ 已就绪
- 医疗包架构（参考实现）✅ 已就绪
- 时序数据源适配器（需补充）⚠️ 待实现

**不影响**：
- 现有医疗包功能（完全独立的行业包）
- MDOP 协议（复用现有能力，无协议变更）
- 基座算子（复用 source / declassify / merge）
