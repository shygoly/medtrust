// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { detectAnomaly, MIN_DETECTION_DAYS } from "./anomaly-detection";
import { hashEntityId, mergeTheftDetections } from "./theft-merge";

const HOURS = 24;

function series(days: number, fn: (h: number) => number): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < HOURS; h++) out.push(fn(d * HOURS + h));
  }
  return out;
}

describe("mergeTheftDetections", () => {
  const normal = detectAnomaly({
    entityId: "u-normal",
    powerKw: series(MIN_DETECTION_DAYS, (i) => 50 + 5 * Math.sin(i)),
  });
  const bad = detectAnomaly({
    entityId: "u-bad",
    powerKw: series(MIN_DETECTION_DAYS, (i) => (i % 24 < 18 ? 0 : 30)),
  });

  it("无异常时返回空列表", () => {
    const result = mergeTheftDetections(
      [
        { regionId: "r1", results: [normal] },
        { regionId: "r2", results: [{ ...normal, entityId: "u-normal-2" }] },
      ],
      { anomalyThreshold: 0.5, topK: 10 },
    );
    expect(result.suspiciousUsers).toEqual([]);
    expect(result.theftRate).toBe(0);
  });

  it("输出 Top-K 且 entityId 已哈希", () => {
    const result = mergeTheftDetections(
      [
        { regionId: "r1", results: [normal, bad] },
        { regionId: "r2", results: [{ ...bad, anomalyScore: 0.9 }] },
      ],
      { anomalyThreshold: 0.3, topK: 1, strategy: "max" },
    );
    expect(result.suspiciousUsers).toHaveLength(1);
    expect(result.suspiciousUsers[0]!.entityId).toBe(hashEntityId("u-bad"));
    expect(result.suspiciousUsers[0]!.entityId).not.toBe("u-bad");
    expect(result.suspiciousUsers[0]!.detectedBy).toBe(2);
    expect(result.granularity).toBe(1);
    expect(Number.isInteger(result.theftRate)).toBe(true);
  });

  it("拒绝非法 topK / 阈值", () => {
    expect(() =>
      mergeTheftDetections([{ regionId: "r1", results: [bad] }], { anomalyThreshold: 2, topK: 1 }),
    ).toThrow("异常阈值应在 0-1 之间");
    expect(() =>
      mergeTheftDetections([{ regionId: "r1", results: [bad] }], { anomalyThreshold: 0.5, topK: 0 }),
    ).toThrow("topK 必须为正整数");
  });
});
