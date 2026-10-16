<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 窃电检测场景（power.theft-detection）

## 业务背景

多供电局本地异常检测后，平台跨区合并 Top-K 疑似用户与模糊化区域窃电率。

## 阶段链

各方：`source.dataset` → `power.anomaly-detection` → `declassify.small_cell`  
平台：`power.theft-merge`

## 输出解释

收集器 `theft-detection`：`suspiciousUsers`（哈希 entityId）、`anomalyPatterns`、`theftRate`（整数百分点）、`nRegions`、`totalUsers`。

## 使用示例

```ts
import { buildTheftDetectionPlan, detectAnomaly, collectTheftDetection } from "@medtrust/domain-power";

const plan = buildTheftDetectionPlan({
  purpose: "跨区联查",
  applicant: { org: "grid", project: "theft" },
  contracts: ["c1"],
  participants: [
    { participantId: "bureau-a", dataProductId: "dp-a" },
    { participantId: "bureau-b", dataProductId: "dp-b" },
  ],
  spec: { detectionPeriod: 90, anomalyThreshold: 0.6, topK: 20 },
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
});
```

## 隐私

只输出超阈值用户；评分分段；entityId 单向哈希；窃电率 ≥1% 粒度；可选 DP（ε < 2.0）。
