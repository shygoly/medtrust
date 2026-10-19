import { collectExternalControlRegistration } from "@medtrust/domain-med";
import { kernelCollectorRegistry } from "./operators/collector-registry";

function aggregate(over: Record<string, unknown> = {}) {
  return {
    analysisType: "external-control-registration" as const,
    synthetic: true,
    estimand: "ATT" as const,
    estimator: "IPTW-ATT" as const,
    cohort: {
      trialN: 480,
      controlPoolN: 18000,
      analysisTrialN: 460,
      analysisControlN: 17500,
    },
    effect: {
      measure: "risk-ratio" as const,
      estimate: 0.61,
      ciLow: 0.48,
      ciHigh: 0.78,
    },
    balance: [{ covariate: "age", smdBefore: 0.42, smdAfter: 0.03 }],
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
    missingness: {
      mode: "MAR" as const,
      missingFraction: 0.061,
      imputedN: 1060,
    },
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

describe("平台收集 registration 外部对照的 C3", () => {
  it("注册面能解析到注册型外部对照收集器", () => {
    expect(
      kernelCollectorRegistry.resolve("external-control-registration"),
    ).toBeDefined();
  });

  it("单一可信空间节点的聚合与诊断原样收集", () => {
    const input = aggregate();
    const out = collectExternalControlRegistration({
      tables: [{ node: "urn:tee:registration", aggregate: input as never }],
    });
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("多个节点的加权结果不可相加", () => {
    expect(() =>
      collectExternalControlRegistration({
        tables: [
          { node: "tee-1", aggregate: aggregate() as never },
          { node: "tee-2", aggregate: aggregate() as never },
        ],
      }),
    ).toThrow(/多节点结果不可相加/);
  });

  it("estimand/estimator 错配、合成答案键缺失与分析队列超界均 fail-closed", () => {
    expect(() =>
      collectExternalControlRegistration({
        tables: [
          {
            node: "tee-1",
            aggregate: {
              ...aggregate(),
              estimator: "IPTW-ATE",
            } as never,
          },
        ],
      }),
    ).toThrow(/ATT/);

    const noTruth = aggregate();
    delete (noTruth as Partial<typeof noTruth>).truthComparison;
    expect(() =>
      collectExternalControlRegistration({
        tables: [{ node: "tee-1", aggregate: noTruth as never }],
      }),
    ).toThrow(/答案键真值对照/);

    expect(() =>
      collectExternalControlRegistration({
        tables: [
          {
            node: "tee-1",
            aggregate: aggregate({
              cohort: {
                trialN: 10,
                controlPoolN: 20,
                analysisTrialN: 11,
                analysisControlN: 19,
              },
            }) as never,
          },
        ],
      }),
    ).toThrow(/超过源队列/);
  });
});
