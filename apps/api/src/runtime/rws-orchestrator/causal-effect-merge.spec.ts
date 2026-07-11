import { derSimonianLaird } from "./meta-analysis";
import {
  extractCausalSiteEffects,
  mergeCausalEffectAggregates,
} from "./causal-effect-merge";
import type { RwsPartyAggregate } from "./types";

const partyAgg = (
  providerId: string,
  measure: "log_hr" | "ate",
  beta: number,
  se: number,
): { providerId: string; aggregate: RwsPartyAggregate } => ({
  providerId,
  aggregate: {
    analysisType: measure === "log_hr" ? "causal-survival" : "causal-psm",
    cohortSize: 100,
    buckets: [],
    effectEstimate: {
      measure,
      beta,
      standardError: se,
      ci95: [beta - 0.2, beta + 0.2],
    },
  },
});

describe("extractCausalSiteEffects", () => {
  it("maps log_hr and ate measures for meta", () => {
    const sites = extractCausalSiteEffects([
      partyAgg("p-huashan", "log_hr", -0.2, 0.08),
      partyAgg("p-ruijin", "log_hr", -0.35, 0.1),
    ]);
    expect(sites).toHaveLength(2);
    expect(sites[0].measure).toBe("log_hr");
    expect(sites[1].effect).toBe(-0.35);
  });
});

describe("mergeCausalEffectAggregates", () => {
  it("pools HR via MetaAnalysisService outcome", () => {
    const sites = extractCausalSiteEffects([
      partyAgg("p-huashan", "log_hr", -0.2, 0.08),
      partyAgg("p-ruijin", "log_hr", -0.35, 0.1),
    ]);
    const meta = derSimonianLaird(sites);
    const merged = mergeCausalEffectAggregates(
      { type: "causal-survival", level: "L3" },
      [
        partyAgg("p-huashan", "log_hr", -0.2, 0.08).aggregate,
        partyAgg("p-ruijin", "log_hr", -0.35, 0.1).aggregate,
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
      expect(merged.metaPooled.pooledHr).toBeGreaterThan(0);
      expect(merged.metaPooled.forest).toHaveLength(2);
    }
  });

  it("returns skip reason for single site", () => {
    const merged = mergeCausalEffectAggregates(
      { type: "causal-psm", level: "L3" },
      [partyAgg("p-huashan", "ate", 0.1, 0.05).aggregate],
      {
        merged: false,
        reason: "仅一个有效站点",
        code: "single_site",
      },
    );
    expect(merged.metaPooled?.merged).toBe(false);
  });
});
