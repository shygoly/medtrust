import {
  buildCausalSurvivalPlan,
  mergeCausalSurvival,
  type CausalSurvivalTemplateInput,
} from "@medtrust/domain-med";
import { derSimonianLaird, PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { CAUSAL_SURVIVAL_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

const INPUT: CausalSurvivalTemplateInput = {
  purpose: "生存分析",
  applicant: { org: "p-meddata", project: "l3" },
  contracts: ["c-1"],
  holders: [
    { participantId: "p-demohospa", dataProductId: "dp-a" },
    { participantId: "p-demohospb", dataProductId: "dp-b" },
  ],
  drug: "insulin",
  comparator: "metformin",
  outcome: "acute pancreatitis",
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("因果生存（任务 3.3）", () => {
  it("每家持有方 source→seal→站内 Cox→declassify", () => {
    const plan = buildCausalSurvivalPlan(INPUT, "sh-med");
    expect(plan.stages.map((stage) => stage.op)).toEqual([
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.causal-survival@1.0.0",
      "declassify.small_cell@1.0.0",
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.causal-survival@1.0.0",
      "declassify.small_cell@1.0.0",
    ]);
    const effect = plan.stages.find((stage) => stage.id === "effect_pdemohospa");
    expect(effect?.params).toMatchObject({
      drug: "insulin",
      comparator: "metformin",
      binWidthDays: 30,
      minCell: 5,
    });
  });

  it("经注册表构建同一份计划；缺对照臂映射为 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      CAUSAL_SURVIVAL_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(buildCausalSurvivalPlan(INPUT, currentSpaceId()).stages);
    expect(() =>
      buildPlanWithInputMapping(
        CAUSAL_SURVIVAL_TEMPLATE_ID,
        { ...INPUT, comparator: "" },
        currentSpaceId(),
      ),
    ).toThrow(BadRequestException);
  });

  it("拒：两臂相同 / 箱宽小于 1", () => {
    expect(() => buildCausalSurvivalPlan({ ...INPUT, comparator: INPUT.drug }, "sh-med")).toThrow(
      PlanInputError,
    );
    expect(() => buildCausalSurvivalPlan({ ...INPUT, binWidthDays: 0 }, "sh-med")).toThrow(
      PlanInputError,
    );
  });

  it("两站 log HR 的合并与协议核 DerSimonian–Laird 同一数字", () => {
    const sites = [
      { siteId: "a", effect: -0.3, standardError: 0.1, measure: "log_hr" as const },
      { siteId: "b", effect: -0.1, standardError: 0.12, measure: "log_hr" as const },
    ];
    const curve = {
      binWidthDays: 30,
      minCell: 5,
      bins: [
        { t: 0, survival: 1, atRisk: 20 },
        { t: 180, survival: 0, atRisk: 0, suppressed: true },
      ],
    };
    const merged = mergeCausalSurvival({
      tables: sites.map((site) => ({
        node: site.siteId,
        aggregate: {
          analysisType: "causal-survival" as const,
          cohortSize: 40,
          effectEstimate: { beta: site.effect, standardError: site.standardError },
          kmCurve: curve,
        },
      })),
    });
    const direct = derSimonianLaird(sites);
    const pooled = merged.metaPooled as { pooledEffect: number; pooledSe: number; ci95: [number, number] };
    expect(pooled.pooledEffect).toBe(direct.pooledEffect);
    expect(pooled.pooledSe).toBe(direct.pooledSe);
    expect(pooled.ci95).toEqual(direct.ci95);
  });

  it("未抑制的小在险人数箱拒绝；行级字段拒绝", () => {
    expect(() =>
      mergeCausalSurvival({
        tables: [
          {
            node: "a",
            aggregate: {
              analysisType: "causal-survival",
              cohortSize: 8,
              suppressed: true,
              kmCurve: {
                binWidthDays: 30,
                minCell: 5,
                bins: [{ t: 30, survival: 0.4, atRisk: 2 }],
              },
            },
          },
        ],
      }),
    ).toThrow(/小在险人数/);
    expect(() =>
      mergeCausalSurvival({
        tables: [
          {
            node: "a",
            aggregate: {
              analysisType: "causal-survival",
              cohortSize: 8,
              suppressed: true,
              kmCurve: { binWidthDays: 30, minCell: 5, bins: [] },
              subjectKey: "sk",
            } as never,
          },
        ],
      }),
    ).toThrow(/行级/);
  });
});
