import {
  buildComparativeEffectPlan,
  mergeComparativeEffects,
  type ComparativeEffectTemplateInput,
} from "@medtrust/domain-med";
import { derSimonianLaird, PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { COMPARATIVE_EFFECT_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

const INPUT: ComparativeEffectTemplateInput = {
  purpose: "比较效果",
  applicant: { org: "p-meddata", project: "l2" },
  contracts: ["c-1"],
  holders: [
    { participantId: "p-demohospa", dataProductId: "dp-a" },
    { participantId: "p-demohospb", dataProductId: "dp-b" },
  ],
  drug: "注射用紫杉醇",
  outcome: "ALT升高",
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("比较效果（任务 3.1）", () => {
  it("每家持有方 source→seal→站内效应量→declassify", () => {
    const plan = buildComparativeEffectPlan(INPUT, "sh-med");
    expect(plan.stages.map((stage) => stage.op)).toEqual([
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.comparative-effect@1.0.0",
      "declassify.small_cell@1.0.0",
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.comparative-effect@1.0.0",
      "declassify.small_cell@1.0.0",
    ]);
    const seal = plan.stages.find((stage) => stage.id === "seal_pdemohospa");
    expect(seal?.params).toMatchObject({ projection: "comparative-effect" });
    const effect = plan.stages.find(
      (stage) => stage.id === "effect_pdemohospa",
    );
    expect(effect?.params).toMatchObject({
      drug: "注射用紫杉醇",
      outcome: "ALT升高",
      outcomeKind: "adverse_event",
      stratifyBy: ["ageBand"],
      minCell: 5,
    });
  });

  it("经注册表构建同一份计划；缺 drug 映射为 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      COMPARATIVE_EFFECT_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(
      buildComparativeEffectPlan(INPUT, currentSpaceId()).stages,
    );
    expect(() =>
      buildPlanWithInputMapping(
        COMPARATIVE_EFFECT_TEMPLATE_ID,
        { ...INPUT, drug: "" },
        currentSpaceId(),
      ),
    ).toThrow(BadRequestException);
  });

  it("拒：无持有方 / 重复持有方 / 无合约 / 无结局", () => {
    expect(() =>
      buildComparativeEffectPlan({ ...INPUT, holders: [] }, "sh-med"),
    ).toThrow(PlanInputError);
    expect(() =>
      buildComparativeEffectPlan(
        { ...INPUT, holders: [INPUT.holders![0], INPUT.holders![0]] },
        "sh-med",
      ),
    ).toThrow(PlanInputError);
    expect(() =>
      buildComparativeEffectPlan({ ...INPUT, contracts: [] }, "sh-med"),
    ).toThrow(PlanInputError);
    expect(() =>
      buildComparativeEffectPlan({ ...INPUT, outcome: "" }, "sh-med"),
    ).toThrow(PlanInputError);
  });

  it("两站效应量的合并与协议核 DerSimonian–Laird 同一数字", () => {
    const sites = [
      {
        siteId: "a",
        effect: 0.4,
        standardError: 0.2,
        measure: "log_or" as const,
      },
      {
        siteId: "b",
        effect: 0.1,
        standardError: 0.25,
        measure: "log_or" as const,
      },
    ];
    const merged = mergeComparativeEffects({
      tables: sites.map((site) => ({
        node: site.siteId,
        aggregate: {
          analysisType: "comparative-effect" as const,
          cohortSize: 40,
          outcome: "ALT升高",
          effectEstimate: {
            beta: site.effect,
            standardError: site.standardError,
          },
        },
      })),
    });
    const direct = derSimonianLaird(sites);
    const pooled = merged.metaPooled as {
      pooledEffect: number;
      pooledSe: number;
      ci95: [number, number];
      heterogeneity: { q: number; i2Percent: number };
    };
    expect(pooled.pooledEffect).toBe(direct.pooledEffect);
    expect(pooled.pooledSe).toBe(direct.pooledSe);
    expect(pooled.ci95).toEqual(direct.ci95);
    expect(pooled.heterogeneity.q).toBe(direct.heterogeneity.q);
    expect(pooled.heterogeneity.i2Percent).toBe(direct.heterogeneity.i2Percent);
  });

  it("单站不伪装成已合并；行级字段拒绝", () => {
    const single = mergeComparativeEffects({
      tables: [
        {
          node: "a",
          aggregate: {
            analysisType: "comparative-effect",
            cohortSize: 10,
            effectEstimate: { beta: 0.2, standardError: 0.1 },
          },
        },
      ],
    });
    expect(single.metaPooled).toMatchObject({
      merged: false,
      code: "single_site",
    });
    expect(() =>
      mergeComparativeEffects({
        tables: [
          {
            node: "a",
            aggregate: {
              analysisType: "comparative-effect",
              cohortSize: 1,
              effectEstimate: { beta: 0.2, standardError: 0.1 },
              subjectKey: "sk",
            } as never,
          },
        ],
      }),
    ).toThrow(/行级/);
  });

  it("被抑制的站不进入合并；未抑制的小分层拒绝合并", () => {
    const merged = mergeComparativeEffects({
      tables: [
        {
          node: "a",
          aggregate: {
            analysisType: "comparative-effect",
            cohortSize: 0,
            minCell: 5,
            suppressed: true,
            buckets: [{ key: "50-59", count: 0, n: 0, suppressed: true }],
          },
        },
      ],
    });
    expect(merged.metaPooled).toMatchObject({
      merged: false,
      code: "suppressed",
    });
    expect(() =>
      mergeComparativeEffects({
        tables: [
          {
            node: "a",
            aggregate: {
              analysisType: "comparative-effect",
              cohortSize: 3,
              minCell: 5,
              buckets: [
                {
                  key: "50-59",
                  count: 1,
                  n: 3,
                  b: 1,
                  c: 0,
                  d: 1,
                  suppressed: false,
                },
              ],
              effectEstimate: { beta: 0.2, standardError: 0.1 },
            },
          },
        ],
      }),
    ).toThrow(/低于阈值/);
  });
});
