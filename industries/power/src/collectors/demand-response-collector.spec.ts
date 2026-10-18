// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import type { DrPotentialResult } from "../analysis/dr-potential";
import {
  DEMAND_RESPONSE_ANALYSIS_TYPE,
  demandResponseAggregationCollector,
  mergeDemandResponseDeliveries,
} from "./demand-response-collector";

function potential(entityId: string, baseline = 80): DrPotentialResult {
  const baselineCurve = Array.from({ length: 24 }, (_, h) =>
    h >= 9 && h <= 17 ? baseline * 1.2 : baseline * 0.8,
  );
  const peakReduction = [9, 10, 11, 14, 15, 16].map(
    (h) => [h, baseline * 0.15, 0.9] as const,
  );
  const valleyShift = [0, 1, 2, 3, 22, 23].map(
    (h) => [h, baseline * 0.1, 0.5] as const,
  );
  return {
    entityId,
    peakReduction,
    valleyShift,
    baselineCurve,
    constraints: {},
  };
}

const TARGET = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 17 ? 120 : 150));

describe("需求响应平台侧收集器（批次 7）", () => {
  it("analysisType 为 power.demand-response", () => {
    expect(demandResponseAggregationCollector.analysisType).toBe(
      DEMAND_RESPONSE_ANALYSIS_TYPE,
    );
  });

  it("merge 接受 { tables } 并产出优化计划", () => {
    const out = mergeDemandResponseDeliveries({
      tables: [
        { node: "n1", aggregate: potential("u1", 100) },
        { node: "n2", aggregate: potential("u2", 60) },
      ],
      spec: {
        targetLoad: TARGET,
        incentiveBudget: 500_000,
        timeWindow: [0, 24],
      },
    });
    expect(out.analysisType).toBe(DEMAND_RESPONSE_ANALYSIS_TYPE);
    expect(out.nParticipants).toBe(2);
    expect(out.adjustmentPlan).toHaveLength(24);
    expect(out.incentiveAllocation.length).toBeGreaterThan(0);
  });

  it("SPI merge 读合并阶段 params.spec，与直调口径一致", () => {
    const tables = [
      { node: "a", aggregate: potential("a1") },
      { node: "b", aggregate: potential("b1") },
    ];
    const spec = { targetLoad: TARGET, incentiveBudget: 10_000, timeWindow: [8, 20] as [number, number] };
    const viaSpi = demandResponseAggregationCollector.merge(
      { tables, params: { spec } },
      {} as never,
    ) as ReturnType<typeof mergeDemandResponseDeliveries>;
    const direct = mergeDemandResponseDeliveries({ tables, spec });
    expect(viaSpi).toEqual(direct);
  });

  it("缺目标负荷或预算即拒（不由平台编造申请方的决定）", () => {
    const tables = [{ node: "a", aggregate: potential("a1") }];
    expect(() => mergeDemandResponseDeliveries({ tables })).toThrow(/targetLoad/);
    expect(() =>
      mergeDemandResponseDeliveries({ tables, params: { spec: { targetLoad: TARGET } } }),
    ).toThrow(/incentiveBudget/);
  });

  it("空 tables fail-closed", () => {
    expect(() => mergeDemandResponseDeliveries({ tables: [] })).toThrow(/没有任何节点/);
  });
});
