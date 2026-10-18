# 电力算子包与场景设计

## 概述

**变更标识**：`power-operator-pack`  
**类型**：新增行业包（电力领域）  
**状态**：设计中  
**优先级**：P2  

本变更为 MedTrust 可信数据空间引入**电力行业算子包**（`@medtrust/domain-power`），提供电力负荷预测、需求响应、电网优化等场景的隐私计算能力，复用 MDOP 协议与基座能力。

## 动机

### 业务背景

电力行业存在大量多方协作的数据分析需求：

1. **负荷预测**：电网公司需要整合气象、工业、商业用电数据进行短期/中期负荷预测
2. **需求响应**：聚合多个用户的用电曲线，在保护隐私的前提下优化削峰填谷
3. **分布式能源接入**：光伏、风电等分布式电源的出力预测与协同调度
4. **电力市场结算**：多方参与的电力交易数据安全计算与结算
5. **窃电检测**：跨区域电力数据的异常检测，不暴露个体用电行为

### 技术挑战

- **时序数据特性**：电力数据以时间序列为主（采样频率：15 分钟～1 小时），需要专门的时序特征工程
- **实时性要求**：负荷预测、需求响应等场景需要准实时计算（< 5 分钟）
- **隐私保护**：用户用电数据属于敏感个人信息（GB/T 35273），需要隐私保护
- **多方协作**：涉及电网公司、售电公司、大工业用户、气象部门等多方数据融合

### 为什么选择 MDOP

- **复用医疗包架构**：电力包与医疗包结构相似（都是行业算子 + 沙箱 + 计划模板）
- **协议能力完备**：MDOP 协议 v0.3 已支持节点间安全聚合，可直接用于联邦学习场景
- **基座能力就绪**：数据源、降密、合并等基础算子已实现，电力包只需实现领域逻辑
- **验证路径清晰**：医疗包已走通端到端流程，电力包可快速复制

## 设计

### 1. 包结构

```
industries/power/
├── package.json              # @medtrust/domain-power
├── src/
│   ├── index.ts              # 导出 SPI 注册函数
│   ├── manifest.ts           # 算子清单（power 包声明的算子）
│   ├── seams.ts              # SPI 接缝（行业包与基座的契约）
│   ├── templates/            # 计划模板（S2）
│   │   ├── index.ts
│   │   ├── load-forecast.ts          # 负荷预测模板
│   │   ├── demand-response.ts        # 需求响应模板
│   │   └── theft-detection.ts        # 窃电检测模板
│   ├── sandboxes/            # 节点侧沙箱（S2）
│   │   ├── index.ts
│   │   ├── load-forecast-sandbox.ts  # 负荷预测沙箱
│   │   └── anomaly-sandbox.ts        # 异常检测沙箱
│   ├── collectors/           # 平台侧收集器（S2）
│   │   ├── index.ts
│   │   └── load-forecast-collector.ts
│   ├── connector-operators/  # 连接器侧算子接线（S2）
│   │   ├── index.ts
│   │   └── power-ops.ts
│   └── analysis/             # 分析算子（领域逻辑）
│       ├── time-series-features.ts   # 时序特征工程
│       ├── load-aggregation.ts       # 负荷聚合
│       └── anomaly-detection.ts      # 异常检测
└── README.md
```

### 2. 核心场景

#### 场景 1：多方负荷预测（Load Forecasting）

**参与方**：
- 电网公司：提供历史负荷数据
- 气象部门：提供天气预报数据
- 工业用户：提供生产计划数据

**计划模板**：`power.load-forecast`

**阶段链**：
```
各参与方：source.dataset → power.feature-extraction → declassify.small_cell
节点间：  各方 secure_aggregate（聚合特征）
平台：    power.load-forecast-merge（预测模型训练与推理）
```

**算子**：
- `power.feature-extraction@1.0.0`：时序特征工程（滑动窗口、周期性特征、趋势分解）
- `power.load-forecast-merge@1.0.0`：联邦负荷预测（LSTM/Transformer）

**输出**：
- 未来 24 小时逐小时负荷预测曲线
- 预测置信区间
- 特征重要性分析

#### 场景 2：需求响应优化（Demand Response）

**参与方**：
- 电网公司：提供电网负荷曲线与激励策略
- 售电公司：提供用户池信息
- 大工业用户：提供可调节负荷曲线

**计划模板**：`power.demand-response`

**阶段链**：
```
各用户：source.dataset → power.dr-potential → declassify.small_cell
平台：  power.dr-optimize（优化削峰填谷策略）
```

**算子**：
- `power.dr-potential@1.0.0`：可调节负荷潜力评估
- `power.dr-optimize@1.0.0`：需求响应优化（混合整数规划）

