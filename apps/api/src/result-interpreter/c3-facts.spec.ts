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
      { key: "60-69|F", vaccPos: 3, vaccNeg: 400, unvaccPos: 30, unvaccNeg: 370, partialPos: 1, partialNeg: 5 },
      // 不可估计：未接种组无阳性
      { key: "70+|F", vaccPos: 0, vaccNeg: 100, unvaccPos: 0, unvaccNeg: 90, partialPos: 0, partialNeg: 0 },
      // 被抑制
      { key: "<40|M", vaccPos: 1, vaccNeg: 10, unvaccPos: 2, unvaccNeg: 9, partialPos: 0, partialNeg: 0, suppressed: true },
    ],
    ...over,
  };
}

function dedupPayload(over: Record<string, unknown> = {}) {
  return {
    analysisType: "dedup-incidence",
    mergeAdjacent: true,
    windowed: true,
    naiveSum: { uniqueSubjects: 240, personDays: 43800, events: 30, rareCases: 4 },
    strata: [
      { key: "60-69|F", uniqueSubjects: 120, personDaysUnion: 21900, eventsDeduped: 14, rareCases: 2 },
      { key: "70+|M", uniqueSubjects: 100, personDaysUnion: 18250, eventsDeduped: 9, rareCases: 0, rareSuppressed: true },
    ],
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
    expect(contradictedVerdicts("该疫苗对本队列无保护作用。", result)).not.toHaveLength(0);
    expect(
      contradictedVerdicts("接种组阳性率低于未接种组，显示保护性方向。", result),
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

  it("strict：未过闸/行级字段一律拒收（两个新场景同样适用）", () => {
    expect(
      c3ResultSchema.safeParse({ ...vePayload(), subjectKey: "lk-a" }).success,
    ).toBe(false);
    expect(
      c3ResultSchema.safeParse({ ...dedupPayload(), rawRows: [] }).success,
    ).toBe(false);
  });
});
