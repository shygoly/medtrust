import {
  poolSites,
  prr,
  ror,
  chiSqYates,
  informationComponent,
  computeDisproportionality,
  mergeDisproportionalityAggregates,
  EVANS,
  Contingency2x2,
} from "./disproportionality";
import type { RwsAnalysisSpec, RwsPartyAggregate } from "./types";

describe("poolSites", () => {
  it("sums site-level 2x2 cells (federated additive pooling)", () => {
    const sites: Contingency2x2[] = [
      { a: 20, b: 40, c: 5, d: 400 },
      { a: 10, b: 30, c: 5, d: 490 },
    ];
    expect(poolSites(sites)).toEqual({ a: 30, b: 70, c: 10, d: 890 });
  });

  it("returns an all-zero table for no sites", () => {
    expect(poolSites([])).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });
});

describe("prr", () => {
  // a=30,b=70,c=10,d=890 → PRR = (30/100)/(10/900) = 27.0
  it("computes PRR on a signal table", () => {
    const r = prr({ a: 30, b: 70, c: 10, d: 890 });
    expect(r.value).toBeCloseTo(27.0, 6);
    expect(r.ci95[0]).toBeLessThan(r.value);
    expect(r.ci95[1]).toBeGreaterThan(r.value);
    expect(r.ci95[0]).toBeGreaterThan(1);
  });

  it("applies Haldane +0.5 when a cell is zero (no Inf/NaN)", () => {
    const r = prr({ a: 0, b: 10, c: 5, d: 985 });
    expect(Number.isFinite(r.value)).toBe(true);
    expect(Number.isFinite(r.ci95[0])).toBe(true);
  });
});

describe("ror", () => {
  // a=30,b=70,c=10,d=890 → ROR = ad/bc = 26700/700 = 38.142857
  it("computes ROR on a signal table", () => {
    const r = ror({ a: 30, b: 70, c: 10, d: 890 });
    expect(r.value).toBeCloseTo(38.142857, 4);
    expect(r.ci95[0]).toBeGreaterThan(1);
  });
});

describe("chiSqYates", () => {
  // a=30,b=70,c=10,d=890 → Yates χ² ≈ 188.15
  it("computes Yates-corrected chi-square", () => {
    expect(chiSqYates({ a: 30, b: 70, c: 10, d: 890 })).toBeCloseTo(188.15, 1);
  });

  it("returns 0 when a margin is zero (undefined test → no signal)", () => {
    expect(chiSqYates({ a: 0, b: 0, c: 5, d: 995 })).toBe(0);
  });
});

describe("informationComponent", () => {
  // E=(100*40)/1000=4 → IC=log2((30+.5)/(4+.5))=log2(6.7778)≈2.76
  it("computes BCPNN IC point estimate", () => {
    expect(informationComponent({ a: 30, b: 70, c: 10, d: 890 })).toBeCloseTo(
      2.76,
      2,
    );
  });

  it("is finite when a is zero (shrinkage avoids -Inf)", () => {
    expect(
      Number.isFinite(informationComponent({ a: 0, b: 100, c: 40, d: 860 })),
    ).toBe(true);
  });
});

describe("computeDisproportionality", () => {
  it("flags a signal meeting Evans criteria (pooled from two sites)", () => {
    const pooled = poolSites([
      { a: 20, b: 40, c: 5, d: 400 },
      { a: 10, b: 30, c: 5, d: 490 },
    ]); // = {30,70,10,890}
    const r = computeDisproportionality(pooled);
    expect(r.cases).toBe(30);
    expect(r.prr).toBeCloseTo(27.0, 4);
    expect(r.ror).toBeCloseTo(38.142857, 4);
    expect(r.chiSqYates).toBeCloseTo(188.15, 1);
    expect(r.ic).toBeCloseTo(2.76, 2);
    expect(r.signal).toBe(true);
  });

  it("does NOT flag when cases < 3 even with huge PRR (Evans N≥3 gate)", () => {
    const r = computeDisproportionality({ a: 2, b: 8, c: 2, d: 988 });
    expect(r.prr).toBeGreaterThan(2);
    expect(r.signal).toBe(false);
  });

  it("exposes Evans thresholds and allows override", () => {
    expect(EVANS).toEqual({ minPrr: 2, minChiSq: 4, minCases: 3 });
    const r = computeDisproportionality(
      { a: 30, b: 70, c: 10, d: 890 },
      { minPrr: 100, minChiSq: 4, minCases: 3 },
    );
    expect(r.signal).toBe(false); // PRR 27 < 100
  });
});

describe("mergeDisproportionalityAggregates", () => {
  const analysis = {
    type: "disproportionality",
    level: "L1.5",
    drug: "目标药",
  } as RwsAnalysisSpec;

  function site(
    cohortSize: number,
    cells: { a: number; b: number; c: number; d: number },
  ): RwsPartyAggregate {
    return {
      analysisType: "disproportionality",
      cohortSize,
      buckets: [
        {
          key: "ALT升高",
          count: cells.a,
          rate: cells.a / cohortSize,
          b: cells.b,
          c: cells.c,
          d: cells.d,
        },
      ],
    };
  }

  it("pools 2×2 by event key then recomputes PRR/ROR/signal (does not drop b/c/d)", () => {
    const merged = mergeDisproportionalityAggregates(analysis, [
      site(465, { a: 20, b: 40, c: 5, d: 400 }),
      site(535, { a: 10, b: 30, c: 5, d: 490 }),
    ]);
    expect(merged.analysisType).toBe("disproportionality");
    expect(merged.cohortSize).toBe(1000);
    expect(merged.buckets).toHaveLength(1);
    const bucket = merged.buckets[0];
    expect(bucket.key).toBe("ALT升高");
    expect(bucket.count).toBe(30);
    expect(bucket.b).toBe(70);
    expect(bucket.c).toBe(10);
    expect(bucket.d).toBe(890);
    expect(bucket.prr).toBeCloseTo(27.0, 4);
    expect(bucket.ror).toBeCloseTo(38.142857, 4);
    expect(bucket.signal).toBe(true);
    expect(bucket.ic).toBeCloseTo(2.76, 2);
  });
});
