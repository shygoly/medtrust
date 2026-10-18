import { collectExternalControl } from "@medtrust/domain-med";
import { kernelCollectorRegistry } from "./operators/collector-registry";

function aggregate(over: Record<string, unknown> = {}) {
  return {
    analysisType: "external-control" as const,
    caliperDays: 30,
    ratioK: 2,
    strata: [
      {
        key: "18-39|M",
        mExpPos: 25,
        mExpNeg: 105,
        ctlPos: 101,
        ctlNeg: 159,
        matched: 130,
        unmatched: 0,
      },
    ],
    ...over,
  };
}

describe("平台收集 external-control 的 C3", () => {
  it("注册面能解析到外部对照收集器", () => {
    expect(kernelCollectorRegistry.resolve("external-control")).toBeDefined();
  });

  it("单一可信空间节点的结果原样收集", () => {
    const input = aggregate();
    const out = collectExternalControl({
      tables: [
        {
          node: "urn:tds:sh-med:participant:tee-node-a",
          aggregate: input as never,
        },
      ],
    });
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("多个产出节点的结果不可相加", () => {
    expect(() =>
      collectExternalControl({
        tables: [
          { node: "tee-1", aggregate: aggregate() as never },
          { node: "tee-2", aggregate: aggregate() as never },
        ],
      }),
    ).toThrow(/单一可信空间节点/);
  });

  it("错误分析类型或非法分层一律拒绝", () => {
    expect(() =>
      collectExternalControl({
        tables: [
          {
            node: "tee-1",
            aggregate: {
              ...aggregate(),
              analysisType: "paired-cohort",
            } as never,
          },
        ],
      }),
    ).toThrow(/只接受 external-control/);
    expect(() =>
      collectExternalControl({
        tables: [
          {
            node: "tee-1",
            aggregate: { ...aggregate(), strata: [{ key: "x" }] } as never,
          },
        ],
      }),
    ).toThrow(/形状非法/);
  });
});
