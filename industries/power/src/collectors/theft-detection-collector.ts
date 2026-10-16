// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.theft-detection 的平台侧聚合收集器（任务 5.4）。
 */

import type { AggregationCollector } from "@medtrust/space-kernel-spi";

import type { AnomalyType } from "../analysis/anomaly-detection";
import {
  mergeTheftDetections,
  type RegionAnomalyBatch,
  type SuspiciousUser,
  type TheftMergeSpec,
} from "../analysis/theft-merge";

export const THEFT_DETECTION_ANALYSIS_TYPE = "theft-detection";

export interface TheftDetectionCollectorInput {
  readonly regions: readonly RegionAnomalyBatch[];
  readonly spec: TheftMergeSpec & { readonly detectionPeriod: number };
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

export function collectTheftDetection(
  input: TheftDetectionCollectorInput,
): TheftDetectionCollectorOutput {
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

export const theftDetectionAggregationCollector: AggregationCollector<
  TheftDetectionCollectorInput,
  TheftDetectionCollectorOutput
> = {
  analysisType: THEFT_DETECTION_ANALYSIS_TYPE,
  merge: (input) => collectTheftDetection(input),
};
