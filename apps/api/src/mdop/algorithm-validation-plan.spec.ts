import {
  buildAlgorithmValidationPlan,
  mergeAlgorithmValidation,
  type AlgorithmValidationTemplateInput,
} from "@medtrust/domain-med";
import { derSimonianLaird, PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { ALGORITHM_VALIDATION_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

const INPUT: AlgorithmValidationTemplateInput = {
  purpose: "算法校验",
  applicant: { org: "p-meddata", project: "l0" },
  contracts: ["c-1"],
  holders: [
    { participantId: "p-demohospa", dataProductId: "dp-a" },
    { participantId: "p-demohospb", dataProductId: "dp-b" },
  ],
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("算法校验（任务 3.4）", () => {
  it("每家持有方 source→seal→站内指标→declassify", () => {
    const plan = buildAlgorithmValidationPlan(INPUT, "sh-med");
    expect(plan.stages.map((stage) => stage.op)).toEqual([
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.algorithm-validation@1.0.0",
      "declassify.small_cell@1.0.0",
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.algorithm-validation@1.0.0",
      "declassify.small_cell@1.0.0",
    ]);
    const seal = plan.stages.find((stage) => stage.id === "seal_pdemohospa");
    expect(seal?.params).toMatchObject({
      projection: "score-label",
      scoreField: "score",
      labelField: "eventOccurred",
    });
  });

  it("经注册表构建同一份计划；空合约映射为 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      ALGORITHM_VALIDATION_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(buildAlgorithmValidationPlan(INPUT, currentSpaceId()).stages);
    expect(() =>
      buildPlanWithInputMapping(
        ALGORITHM_VALIDATION_TEMPLATE_ID,
        { ...INPUT, contracts: [] },
        currentSpaceId(),
      ),
    ).toThrow(BadRequestException);
  });

  it("拒：没有持有方", () => {
    expect(() => buildAlgorithmValidationPlan({ ...INPUT, holders: [] }, "sh-med")).toThrow(
      PlanInputError,
    );
  });

  it("两站 AUC 的合并与协议核 DerSimonian–Laird 同一数字", () => {
    const sites = [
      { siteId: "a", effect: 0.8, standardError: 0.05, measure: "beta" as const },
      { siteId: "b", effect: 0.7, standardError: 0.06, measure: "beta" as const },
    ];
    const merged = mergeAlgorithmValidation({
      tables: [
        {
          node: "a",
          aggregate: {
            analysisType: "algorithm-validation",
            cohortSize: 40,
            minCell: 5,
            effectEstimate: { beta: 0.8, standardError: 0.05 },
            calibration: [{ bin: 0, n: 8, events: 2, suppressed: false }],
            decisionCurve: [{ threshold: 0.1, netBenefit: 0.2, suppressed: false }],
          },
        },
        {
          node: "b",
          aggregate: {
            analysisType: "algorithm-validation",
            cohortSize: 36,
            minCell: 5,
            effectEstimate: { beta: 0.7, standardError: 0.06 },
            calibration: [{ bin: 0, n: 9, events: 3, suppressed: false }],
            decisionCurve: [{ threshold: 0.1, netBenefit: 0.1, suppressed: false }],
          },
        },
      ],
    });
    const kernel = derSimonianLaird(sites);
    expect(merged.metaPooled).toMatchObject({
      merged: true,
      pooledEffect: kernel.pooledEffect,
      pooledSe: kernel.pooledSe,
    });
  });

  it("未抑制且人数低于阈值的校准箱拒绝合并", () => {
    expect(() =>
      mergeAlgorithmValidation({
        tables: [
          {
            node: "a",
            aggregate: {
              analysisType: "algorithm-validation",
              cohortSize: 20,
              minCell: 5,
              suppressed: true,
              calibration: [{ bin: 0, n: 2, events: 1, suppressed: false }],
            },
          },
        ],
      }),
    ).toThrow(/低于阈值/);
  });
});
