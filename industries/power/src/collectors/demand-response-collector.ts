// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.demand-response 平台侧收集器（批次 7）：吃各方脱密潜力，跑 dr-optimize。
 */

import type { AggregationCollector } from "@medtrust/space-kernel-spi";

import {
  optimizeDemandResponse,
  type DrOptimizeResult,
  type DrOptimizeSpec,
} from "../analysis/dr-optimize";
import type { DrPotentialResult } from "../analysis/dr-potential";

export const DEMAND_RESPONSE_ANALYSIS_TYPE = "power.demand-response";

export interface DemandResponseDelivery {
  readonly analysisType?: string;
  readonly entityId: string;
  readonly peakReduction: DrPotentialResult["peakReduction"];
  readonly valleyShift: DrPotentialResult["valleyShift"];
  readonly baselineCurve: readonly number[];
  readonly constraints?: DrPotentialResult["constraints"];
}

export interface DemandResponseCollectorOutput extends DrOptimizeResult {
  readonly analysisType: typeof DEMAND_RESPONSE_ANALYSIS_TYPE;
  readonly nParticipants: number;
}

function asPotential(aggregate: DemandResponseDelivery, node: string): DrPotentialResult {
  if (!aggregate.entityId || !Array.isArray(aggregate.baselineCurve)) {
    throw new Error(`节点 ${node} 的需求响应载荷缺 entityId / baselineCurve`);
  }
  return {
    entityId: aggregate.entityId,
    peakReduction: aggregate.peakReduction ?? [],
    valleyShift: aggregate.valleyShift ?? [],
    baselineCurve: [...aggregate.baselineCurve],
    constraints: aggregate.constraints ?? {},
  };
}

/**
 * 合并各方潜力并优化。spec 取计划合并阶段的参数（`params.spec`，平台合并服务透传）；
 * 直调可给 `spec`。缺 spec 即拒——目标负荷与预算是申请方的决定，不由平台编造。
 */
export function mergeDemandResponseDeliveries(input: {
  tables: Array<{ node: string; aggregate: DemandResponseDelivery }>;
  spec?: Partial<DrOptimizeSpec>;
  params?: { spec?: Partial<DrOptimizeSpec> };
}): DemandResponseCollectorOutput {
  if (input.tables.length === 0) throw new Error("需求响应合并没有任何节点载荷");
  const potentials = input.tables.map((t) => asPotential(t.aggregate, t.node));
  const spec = input.spec ?? input.params?.spec;
  if (!spec?.targetLoad || spec.targetLoad.length !== 24) {
    throw new Error("需求响应合并缺 24 小时目标负荷 spec.targetLoad");
  }
  if (!(typeof spec.incentiveBudget === "number" && spec.incentiveBudget > 0)) {
    throw new Error("需求响应合并缺正数激励预算 spec.incentiveBudget");
  }
  const targetLoad = spec.targetLoad;
  const incentiveBudget = spec.incentiveBudget;
  const timeWindow =
    spec.timeWindow && spec.timeWindow[0] < spec.timeWindow[1]
      ? spec.timeWindow
      : ([0, 24] as [number, number]);

  const optimized = optimizeDemandResponse({
    potentials,
    spec: { targetLoad, incentiveBudget, timeWindow },
  });
  return {
    analysisType: DEMAND_RESPONSE_ANALYSIS_TYPE,
    ...optimized,
    nParticipants: potentials.length,
  };
}

export const demandResponseAggregationCollector: AggregationCollector = {
  analysisType: DEMAND_RESPONSE_ANALYSIS_TYPE,
  merge: (input) =>
    mergeDemandResponseDeliveries(
      input as Parameters<typeof mergeDemandResponseDeliveries>[0],
    ),
};