**输出**：
- 各时段调节目标（MW）
- 参与用户激励分配方案
- 削峰填谷效果评估

#### 场景 3：跨区域窃电检测（Theft Detection）

**参与方**：
- 多个供电局：提供各自辖区的用电数据

**计划模板**：`power.theft-detection`

**阶段链**：
```
各供电局：source.dataset → power.anomaly-detection → declassify.small_cell
平台：    power.theft-merge（跨区域异常模式聚合）
```

**算子**：
- `power.anomaly-detection@1.0.0`：基于孤立森林/AutoEncoder 的异常检测
- `power.theft-merge@1.0.0`：跨区域异常模式聚合与排序

**输出**：
- 疑似窃电用户列表（脱敏后的风险评分）
- 异常用电模式分类
- 区域窃电率估计

### 3. 数据模式

#### 电力时序数据标准格式

```typescript
interface PowerTimeSeriesRecord {
  // 时间戳（ISO 8601）
  timestamp: string;
  // 用户/站点标识（可脱敏）
  entityId: string;
  // 有功功率（kW）
  activePower?: number;
  // 无功功率（kVar）
  reactivePower?: number;
  // 电压（V）
  voltage?: number;
  // 电流（A）
  current?: number;
  // 扩展字段（天气、生产状态等）
  [key: string]: unknown;
}
```

#### 特征提取输出格式

```typescript
interface PowerFeatures {
  entityId: string;
  // 时间窗口
  windowStart: string;
  windowEnd: string;
  // 统计特征
  mean: number;
  std: number;
  max: number;
  min: number;
  // 周期性特征
  hourOfDay: number;
  dayOfWeek: number;
  isWeekend: boolean;
  // 趋势特征
  trend: number;
  seasonality: number;
  // 样本数（用于安全聚合加权）
  nSamples: number;
}
```

### 4. 算子清单

电力包声明的算子（注册到 MDOP 算子清单）：

| 算子 ID | 版本 | 类型 | 描述 |
|---------|------|------|------|
| `power.feature-extraction` | 1.0.0 | wasm | 时序特征工程 |
| `power.load-forecast-merge` | 1.0.0 | system | 负荷预测合并 |
| `power.dr-potential` | 1.0.0 | wasm | 需求响应潜力评估 |
| `power.dr-optimize` | 1.0.0 | system | 需求响应优化 |
| `power.anomaly-detection` | 1.0.0 | wasm | 异常检测 |
| `power.theft-merge` | 1.0.0 | system | 窃电检测合并 |

**算子能力边界**：
- **wasm 算子**：承载隐私计算逻辑，运行在零能力沙箱（不可访问网络/文件系统）
- **system 算子**：平台侧合并/优化，运行在可信执行环境（连接器或平台节点）

### 5. 计划模板示例

#### 负荷预测模板（`power.load-forecast`）

```typescript
export interface LoadForecastTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  participants: Array<{
    participantId: string;
    dataProductId: string;
    role: 'grid' | 'weather' | 'industrial';
  }>;
  spec: {
    forecastHorizon: number;  // 预测时长（小时）
    features: string[];       // 特征列表
    model: 'baseline';        // 已实现=季节朴素基线；lstm/transformer 未实现，提交即拒
  };
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export function buildLoadForecastPlan(
  input: LoadForecastTemplateInput,
  space: string,
): LogicalPlanDraft {
  // 实现类似 lora-fedavg 的阶段链构建
  // ...
}
```

### 6. 与医疗包的对照

| 维度 | 医疗包 | 电力包 |
|------|--------|--------|
| **数据类型** | 表格（病历、处方）| 时序（用电曲线、负荷数据）|
| **分析场景** | 队列分析、药品监测 | 负荷预测、需求响应 |
| **隐私要求** | GB/T 39725（医疗数据安全） | GB/T 35273（个人信息安全）|
| **实时性** | 准实时（分钟级） | 准实时（分钟级～秒级）|
| **计划模板数** | 14 个 | 3 个（初期）|
| **算子数** | 20+ 个 | 6 个（初期）|

## 实施路径

### 阶段 1：包骨架与基础设施（1 周）

- [ ] 创建 `industries/power/` 包结构
- [ ] 实现 SPI 注册函数（`registerPowerTemplates` / `registerPowerSandboxes`）
- [ ] 配置构建与测试环境
- [ ] 编写包级文档（README.md）

### 阶段 2：负荷预测场景（2 周）

