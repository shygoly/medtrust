import {
  extractSiteEffects,
  mergeComparativeEffectAggregates,
  poolStratifiedBuckets,
} from "./comparative-effect-merge";
import { derSimonianLaird } from "./meta-analysis";
import type { RwsPartyAggregate } from "./types";

const partyAgg = (
  providerId: string,
  beta: number,
  se: number,
  buckets: RwsPartyAggregate["buckets"],
): { providerId: string; aggregate: RwsPartyAggregate } => ({
  providerId,
  aggregate: {
    analysisType: "comparative-effect",
    cohortSize: 100,
    outcome: "ALT升高",
    buckets,
    effectEstimate: {
      measure: "log_or",
      beta,
      standardError: se,
      covariance: [
        [0.1, 0],
        [0, se * se],
      ],
      ci95: [beta - 0.2, beta + 0.2],
      mantelHaenszel: {
        logOr: beta,
        or: Math.exp(beta),
        standardError: se,
        ci95: [beta - 0.2, beta + 0.2],
      },
    },
  },
});

describe("extractSiteEffects", () => {
  it("maps providerId → site effect", () => {
    const sites = extractSiteEffects([
      partyAgg("p-huashan", 0.6, 0.2, []),
      partyAgg("p-ruijin", 0.4, 0.25, []),
    ]);
    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({ siteId: "p-huashan", effect: 0.6 });
  });
});

describe("poolStratifiedBuckets", () => {
  it("sums a/b/c/d per stratum across sites", () => {
    const pooled = poolStratifiedBuckets([
      {
        analysisType: "comparative-effect",
        cohortSize: 10,
        buckets: [{ key: "40-49", count: 2, rate: 0.2, b: 3, c: 1, d: 4 }],
      },
      {
        analysisType: "comparative-effect",
        cohortSize: 8,
        buckets: [{ key: "40-49", count: 1, rate: 0.125, b: 2, c: 2, d: 3 }],
      },
    ]);
    expect(pooled[0]).toMatchObject({
      key: "40-49",
      count: 3,
      b: 5,
      c: 3,
      d: 7,
    });
  });
});

describe("mergeComparativeEffectAggregates", () => {
  it("includes meta pooled OR when ≥2 sites merged", () => {
    const sites = extractSiteEffects([
      partyAgg("p-huashan", 0.6, 0.2, [
        { key: "40-49", count: 4, rate: 0.4, b: 6, c: 2, d: 8 },
      ]),
      partyAgg("p-ruijin", 0.4, 0.2, [
        { key: "40-49", count: 2, rate: 0.25, b: 6, c: 1, d: 3 },
      ]),
    ]);
    const meta = derSimonianLaird(sites);
    const merged = mergeComparativeEffectAggregates(
      { type: "comparative-effect", level: "L2", outcome: "ALT升高" },
      [
        partyAgg("p-huashan", 0.6, 0.2, [
          { key: "40-49", count: 4, rate: 0.4, b: 6, c: 2, d: 8 },
        ]).aggregate,
        partyAgg("p-ruijin", 0.4, 0.2, [
          { key: "40-49", count: 2, rate: 0.25, b: 6, c: 1, d: 3 },
        ]).aggregate,
      ],
      {
        merged: true,
        result: meta,
        inputFingerprint: "SM3:abc",
        resultHash: "SM3:def",
        attestation: { txHash: "0x1", block: 1, hash: "SM3:def" },
      },
    );
    expect(merged.metaPooled?.merged).toBe(true);
    if (merged.metaPooled?.merged) {
      expect(merged.metaPooled.pooledOr).toBeGreaterThan(0);
      expect(merged.metaPooled.forest).toHaveLength(2);
    }
    expect(merged.buckets[0].count).toBe(6);
  });

  it("returns skip reason for single site", () => {
    const merged = mergeComparativeEffectAggregates(
      { type: "comparative-effect" },
      [partyAgg("p-huashan", 0.5, 0.2, []).aggregate],
      {
        merged: false,
        reason: "仅一个有效站点",
        code: "single_site",
      },
    );
    expect(merged.metaPooled).toEqual({
      merged: false,
      reason: "仅一个有效站点",
      code: "single_site",
    });
  });
});
