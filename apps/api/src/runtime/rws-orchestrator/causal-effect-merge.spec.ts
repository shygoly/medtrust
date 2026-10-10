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
      partyAgg("p-demohospa", "log_hr", -0.2, 0.08),
      partyAgg("p-demohospb", "log_hr", -0.35, 0.1),
    ]);
    expect(sites).toHaveLength(2);
    expect(sites[0].measure).toBe("log_hr");
    expect(sites[1].effect).toBe(-0.35);
  });
});

describe("mergeCausalEffectAggregates", () => {
  it("pools HR via MetaAnalysisService outcome", () => {
    const sites = extractCausalSiteEffects([
      partyAgg("p-demohospa", "log_hr", -0.2, 0.08),
      partyAgg("p-demohospb", "log_hr", -0.35, 0.1),
    ]);
    const meta = derSimonianLaird(sites);
    const merged = mergeCausalEffectAggregates(
      { type: "causal-survival", level: "L3" },
      [
        partyAgg("p-demohospa", "log_hr", -0.2, 0.08).aggregate,
        partyAgg("p-demohospb", "log_hr", -0.35, 0.1).aggregate,
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
      [partyAgg("p-demohospa", "ate", 0.1, 0.05).aggregate],
      {
        merged: false,
        reason: "仅一个有效站点",
        code: "single_site",
      },
    );
    expect(merged.metaPooled?.merged).toBe(false);
  });
});

/** E-value 闭式 (VanderWeele & Ding 2017): 使点估计/置信区间被未测量混杂
 * 完全解释(或推到含无效值)所需的最小暴露-混杂联合关联 (RR 尺度). */
function evalueForRatio(rr: number): number {
  const r = rr < 1 ? 1 / rr : rr;
  return r + Math.sqrt(r * (r - 1));
}

describe("L3-confounding — 未测量混杂稳健性 (E-value) 主结果报告", () => {
  it("reports checkable E-value + interpretation for pooled HR", () => {
    const sites = extractCausalSiteEffects([
      partyAgg("p-demohospa", "log_hr", -0.2, 0.08),
      partyAgg("p-demohospb", "log_hr", -0.35, 0.1),
    ]);
    const meta = derSimonianLaird(sites);
    const merged = mergeCausalEffectAggregates(
      { type: "causal-survival", level: "L3" },
      [
        partyAgg("p-demohospa", "log_hr", -0.2, 0.08).aggregate,
        partyAgg("p-demohospb", "log_hr", -0.35, 0.1).aggregate,
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
    if (!merged.metaPooled?.merged) return;

    // L3-confounding acceptance: 主结果报告须附未测量混杂稳健性分析 (E-value) 与解释文本.
    const bias = (
      merged.metaPooled as unknown as {
        unmeasuredConfounding?: {
          method?: string;
          evaluePoint?: number;
          evalueCi?: number;
          interpretation?: string;
        };
      }
    ).unmeasuredConfounding;

    expect(bias).toBeDefined();
    expect(bias?.method).toBe("evalue");

    // 数值可与点估计/置信区间核对: pooled HR≈0.7687 (保护方向) → E-point≈1.926;
    // 置信区间靠无效值一侧上界≈0.8888 → E-CI≈1.500.
    const pooledHr = merged.metaPooled.pooledHr!;
    const hrCi95 = merged.metaPooled.hrCi95!;
    const closestToNull =
      Math.abs(1 - hrCi95[0]) < Math.abs(hrCi95[1] - 1) ? hrCi95[0] : hrCi95[1];
    expect(bias?.evaluePoint).toBeCloseTo(1.9264, 3);
    expect(bias?.evaluePoint).toBeCloseTo(evalueForRatio(pooledHr), 3);
    expect(bias?.evalueCi).toBeCloseTo(1.5003, 3);
    expect(bias?.evalueCi).toBeCloseTo(evalueForRatio(closestToNull), 3);

    // 附解释文本, 说明残余/未测量混杂的适用边界.
    expect(bias?.interpretation).toBeDefined();
    expect(String(bias?.interpretation ?? "").length).toBeGreaterThan(0);
    expect(String(bias?.interpretation ?? "")).toMatch(
      /未测量混杂|未观测混杂|unmeasured confounding/i,
    );
  });
});