- [ ] 实现 `power.feature-extraction` 算子（时序特征工程）
- [ ] 实现 `power.load-forecast-merge` 合并器
- [ ] 实现 `load-forecast` 计划模板
- [ ] 单元测试 + 端到端测试
- [ ] 编写场景文档

### 阶段 3：需求响应场景（2 周）

- [ ] 实现 `power.dr-potential` 算子
- [ ] 实现 `power.dr-optimize` 优化器
- [ ] 实现 `demand-response` 计划模板
- [ ] 单元测试 + 端到端测试

### 阶段 4：窃电检测场景（1 周）

- [ ] 实现 `power.anomaly-detection` 算子
- [ ] 实现 `power.theft-merge` 合并器
- [ ] 实现 `theft-detection` 计划模板
- [ ] 单元测试 + 端到端测试

### 阶段 5：集成与验证（1 周）

- [ ] 集成到 API 模块（注册电力模板与收集器）
- [ ] 集成到连接器模块（注册电力算子）
- [ ] 编写用户手册与 API 文档
- [ ] 性能测试与优化

## 依赖与前置条件

### 已就绪
- ✅ MDOP 协议 v0.3（节点间安全聚合）
- ✅ 医疗包架构（参考实现）
- ✅ 基座算子（source / declassify / merge）
- ✅ SPI 接口（模板 / 沙箱 / 收集器注册）

### 需要补充
- ⚠️ 时序数据源适配器（电力表计数据接入）
- ⚠️ 电力领域知识库（负荷曲线特征、窃电模式等）
- ⚠️ 实时计算能力（当前 MDOP 为批处理，需增强流式支持）

## 风险与缓解

### 风险 1：实时性要求
- **风险**：负荷预测、需求响应需要准实时计算（< 5 分钟），当前 MDOP 为批处理
- **缓解**：
  - 短期：批处理模式，预测窗口 15 分钟
  - 长期：引入流式计算支持（MDOP 协议 v0.4）

### 风险 2：时序数据存储
- **风险**：电力时序数据量大（每用户每天 96 条记录 × 特征维度）
- **缓解**：
  - 采用列存储（Parquet）压缩比 10:1
  - 数据分片：按时间窗口（月/周）+ 参与方分片
  - 增量计算：只传输新增数据

### 风险 3：领域知识门槛
- **风险**：电力负荷预测、需求响应优化需要电力工程领域知识
- **缓解**：
  - 与电力领域专家合作（华北电力大学、国网能源研究院）
  - 参考开源模型（LSTM-Load、DR-Optimization）
  - 提供默认参数与预训练模型

## 验收标准

### 功能完整性
- [ ] 三个场景（负荷预测、需求响应、窃电检测）端到端可运行
- [ ] 所有算子通过单元测试与集成测试
- [ ] 计划模板输入校验完备（拒绝非法输入）

### 性能指标
- [ ] 负荷预测：1000 用户 × 30 天数据，计算时间 < 5 分钟
- [ ] 需求响应：100 用户 × 24 小时数据，优化时间 < 1 分钟
- [ ] 窃电检测：10000 用户 × 90 天数据，检测时间 < 10 分钟

### 隐私保护
- [ ] 所有算子通过隐私审查（不泄露个体用电行为）
- [ ] 输出满足差分隐私要求（ε < 1.0）
- [ ] 支持 k-匿名（k ≥ 5）脱敏

### 文档完整性
- [ ] 包级 README（架构、快速开始、API 参考）
- [ ] 场景文档（业务背景、数据格式、输出解释）
- [ ] 算子文档（输入输出、参数说明、使用示例）

## 参考资料

### 标准规范
- GB/T 35273-2020：《信息安全技术 个人信息安全规范》
- GB/T 37930-2019：《信息安全技术 电力系统网络安全等级保护实施指南》
- IEC 61968-11：《Application integration at electric utilities - System interfaces for distribution management》

### 学术论文
- [1] Shi, H., et al. (2018). "Deep Learning for Household Load Forecasting—A Novel Pooling Deep RNN." *IEEE Transactions on Smart Grid*.
- [2] Chen, Y., et al. (2020). "Privacy-Preserving Demand Response via Federated Learning." *IEEE INFOCOM*.
- [3] Xiao, Z., et al. (2017). "Non-intrusive Load Monitoring and Disaggregation Based on Deep Learning." *Applied Energy*.

### 开源项目
- [Load Forecasting Toolkit](https://github.com/energy-forecasting/load-forecasting)
- [OpenDR: Open Demand Response](https://github.com/opendr/opendr)
- [PowerTAC: Power Trading Agent Competition](https://github.com/powertac/powertac-server)

---

**变更提议者**：Claude Opus 5  
**日期**：2026-10-15  
**审查者**：待分配  
