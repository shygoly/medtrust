// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 比较效果的**统计实现已下移到行业包**（`industries/med/src/analysis/comparative-effect.ts`）。
 * 此处保留具名再导出，并套一层 legacy `AggregateResult`，既有执行器与输出闸门一字不变。
 * `AggregateResult` 依赖链留在连接器，直到 O7 观察窗后删旧接线。
 */
import {
  siteComparativeEffect,
  type StratifyField,
} from "@medtrust/domain-med";
import { AggregateResult, InternalRecord } from "./types";

export type {
  Contingency2x2,
  LogisticFitResult,
  MantelHaenszelResult,
  StratifyField,
} from "@medtrust/domain-med";

export {
  bucketToContingency2x2,
  effectEstimateFromStratifiedTables,
  firthLogisticRegression,
  localLogisticRegression,
  mantelHaenszelPooledOr,
  siteComparativeEffect,
  stratifiedContingencyTables,
  stratumSampleSize,
} from "@medtrust/domain-med";

/** L2 比较研究：包内算出站点效应量，再装进 legacy 聚合结果。 */
export function comparativeEffectEstimate(
  cohort: readonly InternalRecord[],
  drug: string,
  outcome: string,
  outcomeKind: "adverse_event" | "condition" = "adverse_event",
  stratifyBy: StratifyField[] = ["ageBand"],
): AggregateResult {
  const site = siteComparativeEffect(cohort, drug, outcome, outcomeKind, stratifyBy);
  return {
    analysisType: "comparative-effect",
    cohortSize: site.cohortSize,
    outcome: site.outcome,
    buckets: site.buckets,
    effectEstimate: site.effectEstimate,
  };
}
