import type { MetaMergeOutcome } from "./meta-analysis.service";
import type { SiteEffectEstimate } from "./meta-analysis";
import type {
  RwsAnalysisSpec,
  RwsMergedAggregate,
  RwsPartyAggregate,
} from "./types";

/** 从各站 comparative-effect 聚合提取站点级 log OR + SE,供 MetaAnalysisService. */
export function extractSiteEffects(
  assignments: Array<{ providerId: string; aggregate: RwsPartyAggregate }>,
): SiteEffectEstimate[] {
  return assignments
    .filter((a) => a.aggregate?.effectEstimate)
    .map((a) => ({
      siteId: a.providerId,
      effect: a.aggregate!.effectEstimate!.beta,
      standardError: a.aggregate!.effectEstimate!.standardError,
      measure: "log_or" as const,
    }));
}

/** 跨站加和分层 2×2 (与 L1.5 poolSites 同理,按 stratum key). */
export function poolStratifiedBuckets(
  aggregates: RwsPartyAggregate[],
): RwsMergedAggregate["buckets"] {
  const byKey = new Map<
    string,
    { a: number; b: number; c: number; d: number }
  >();
  for (const agg of aggregates) {
    for (const bucket of agg.buckets) {
      const cur = byKey.get(bucket.key) ?? { a: 0, b: 0, c: 0, d: 0 };
      cur.a += bucket.count;
      cur.b += bucket.b ?? 0;
      cur.c += bucket.c ?? 0;
      cur.d += bucket.d ?? 0;
      byKey.set(bucket.key, cur);
    }
  }
  return [...byKey.entries()]
    .map(([key, t]) => {
      const n = t.a + t.b + t.c + t.d || 1;
      return {
        key,
        count: t.a,
        rate: +(t.a / n).toFixed(4),
        b: t.b,
        c: t.c,
        d: t.d,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** L2 中心合并: 池化分层表 + 随机效应 meta pooled OR. */
export function mergeComparativeEffectAggregates(
  analysis: RwsAnalysisSpec,
  aggregates: RwsPartyAggregate[],
  metaMerge?: MetaMergeOutcome,
): RwsMergedAggregate {
  const cohortSize = aggregates.reduce((s, a) => s + a.cohortSize, 0);
  const base: RwsMergedAggregate = {
    analysisType: aggregates[0]?.analysisType ?? analysis.type,
    cohortSize,
    outcome: aggregates[0]?.outcome,
    buckets: poolStratifiedBuckets(aggregates),
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
  return {
    ...base,
    metaPooled: {
      merged: true,
      method: result.method,
      pooledEffect: result.pooledEffect,
      pooledOr: Math.exp(result.pooledEffect),
      pooledSe: result.pooledSe,
      ci95: result.ci95,
      orCi95: [Math.exp(result.ci95[0]), Math.exp(result.ci95[1])] as [
        number,
        number,
      ],
      heterogeneity: result.heterogeneity,
      forest: result.forest,
      inputFingerprint,
      resultHash,
      attestation,
    },
  };
}
