// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { assessDrPotential, HOURS_PER_DAY, MIN_HISTORY_DAYS } from "./dr-potential";
import { optimizeDemandResponse } from "./dr-optimize";

function buildHistory(base: number, amplitude: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < MIN_HISTORY_DAYS; d++) {
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      out.push(base + amplitude * Math.sin((2 * Math.PI * h) / HOURS_PER_DAY));
    }
  }
  return out;
}

function makePotentials(n: number) {
  return Array.from({ length: n }, (_, i) =>
    assessDrPotential({
      entityId: `user-${i + 1}`,
      historyKw: buildHistory(80 + i * 10, 25 + i * 5),
      userType: i % 2 === 0 ? "industrial" : "commercial",
    }),
  );
}

describe("optimizeDemandResponse", () => {
  const targetLoad = Array.from({ length: 24 }, (_, h) => 100 + 20 * Math.sin((2 * Math.PI * h) / 24));

  it("在预算内降低峰谷差并输出方案字段", () => {
    const potentials = makePotentials(4);
    const baseline = Array.from({ length: 24 }, (_, h) =>
      potentials.reduce((s, p) => s + p.baselineCurve[h]!, 0),
    );
    const before = Math.max(...baseline) - Math.min(...baseline);

    const result = optimizeDemandResponse({
      potentials,
      spec: { targetLoad, incentiveBudget: 50_000, timeWindow: [0, 24] },
    });

    expect(result.adjustmentPlan).toHaveLength(24);
    expect(result.totalIncentive).toBeGreaterThan(0);
    expect(result.totalIncentive).toBeLessThanOrEqual(50_000);
    expect(result.peakValleyDiff).toBeLessThanOrEqual(before);
    expect(result.incentiveAllocation.length).toBeGreaterThan(0);
    expect(result.incentiveAllocation.every((e) => e.groupId.startsWith("user-group-"))).toBe(true);
    expect(result.participationRate).toBeGreaterThan(0);
  });

  it("激励不超过预算", () => {
    const result = optimizeDemandResponse({
      potentials: makePotentials(3),
      spec: { targetLoad, incentiveBudget: 100, timeWindow: [8, 20] },
    });
    expect(result.totalIncentive).toBeLessThanOrEqual(100);
  });

  it("预算为 0 时拒绝", () => {
    expect(() =>
      optimizeDemandResponse({
        potentials: makePotentials(2),
        spec: { targetLoad, incentiveBudget: 0, timeWindow: [0, 24] },
      }),
    ).toThrow("激励预算必须为正数");
  });

  it("目标负荷长度非法时拒绝", () => {
    expect(() =>
      optimizeDemandResponse({
        potentials: makePotentials(2),
        spec: { targetLoad: [1, 2], incentiveBudget: 1000, timeWindow: [0, 24] },
      }),
    ).toThrow("目标负荷曲线应包含 24 小时数据");
  });

  it("时间窗口无效时拒绝", () => {
    expect(() =>
      optimizeDemandResponse({
        potentials: makePotentials(2),
        spec: { targetLoad, incentiveBudget: 1000, timeWindow: [12, 12] },
      }),
    ).toThrow("调节时间窗口无效");
  });

  it("潜力全空时抛出无法满足约束", () => {
    const empty = makePotentials(2).map((p) => ({
      ...p,
      peakReduction: [] as const,
      valleyShift: [] as const,
    }));
    expect(() =>
      optimizeDemandResponse({
        potentials: empty,
        spec: { targetLoad, incentiveBudget: 1000, timeWindow: [0, 24] },
      }),
    ).toThrow("无法满足约束条件");
  });

  it("单用户调节份额不超过上限", () => {
    const potentials = makePotentials(5);
    const result = optimizeDemandResponse({
      potentials,
      spec: { targetLoad, incentiveBudget: 100_000, timeWindow: [0, 24] },
    });
    const total = result.incentiveAllocation.reduce((s, e) => s + e.adjustmentKwh, 0);
    for (const e of result.incentiveAllocation) {
      expect(e.adjustmentKwh / total).toBeLessThanOrEqual(0.35 + 1e-9);
    }
  });
});
