// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 需求响应场景端到端测试（任务 4.5）。
 *
 * 链路：多方历史负荷 → 潜力评估 → 平台优化 → 校验峰谷差与预算。
 */

import { assessDrPotential, HOURS_PER_DAY, MIN_HISTORY_DAYS } from "../../analysis/dr-potential";
import { optimizeDemandResponse } from "../../analysis/dr-optimize";
import { buildDemandResponsePlan } from "../demand-response";

function buildHistory(base: number, amplitude: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < MIN_HISTORY_DAYS; d++) {
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      out.push(Math.max(0, base + amplitude * Math.sin((2 * Math.PI * h) / HOURS_PER_DAY)));
    }
  }
  return out;
}

describe("需求响应端到端链路（4.5）", () => {
  it("计划模板 → 潜力评估 → 优化，峰谷差下降且激励在预算内", () => {
    const planInput = {
      purpose: "园区削峰填谷联调",
      applicant: { org: "grid-co", project: "dr-e2e" },
      contracts: ["c-1"],
      participants: [
        { participantId: "site-a", dataProductId: "dp-a" },
        { participantId: "site-b", dataProductId: "dp-b" },
        { participantId: "site-c", dataProductId: "dp-c" },
      ],
      spec: {
        targetLoad: Array.from({ length: 24 }, () => 300),
        incentiveBudget: 20_000,
        timeWindow: [0, 24] as [number, number],
      },
      notBefore: "2026-10-01T00:00:00Z",
      notAfter: "2026-11-01T00:00:00Z",
    };

    const plan = buildDemandResponsePlan(planInput);
    expect(plan.stages.some((s) => s.op === "power.dr-optimize@1.0.0")).toBe(true);
    expect(plan.stages.filter((s) => s.op === "power.dr-potential@1.0.0")).toHaveLength(3);

    const potentials = [
      assessDrPotential({
        entityId: "site-a",
        historyKw: buildHistory(120, 40),
        userType: "industrial",
      }),
      assessDrPotential({
        entityId: "site-b",
        historyKw: buildHistory(90, 25),
        userType: "commercial",
      }),
      assessDrPotential({
        entityId: "site-c",
        historyKw: buildHistory(60, 15),
        userType: "residential",
      }),
    ];

    const baseline = Array.from({ length: 24 }, (_, h) =>
      potentials.reduce((s, p) => s + p.baselineCurve[h]!, 0),
    );
    const before = Math.max(...baseline) - Math.min(...baseline);

    const result = optimizeDemandResponse({
      potentials,
      spec: planInput.spec,
    });

    expect(result.peakValleyDiff).toBeLessThan(before);
    expect(result.totalIncentive).toBeLessThanOrEqual(planInput.spec.incentiveBudget);
    expect(result.adjustmentPlan.some((v) => v !== 0)).toBe(true);
    expect(result.incentiveAllocation.length).toBeGreaterThan(0);
  });
});
