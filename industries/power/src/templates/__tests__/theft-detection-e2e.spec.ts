// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 窃电检测端到端（任务 5.7）：模板 → 异常检测 → 跨区合并 → 收集器报告。
 */

import { detectAnomaly, MIN_DETECTION_DAYS } from "../../analysis/anomaly-detection";
import { collectTheftDetection } from "../../collectors/theft-detection-collector";
import { buildTheftDetectionPlan } from "../theft-detection";

const HOURS = 24;

function series(days: number, fn: (h: number) => number): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < HOURS; h++) out.push(fn(d * HOURS + h));
  }
  return out;
}

describe("窃电检测端到端链路（5.7）", () => {
  it("两供电局联查产出 Top-K 与整数百分点窃电率", () => {
    const planInput = {
      purpose: "联查",
      applicant: { org: "grid", project: "t" },
      contracts: ["c"],
      participants: [
        { participantId: "r1", dataProductId: "dp1" },
        { participantId: "r2", dataProductId: "dp2" },
      ],
      spec: { detectionPeriod: 60, anomalyThreshold: 0.35, topK: 5 },
      notBefore: "2026-10-01T00:00:00Z",
      notAfter: "2026-12-01T00:00:00Z",
    };
    const plan = buildTheftDetectionPlan(planInput);
    expect(plan.stages.some((s) => s.op === "power.theft-merge@1.0.0")).toBe(true);

    const normalKw = series(MIN_DETECTION_DAYS, (i) => 48 + 8 * Math.sin((2 * Math.PI * (i % 24)) / 24));
    const badKw = series(MIN_DETECTION_DAYS, (i) => (i % 24 < 16 ? 0 : 25));

    const report = collectTheftDetection({
      regions: [
        {
          regionId: "r1",
          results: [
            detectAnomaly({ entityId: "good-1", powerKw: normalKw }),
            detectAnomaly({ entityId: "bad-1", powerKw: badKw }),
          ],
        },
        {
          regionId: "r2",
          results: [
            detectAnomaly({ entityId: "good-2", powerKw: normalKw }),
            detectAnomaly({ entityId: "bad-1", powerKw: badKw }),
          ],
        },
      ],
      spec: { ...planInput.spec, strategy: "max" },
    });

    expect(report.analysisType).toBe("theft-detection");
    expect(report.nRegions).toBe(2);
    expect(report.suspiciousUsers.length).toBeGreaterThan(0);
    expect(report.suspiciousUsers[0]!.entityId.startsWith("u_")).toBe(true);
    expect(Number.isInteger(report.theftRate)).toBe(true);
    expect(report.detectionPeriod).toBe(60);
  });
});
