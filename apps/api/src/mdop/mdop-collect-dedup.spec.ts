import { collectDedupIncidence } from "@medtrust/domain-med";
import { kernelCollectorRegistry } from "./operators/collector-registry";

/**
 * 平台侧**收集** `dedup-incidence`（cross-hospital-dedup-incidence tasks 10.2）。
 *
 * 缺口原状：合并阶段按投递载荷自述的 `analysisType` 找收集器，而注册面里只有
 * `paired-cohort` / `vaccine-scri` -> 去重作业的 C3 一到合并阶段就落到失衡合并器，
 * 「只接受四格表」报错，作业永远到不了 SUCCEEDED。
 */

function dedupAggregate(over: Record<string, unknown> = {}) {
  return {
    analysisType: "dedup-incidence" as const,
    mergeAdjacent: true,
    windowed: 1,
    strata: [
      {
        key: "60-69|F",
        uniqueSubjects: 120,
        personDays: 21900,
        eventsDeduped: 14,
        rareCases: 2,
      },
    ],
    ...over,
  };
}

describe("平台收集 dedup-incidence 的 C3（tasks 10.2）", () => {
  it("注册面能解析到该分析类型的收集器（缺口已补）", () => {
    expect(kernelCollectorRegistry.resolve("dedup-incidence")).toBeDefined();
  });

  it("单一产出节点：原样收集（只做形状校验）", () => {
    const agg = dedupAggregate();
    const out = collectDedupIncidence({
      tables: [{ node: "urn:tds:sh-med:participant:tee-1", aggregate: agg as never }],
    });
    expect(out).toBe(agg);
  });

  it("多个产出节点：拒绝（两份各自去重的结果相加会把同一人重复计入）", () => {
    expect(() =>
      collectDedupIncidence({
        tables: [
          { node: "tee-1", aggregate: dedupAggregate() as never },
          { node: "tee-2", aggregate: dedupAggregate() as never },
        ],
      }),
    ).toThrow(/不可相加|单一产出节点/);
  });

  it("投递了别的分析类型：拒绝（不静默当四格表处理）", () => {
    expect(() =>
      collectDedupIncidence({
        tables: [{ node: "tee-1", aggregate: { analysisType: "paired-cohort" } as never }],
      }),
    ).toThrow(/只接受 dedup-incidence/);
  });
});
