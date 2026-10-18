<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 负荷预测场景（power.load-forecast）

## 业务背景

多方（电网 / 气象 / 工业）在数据不出域前提下，提取时序特征并联邦聚合，产出短期负荷预测曲线。

## 数据格式

输入为 `PowerTimeSeriesRecord`（见 [time-series-format.md](./time-series-format.md)）。模板入参见 `buildLoadForecastPlan`：

- `spec.forecastHorizon`：1–168 小时
- `spec.features`：非空特征名列表
- `spec.model`：当前**只有 `baseline`**（季节朴素基线，输出 `model: "baseline"`）；
  `lstm` / `transformer` 的训练后端未接入，提交即拒（不用基线冒充 LSTM）

## 阶段链

各方：`source.dataset` → `power.feature-extraction` → `declassify.small_cell`  
平台：`power.load-forecast-merge`

**不经 `secure_aggregate`**：降密环已在节点内把逐表计特征聚合到节点级（C3 不含表计标识），
再让每个节点上传同一份结果做安全聚合会被合并器重复计数。

## 输出解释

收集器 `power.load-forecast` 产出：加权合并特征、均值置信区间、特征重要性排序。预测曲线来自 `baselineForecast`（确定性基线）。

## 使用示例

```ts
import { buildLoadForecastPlan, collectLoadForecast, extractPowerFeatures } from "@medtrust/domain-power";

const plan = buildLoadForecastPlan({
  purpose: "区域负荷预测",
  applicant: { org: "grid-co", project: "lf-2026" },
  contracts: ["c1"],
  participants: [
    { participantId: "grid", dataProductId: "dp-grid", role: "grid" },
    { participantId: "weather", dataProductId: "dp-weather", role: "weather" },
  ],
  spec: { forecastHorizon: 24, features: ["mean", "std"], model: "baseline" },
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
});
```

## 隐私

特征只输出聚合统计（逐表计明细留在节点）；出域要求 `nSamples ≥ minCell`（默认 5）与 k ≥ 5。
可选 Laplace DP 作用在**节点级负荷剖面**上（敏感度 = 单块表的最大贡献），需计划显式给
`release.dpEpsilon`（≤ 1.0），种子由节点密钥派生——不给 ε 就不加噪，不给种子即 fail-closed。
