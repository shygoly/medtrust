// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import {
  MIN_DETECTION_DAYS,
  MIN_DETECTION_POINTS,
  detectAnomalies,
  detectAnomaly,
  ruleFeatures,
} from "./anomaly-detection";

const HOURS = 24;

function series(days: number, fn: (h: number) => number): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < HOURS; h++) out.push(fn(d * HOURS + h));
  }
  return out;
}

const normal = () => series(MIN_DETECTION_DAYS, (i) => 50 + 10 * Math.sin((2 * Math.PI * (i % 24)) / 24));
const zeroHeavy = () => series(MIN_DETECTION_DAYS, (i) => (i % 24 < 12 ? 0 : 40));
const negative = () => series(MIN_DETECTION_DAYS, (i) => (i % 50 === 0 ? -5 : 45));
const spike = () => series(MIN_DETECTION_DAYS, (i) => (i % 24 === 12 ? 500 : 40));

describe("ruleFeatures", () => {
  it("识别零功率与负功率", () => {
    expect(ruleFeatures(zeroHeavy()).dominantType).toBe("zero_power");
    expect(ruleFeatures(negative()).negative).toBeGreaterThan(0.5);
  });
});

describe("detectAnomaly", () => {
  it("正常用户评分 < 0.3", () => {
    const r = detectAnomaly({ entityId: "n1", powerKw: normal() });
    expect(r.anomalyScore).toBeLessThan(0.3);
  });

  it("零功率用户评分偏高且类型正确", () => {
    const r = detectAnomaly({ entityId: "z1", powerKw: zeroHeavy() });
    expect(r.anomalyScore).toBeGreaterThan(0.3);
    expect(r.anomalyType).toBe("zero_power");
  });

  it("负功率 / 突变可检出", () => {
    expect(detectAnomaly({ entityId: "neg", powerKw: negative() }).anomalyScore).toBeGreaterThan(0.3);
    expect(detectAnomaly({ entityId: "spk", powerKw: spike() }).anomalyScore).toBeGreaterThan(0.3);
  });

  it("冷启动数据不足时标记 insufficient_data", () => {
    const r = detectAnomaly({ entityId: "new", powerKw: series(7, () => 40) });
    expect(r.anomalyType).toBe("insufficient_data");
  });

  it("冷启动有同类基准时仍可给弱评分", () => {
    const r = detectAnomaly({
      entityId: "new2",
      powerKw: series(7, () => 0),
      peerMeanKw: 50,
    });
    expect(r.anomalyScore).toBeGreaterThan(0);
  });

  it("全正常边界：所有评分 < 0.3", () => {
    const results = detectAnomalies([
      { entityId: "a", powerKw: normal() },
      { entityId: "b", powerKw: series(MIN_DETECTION_DAYS, () => 55) },
    ]);
    expect(results.every((r) => r.anomalyScore < 0.3)).toBe(true);
  });
});
