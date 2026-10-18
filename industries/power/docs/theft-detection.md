<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 窃电检测场景（power.theft-detection）

## 业务背景

多供电局本地异常检测后，平台跨区合并 Top-K 疑似用户与模糊化区域窃电率。

## 阶段链

各方：`source.dataset` → `power.anomaly-detection` → `declassify.small_cell`  
平台：`power.theft-merge`

## 输出解释

收集器 `theft-detection`：`suspiciousUsers`（**键控假名** entityId，同合约 scope 内跨区域可关联、平台无从反查）、
`anomalyPatterns`、`theftRate`（整数百分点）、`nRegions`、`totalUsers`。

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

- **小单元闸卡在放行的对象上**：不只卡输入表计数，还卡**放行的个体记录条数**。
  命中不足合约 `minCell`（默认 5）时**整表抑制**——平台看到的载荷与"零命中"逐字节相同，
  连条数都推不出来；真实命中数只留在节点本地日志。
- 评分分段（不输出精确小数）；entityId 换成**键控假名**（HMAC-SM3，密钥只在联盟节点）；
  证据区间泛化到日级；窃电率 ≥1% 粒度。
- 本场景**不叠加 DP**：个体列表在 minCell 闸与假名化之后，放行条数已由闸门决定，
  再加 Laplace 只会破坏可用性而不增加实质保护。DP 覆盖的是负荷预测 / 需求响应的**数值聚合量**。
