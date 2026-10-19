import { buildC3Facts, c3ResultSchema, contradictedVerdicts } from "./c3-facts";

/**
 * C3 事实清单与结论一致性回查：**疫苗保护效果（TND）**与**跨院去重发病率**两个场景
 * （ve-tnd 5.1/5.2、dedup 6.1/6.2）。此前 `c3ResultSchema` 只认 paired-cohort /
 * disproportionality / vaccine-scri 三种，这两个场景连载荷都进不来（`buildC3Facts` 直接空数组），
 * 于是「结论行前置」与「方向矛盾即 422」对它们根本没有落点。
 */

function vePayload(over: Record<string, unknown> = {}) {
  return {
    analysisType: "vaccine-tnd",
    immuneDays: 14,
    strata: [
      // 保护性方向：VE 远大于 0 且区间不跨 1
      {
        key: "60-69|F",
        vaccPos: 3,
        vaccNeg: 400,
        unvaccPos: 30,
        unvaccNeg: 370,
        partialPos: 1,
        partialNeg: 5,
      },
      // 不可估计：未接种组无阳性
      {
        key: "70+|F",
        vaccPos: 0,
        vaccNeg: 100,
        unvaccPos: 0,
        unvaccNeg: 90,
        partialPos: 0,
        partialNeg: 0,
      },
      // 被抑制
      {
        key: "<40|M",
        vaccPos: 1,
        vaccNeg: 10,
        unvaccPos: 2,
        unvaccNeg: 9,
        partialPos: 0,
        partialNeg: 0,
        suppressed: true,
      },
    ],
    ...over,
  };
}

function dedupPayload(over: Record<string, unknown> = {}) {
  return {
    analysisType: "dedup-incidence",
    mergeAdjacent: true,
    windowed: true,
    naiveSum: {
      uniqueSubjects: 240,
      personDays: 43800,
      events: 30,
      rareCases: 4,
    },
    strata: [
      {
        key: "60-69|F",
        uniqueSubjects: 120,
        personDaysUnion: 21900,
        eventsDeduped: 14,
        rareCases: 2,
      },
      {
        key: "70+|M",
        uniqueSubjects: 100,
        personDaysUnion: 18250,
        eventsDeduped: 9,
        rareCases: 0,
        rareSuppressed: true,
      },
    ],
    ...over,
  };
}

function registrationPayload(over: Record<string, unknown> = {}) {
  return {
    analysisType: "external-control-registration",
    synthetic: true,
    estimand: "ATT",
    estimator: "IPTW-ATT",
    cohort: {
      trialN: 480,
      controlPoolN: 18000,
      analysisTrialN: 460,
      analysisControlN: 17500,
    },
    effect: {
      measure: "risk-ratio",
      estimate: 0.61,
      ciLow: 0.48,
      ciHigh: 0.78,
    },
    balance: [
      { covariate: "age", smdBefore: 0.42, smdAfter: 0.03 },
      { covariate: "severity", smdBefore: 0.55, smdAfter: 0.07 },
    ],
    overlap: {
      minPropensity: 0.02,
      maxPropensity: 0.91,
      trimmed: 12,
      eesTrial: 402.4,
      eesControl: 1190.7,
    },
    weights: {
      maxWeight: 4.8,
      p99Weight: 3.1,
      truncatedFraction: 0.013,
      effectiveSampleSize: 1593.1,
    },
    missingness: { mode: "MAR", missingFraction: 0.061, imputedN: 1060 },
    censoring: { observedN: 17920, censoredN: 1140, competingRiskN: 19 },
    sensitivity: [
      {
        id: "overlap-trimming",
        estimate: 0.64,
        ciLow: 0.51,
        ciHigh: 0.8,
        direction: "same-direction",
      },
    ],
    truthComparison: {
      rrTrue: 0.6,
      rrEstimated: 0.61,
      absoluteError: 0.01,
      withinExpectedRange: true,
    },
    study: {
      profileVersion: "registration-eca/1.0.0",
      timeZero: "treatment-start",
      estimandSapVersion: "sap-3",
    },
    ...over,
  };
}

