import type { MetaMergeOutcome } from "./meta-analysis.service";
import type { EffectMeasure, SiteEffectEstimate } from "./meta-analysis";
import type { RwsAnalysisSpec, RwsMergedAggregate, RwsPartyAggregate } from "./types";

/** 从各站 L3 聚合提取站点级 log HR / ATE + SE. */
export function extractCausalSiteEffects(
  assignments: Array<{ providerId: string; aggregate: RwsPartyAggregate }>,
): SiteEffectEstimate[] {
  return assignments
    .filter((a) => a.aggregate?.effectEstimate)
    .map((a) => {
      const est = a.aggregate!.effectEstimate!;
      const measure = (est.measure ?? "ate") as EffectMeasure;
      return {
        siteId: a.providerId,
        effect: est.beta,
        standardError: est.standardError,
        measure,
      };
    });
}

/** L3 中心合并: 随机效应 meta pooled HR/ATE. */
export function mergeCausalEffectAggregates(
  analysis: RwsAnalysisSpec,
  aggregates: RwsPartyAggregate[],
  metaMerge?: MetaMergeOutcome,
): RwsMergedAggregate {
  const cohortSize = aggregates.reduce((s, a) => s + a.cohortSize, 0);
  const base: RwsMergedAggregate = {
    analysisType: aggregates[0]?.analysisType ?? analysis.type,
    cohortSize,
    buckets: [],
    kmCurve: aggregates.find((a) => a.kmCurve)?.kmCurve,
  };

  if (!metaMerge) return base;

  if (metaMerge.merged === false) {
    return {
      ...base,
      metaPooled: {
        merged: false,
        reason: metaMerge.reason,
        code: metaMerge.code,
      },
    };
  }

  const { result, inputFingerprint, resultHash, attestation } = metaMerge;
  const measure = aggregates[0]?.effectEstimate?.measure ?? "ate";
  const pooled: RwsMergedAggregate["metaPooled"] = {
    merged: true,
    method: result.method,
    pooledEffect: result.pooledEffect,
    pooledSe: result.pooledSe,
    ci95: result.ci95,
    heterogeneity: result.heterogeneity,
    forest: result.forest,
    inputFingerprint,
    resultHash,
    attestation,
  };
  if (measure === "log_hr") {
    pooled.pooledHr = Math.exp(result.pooledEffect);
    pooled.hrCi95 = [Math.exp(result.ci95[0]), Math.exp(result.ci95[1])] as [number, number];
  }
  return { ...base, metaPooled: pooled };
}
