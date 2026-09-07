import type { MetaMergeOutcome } from "./meta-analysis.service";
import type { EffectMeasure, SiteEffectEstimate } from "./meta-analysis";
import type {
  RwsAnalysisSpec,
  RwsMergedAggregate,
  RwsPartyAggregate,
} from "./types";

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

/**
 * E-value 闭式 (VanderWeele & Ding 2017): 使点估计/置信区间被未测量混杂
 * 完全解释(或推到含无效值)所需的最小暴露-混杂联合关联 (RR 尺度)。
 */
export function evalueForRatio(rr: number): number {
  const r = rr < 1 ? 1 / rr : rr;
  return r + Math.sqrt(r * (r - 1));
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
    pooled.hrCi95 = [Math.exp(result.ci95[0]), Math.exp(result.ci95[1])] as [
      number,
      number,
    ];
    // L3-confounding: 主结果报告附未测量混杂稳健性分析 (E-value) 与解释文本.
    const hrCi95 = pooled.hrCi95;
    const closestToNull =
      Math.abs(1 - hrCi95[0]) < Math.abs(hrCi95[1] - 1) ? hrCi95[0] : hrCi95[1];
    pooled.unmeasuredConfounding = {
      method: "evalue",
      evaluePoint: evalueForRatio(pooled.pooledHr),
      evalueCi: evalueForRatio(closestToNull),
      interpretation:
        "未测量混杂稳健性分析（E-value）：E-value 为使观测效应被未测量混杂完全解释(或推到含无效值)所需的最小暴露-混杂联合关联。E-value 越小越易被未测量混杂推翻；解释时应结合研究设计与残余混杂的可能强度，不能仅凭 E-value 判定因果。",
    };
  }
  return { ...base, metaPooled: pooled };
}