describe("C3 事实清单：ve-tnd 与 dedup-incidence", () => {
  it("ve-tnd：载荷进得来（此前会被 400）", () => {
    expect(c3ResultSchema.safeParse(vePayload()).success).toBe(true);
    expect(c3ResultSchema.safeParse(dedupPayload()).success).toBe(true);
  });

  it("ve-tnd：事实清单给 VE 与 95% 区间、不可估计层与抑制层如实呈现", () => {
    const facts = buildC3Facts(c3ResultSchema.parse(vePayload()));
    const text = facts.join("\n");
    expect(text).toMatch(/VE = /);
    expect(text).toMatch(/95% 置信区间/);
    expect(text).toContain("VE 不可估计");
    expect(text).toContain("部分免疫单列");
    expect(text).toMatch(/被抑制、不参与解读：<40\|M/);
  });

  it("ve-tnd：结论说「无保护」而事实显示保护性方向 -> 判为矛盾", () => {
    const result = c3ResultSchema.parse(vePayload());
    expect(
      contradictedVerdicts("该疫苗对本队列无保护作用。", result),
    ).not.toHaveLength(0);
    expect(
      contradictedVerdicts(
        "接种组阳性率低于未接种组，显示保护性方向。",
        result,
      ),
    ).toHaveLength(0);
  });

  it("dedup：事实清单给去重前后对比、粗率与 Poisson 精确区间", () => {
    const facts = buildC3Facts(c3ResultSchema.parse(dedupPayload()));
    const text = facts.join("\n");
    expect(text).toMatch(/各院直接相加（未去重）合计：240 人次/);
    expect(text).toMatch(/粗发病率 .* \/ 10 万人年/);
    expect(text).toMatch(/Poisson 精确区间/);
    expect(text).toMatch(/罕见病列因更严阈值被单独抑制/);
  });

  it("dedup：草稿把「向零虚增」说成无差异 -> 判为矛盾", () => {
    const result = c3ResultSchema.parse(dedupPayload());
    expect(
      contradictedVerdicts("各院直接相加与去重后无差异。", result),
    ).not.toHaveLength(0);
    expect(
      contradictedVerdicts("各家直接相加高于去重后，存在重复计数。", result),
    ).toHaveLength(0);
  });

  it("dedup 5.3：配了标准人口权重就出直接标准化率；未配则不出", () => {
    const result = c3ResultSchema.parse(dedupPayload());
    const withW = buildC3Facts(result, {
      standardWeights: { "60-69|F": 1, "70+|M": 1 },
    }).join("\n");
    expect(withW).toMatch(/直接标准化率（标准人口权重为部署参数、不进节点）/);
    expect(withW).toMatch(/权重覆盖率 100%/);
    const without = buildC3Facts(result).join("\n");
    expect(without).not.toMatch(/直接标准化率/);
  });

  it("strict：未过闸/行级字段一律拒收（两个新场景同样适用）", () => {
    expect(
      c3ResultSchema.safeParse({ ...vePayload(), subjectKey: "lk-a" }).success,
    ).toBe(false);
    expect(
      c3ResultSchema.safeParse({ ...dedupPayload(), rawRows: [] }).success,
    ).toBe(false);
  });
});

describe("C3 事实清单：注册型外部对照", () => {
  it("完整聚合与诊断进入事实清单，且固定合成数据边界", () => {
    const result = c3ResultSchema.parse(registrationPayload());
    const text = buildC3Facts(result).join("\n");
    expect(text).toContain("SYNTHETIC");
    expect(text).toContain("ATT · IPTW-ATT");
    expect(text).toContain("time zero treatment-start");
    expect(text).toMatch(/风险比 RR 0\.61/);
    expect(text).toMatch(/加权后最大 SMD 0\.07/);
    expect(text).toMatch(/Overlap：倾向评分范围/);
    expect(text).toMatch(/缺失：机制 MAR/);
    expect(text).toMatch(/删失：观察到结局/);
    expect(text).toMatch(/敏感性分析「overlap-trimming」/);
    expect(text).toMatch(/答案键对照/);
  });

  it("合成结果不得被草稿写成真实临床或注册结论", () => {
    const result = c3ResultSchema.parse(registrationPayload());
    expect(
      contradictedVerdicts("该研究已证实临床有效，可用于注册申报。", result),
    ).not.toHaveLength(0);
    expect(
      contradictedVerdicts("合成演练中预声明模型接近注入真值。", result),
    ).toHaveLength(0);
  });

  it("残余不平衡、真值超界与行级字段都按 fail-closed 处理", () => {
    const result = c3ResultSchema.parse(
      registrationPayload({
        balance: [{ covariate: "severity", smdBefore: 0.55, smdAfter: 0.18 }],
        truthComparison: {
          rrTrue: 0.6,
          rrEstimated: 1.2,
          absoluteError: 0.6,
          withinExpectedRange: false,
        },
      }),
    );
    expect(
      contradictedVerdicts("加权后全部平衡，真值恢复通过。", result),
    ).toHaveLength(2);
    expect(
      c3ResultSchema.safeParse({
        ...registrationPayload(),
        subjectKey: "lk-should-not-egress",
      }).success,
    ).toBe(false);
  });
});
