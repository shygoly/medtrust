// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import type { AnomalyDetectionResult } from "../analysis/anomaly-detection";
import {
  THEFT_DETECTION_ANALYSIS_TYPE,
  mergeTheftDetectionDeliveries,
  theftDetectionAggregationCollector,
} from "./theft-detection-collector";

function anomaly(
  entityId: string,
  score: number,
  overrides: Partial<AnomalyDetectionResult> = {},
): AnomalyDetectionResult {
  return {
    entityId,
    anomalyScore: score,
    anomalyType: score >= 0.5 ? "zero_power" : "none",
    detectionMethod: "rule_ensemble",
    confidence: 0.8,
    evidencePeriod: [0, 24],
    ...overrides,
  };
}

describe("窃电检测平台侧收集器（批次 7）", () => {
  it("analysisType 为 theft-detection", () => {
    expect(theftDetectionAggregationCollector.analysisType).toBe(
      THEFT_DETECTION_ANALYSIS_TYPE,
    );
  });

  it("merge 接受 { tables } 单结果形态", () => {
    const out = mergeTheftDetectionDeliveries({
      tables: [
        { node: "region-a", aggregate: anomaly("m1", 0.9) },
        { node: "region-b", aggregate: anomaly("m2", 0.2) },
        { node: "region-c", aggregate: anomaly("m3", 0.7) },
      ],
      spec: { anomalyThreshold: 0.35, topK: 10, detectionPeriod: 90 },
    });
    expect(out.analysisType).toBe(THEFT_DETECTION_ANALYSIS_TYPE);
    expect(out.nRegions).toBe(3);
    // entityId 出域前哈希，只验评分门槛与条数
    expect(out.suspiciousUsers.length).toBeGreaterThanOrEqual(2);
    expect(out.suspiciousUsers.every((u) => u.aggregatedScore >= 0.35)).toBe(true);
  });

  it("SPI merge 走 tables 口径", () => {
    const out = theftDetectionAggregationCollector.merge(
      {
        tables: [{ node: "r1", aggregate: anomaly("x", 0.95) }],
      },
      {} as never,
    ) as ReturnType<typeof mergeTheftDetectionDeliveries>;
    expect(out.totalUsers).toBe(1);
    expect(out.suspiciousUsers).toHaveLength(1);
  });

  it("空 tables fail-closed", () => {
    expect(() => mergeTheftDetectionDeliveries({ tables: [] })).toThrow(/没有任何节点/);
  });
});
