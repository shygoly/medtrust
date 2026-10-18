import { collectVeTnd } from "@medtrust/domain-med";
import { kernelCollectorRegistry } from "./operators/collector-registry";

/**
 * 平台侧**收集** `vaccine-tnd`（疫苗真实世界保护效果，tasks 9.2）。
 *
 * 缺口原状：节点交回的 C3 自称 `vaccine-tnd`，而注册面只有 `paired-cohort` / `vaccine-scri`
 * -> 落到失衡合并器报「只接受四格表」，作业永远到不了 SUCCEEDED。
 *
 * 命名口径：**C3 载荷**自称 `vaccine-tnd`；清单/算子/schema 用 `ve-tnd`（9.2 明写，补收集方时对齐载荷侧）。
 */

function veAggregate(over: Record<string, unknown> = {}) {
  return {
    analysisType: "vaccine-tnd" as const,
    immuneDays: 14,
    strata: [
      {
        key: "60-69|F",
        vaccPos: 3,
        vaccNeg: 400,
        unvaccPos: 30,
        unvaccNeg: 370,
        partialPos: 1,
        partialNeg: 5,
      },
    ],
    ...over,
  };
}

describe("平台收集 vaccine-tnd 的 C3（tasks 9.2）", () => {
  it("注册面能解析到该分析类型的收集器（缺口已补）", () => {
    expect(kernelCollectorRegistry.resolve("vaccine-tnd")).toBeDefined();
  });

  it("单一产出节点：原样收集（只做形状校验）", () => {
    const agg = veAggregate();
    const out = collectVeTnd({
      tables: [
        { node: "urn:tds:sh-med:participant:tee-1", aggregate: agg as never },
      ],
    });
    expect(out).toBe(agg);
  });

  it("多个产出节点：拒绝（分母不是同一套人群，结果不可相加）", () => {
    expect(() =>
      collectVeTnd({
        tables: [
          { node: "tee-1", aggregate: veAggregate() as never },
          { node: "tee-2", aggregate: veAggregate() as never },
        ],
      }),
    ).toThrow(/不可相加|单一产出节点/);
  });

  it("投递了别的分析类型：拒绝（不静默当四格表处理）", () => {
    expect(() =>
      collectVeTnd({
        tables: [
          {
            node: "tee-1",
            aggregate: { analysisType: "paired-cohort" } as never,
          },
        ],
      }),
    ).toThrow(/只接受 vaccine-tnd/);
  });
});
