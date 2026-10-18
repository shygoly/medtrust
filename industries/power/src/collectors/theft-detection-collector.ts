// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.theft-detection 平台侧收集器（任务 5.4 / 批次 7）。
 *
 * 合并服务传入 `{ tables: [{ node, aggregate }] }`；aggregate 为各方异常检测结果。
 */

import type { AggregationCollector } from "@medtrust/space-kernel-spi";

import type { AnomalyDetectionResult, AnomalyType } from "../analysis/anomaly-detection";
import {
  mergeTheftDetections,
  type SuspiciousUser,
  type TheftMergeSpec,
} from "../analysis/theft-merge";

/**
 * 平台收集器的注册键（analysisType）。
 *
 * 加包前缀：`registerCollector` 对同类型是**静默覆盖**（后者生效），未加前缀的名字
 * （原为 `theft-detection`）一旦与别的包撞键，失败形态是"悄悄用错收集器"而不是报错。
 * 另两个电力场景本来就是 `power.*`，这里对齐。
 * 注意与**隐私场景名** `"theft-detection"`（`PowerPrivacyScenario` / ε 上限表的键）区分：
 * 那是 DP 预算的口径，与本注册键不是同一个命名空间，不要一起改。
 */
export const THEFT_DETECTION_ANALYSIS_TYPE = "power.theft-detection";

export interface TheftDetectionDelivery extends AnomalyDetectionResult {
  readonly analysisType?: string;
}

export interface TheftDetectionCollectorOutput {
  readonly analysisType: typeof THEFT_DETECTION_ANALYSIS_TYPE;
  readonly suspiciousUsers: readonly SuspiciousUser[];
  readonly anomalyPatterns: Readonly<Record<string, number>>;
  readonly theftRate: number;
  readonly detectionPeriod: number;
  readonly nRegions: number;
  readonly totalUsers: number;
}

/** 保留旧入口：regions + spec（单测 / 直调）。 */
export function collectTheftDetection(input: {
  readonly regions: readonly {
    readonly regionId: string;
    readonly results: readonly AnomalyDetectionResult[];
  }[];
  readonly spec: TheftMergeSpec & { readonly detectionPeriod: number };
}): TheftDetectionCollectorOutput {
  const merged = mergeTheftDetections(input.regions, input.spec);
  const anomalyPatterns: Record<string, number> = {};
  for (const u of merged.suspiciousUsers) {
    const key: AnomalyType | string = u.anomalyType;
    anomalyPatterns[key] = (anomalyPatterns[key] ?? 0) + 1;
  }
  return {
    analysisType: THEFT_DETECTION_ANALYSIS_TYPE,
    suspiciousUsers: merged.suspiciousUsers,
    anomalyPatterns,
    theftRate: merged.theftRate,
    detectionPeriod: input.spec.detectionPeriod,
    nRegions: merged.nRegions,
    totalUsers: merged.totalUsers,
  };
}

type TheftSpecInput = Partial<TheftMergeSpec> & { detectionPeriod?: number };

/**
 * 平台合并服务口径：`{ tables, params }`（params.spec 为计划合并阶段的参数）。
 * 节点只放行超阈值表计，故总户数以各节点自报的表计数 `nMeters` 为准（缺省退回到放行条数）。
 */
export function mergeTheftDetectionDeliveries(input: {
  tables: Array<{
    node: string;
    aggregate: TheftDetectionDelivery | { results?: AnomalyDetectionResult[]; nMeters?: number };
  }>;
  spec?: TheftSpecInput;
  params?: { spec?: TheftSpecInput };
}): TheftDetectionCollectorOutput {
  if (input.tables.length === 0) throw new Error("窃电检测合并没有任何节点载荷");
  const spec = input.spec ?? input.params?.spec;
  let population = 0;
  let populationKnown = true;
  const regions = input.tables.map((t) => {
    const agg = t.aggregate as TheftDetectionDelivery & { results?: AnomalyDetectionResult[]; nMeters?: number };
    const results: AnomalyDetectionResult[] = Array.isArray(agg.results)
      ? agg.results
      : [
          {
            entityId: agg.entityId,
            anomalyScore: agg.anomalyScore,
            anomalyType: agg.anomalyType,
            detectionMethod: agg.detectionMethod,
            confidence: agg.confidence,
            evidencePeriod: agg.evidencePeriod,
          },
        ];
    if (results.some((r) => !r?.entityId)) throw new Error(`节点 ${t.node} 的窃电载荷缺 entityId`);
    if (typeof agg.nMeters === "number") population += agg.nMeters;
    else populationKnown = false;
    return { regionId: t.node, results };
  });
  return collectTheftDetection({
    regions,
    spec: {
      anomalyThreshold: spec?.anomalyThreshold ?? 0.35,
      topK: spec?.topK ?? 20,
      strategy: spec?.strategy ?? "max",
      detectionPeriod: spec?.detectionPeriod ?? 90,
      // 跨区域同一表计会被两个节点各计一次：分母取上界不低于去重后的结果数
      ...(populationKnown && population > 0
        ? { populationSize: Math.max(population, new Set(regions.flatMap((r) => r.results.map((x) => x.entityId))).size) }
        : {}),
    },
  });
}

export const theftDetectionAggregationCollector: AggregationCollector = {
  analysisType: THEFT_DETECTION_ANALYSIS_TYPE,
  merge: (input) =>
    mergeTheftDetectionDeliveries(input as Parameters<typeof mergeTheftDetectionDeliveries>[0]),
};
