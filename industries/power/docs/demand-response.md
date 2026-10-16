<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 需求响应场景（power.demand-response）

## 业务背景

多用户评估可调节负荷潜力后，在平台侧按激励预算求解削峰填谷方案。

## 阶段链

各方：`source.dataset` → `power.dr-potential` → `declassify.small_cell`  
平台：`power.dr-optimize`

## 输出解释

- `adjustmentPlan`：24 小时调节目标（负=削减，正=填谷）
- `incentiveAllocation`：脱敏用户组激励
- `peakValleyDiff` / `totalIncentive` / `participationRate`

## 使用示例

```ts
import { buildDemandResponsePlan, assessDrPotential, optimizeDemandResponse } from "@medtrust/domain-power";

const plan = buildDemandResponsePlan({
  purpose: "园区削峰填谷",
  applicant: { org: "grid", project: "dr" },
  contracts: ["c1"],
  participants: [
    { participantId: "a", dataProductId: "dp-a" },
    { participantId: "b", dataProductId: "dp-b" },
  ],
  spec: {
    targetLoad: Array.from({ length: 24 }, () => 200),
    incentiveBudget: 10000,
    timeWindow: [8, 22],
  },
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
});
```

## 隐私

潜力按用户评估后脱敏聚合；优化输出使用 `user-group-N`；可选 DP（ε < 0.5）。
