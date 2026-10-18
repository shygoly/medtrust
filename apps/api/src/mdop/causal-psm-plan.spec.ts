import {
  buildCausalPsmPlan,
  mergeCausalPsm,
  type CausalPsmTemplateInput,
} from "@medtrust/domain-med";
import { derSimonianLaird, PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { CAUSAL_PSM_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

const INPUT: CausalPsmTemplateInput = {
  purpose: "倾向评分",
  applicant: { org: "p-meddata", project: "l3" },
  contracts: ["c-1"],
  holders: [
    { participantId: "p-demohospa", dataProductId: "dp-a" },
    { participantId: "p-demohospb", dataProductId: "dp-b" },
  ],
  drug: "insulin",
  comparator: "metformin",
  outcome: "acute pancreatitis",
  matchingStrategy: "within-stratum",
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("因果 PSM（任务 3.2）", () => {
  it("每家持有方 source→seal→站内效应量→declassify", () => {
    const plan = buildCausalPsmPlan(INPUT, "sh-med");
    expect(plan.stages.map((stage) => stage.op)).toEqual([
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.causal-psm@1.0.0",
      "declassify.small_cell@1.0.0",
      "source.dataset@1.0.0",
      "seal.envelope@1.0.0",
      "rws.causal-psm@1.0.0",
      "declassify.small_cell@1.0.0",
    ]);
    const seal = plan.stages.find((stage) => stage.id === "seal_pdemohospa");
    expect(seal?.params).toMatchObject({ projection: "causal-psm" });
    const effect = plan.stages.find(
      (stage) => stage.id === "effect_pdemohospa",
    );
    expect(effect?.params).toMatchObject({
      drug: "insulin",
      comparator: "metformin",
      outcome: "acute pancreatitis",
      method: "psm",
      stratifyBy: ["ageBand", "sex"],
      minCell: 5,
    });
  });

  it("经注册表构建同一份计划；缺对照臂映射为 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      CAUSAL_PSM_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(
      buildCausalPsmPlan(INPUT, currentSpaceId()).stages,
    );
    expect(() =>
      buildPlanWithInputMapping(
        CAUSAL_PSM_TEMPLATE_ID,
        { ...INPUT, comparator: "" },
        currentSpaceId(),
      ),
    ).toThrow(BadRequestException);
  });

  it("拒：无持有方 / 两臂相同 / 无结局", () => {
    expect(() =>
      buildCausalPsmPlan({ ...INPUT, holders: [] }, "sh-med"),
    ).toThrow(PlanInputError);
    expect(() =>
      buildCausalPsmPlan({ ...INPUT, comparator: INPUT.drug }, "sh-med"),
    ).toThrow(PlanInputError);
    expect(() =>
      buildCausalPsmPlan({ ...INPUT, outcome: "" }, "sh-med"),
    ).toThrow(PlanInputError);
  });

  it("拒：缺 matchingStrategy（D-RWS-10 必填，不接受缺省）", () => {
    const { matchingStrategy: _drop, ...noStrategy } = INPUT;
    void _drop;
    expect(() =>
      buildCausalPsmPlan(noStrategy as typeof INPUT, "sh-med"),
    ).toThrow(/matchingStrategy/);
  });

  it("拒：cross-stratum-nearest 经 MDOP 入口提交（只接受 within-stratum，不静默忽略）", () => {
    expect(() =>
      buildCausalPsmPlan(
        { ...INPUT, matchingStrategy: "cross-stratum-nearest" },
        "sh-med",
      ),
    ).toThrow(PlanInputError);
    // 经注册表映射为 HTTP 400，文案须同时点出声明值与通道实际口径（design D2 接缝）。
    let caught: unknown;
    try {
      buildPlanWithInputMapping(
        CAUSAL_PSM_TEMPLATE_ID,
        { ...INPUT, matchingStrategy: "cross-stratum-nearest" },
        currentSpaceId(),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as Error).message).toMatch(/cross-stratum-nearest/);
    expect((caught as Error).message).toMatch(/within-stratum/);
  });

  it("两站效应量的合并与协议核 DerSimonian–Laird 同一数字", () => {
    const sites = [
      {
        siteId: "a",
        effect: 0.12,
        standardError: 0.04,
        measure: "ate" as const,
      },
      {
        siteId: "b",
        effect: 0.08,
        standardError: 0.05,
        measure: "ate" as const,
      },
    ];
    const merged = mergeCausalPsm({
      tables: sites.map((site) => ({
        node: site.siteId,
        aggregate: {
          analysisType: "causal-psm" as const,
          cohortSize: 80,
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

  it("单站不伪装成已合并；被抑制的站不把 0 送进合并；行级字段拒绝", () => {
    const single = mergeCausalPsm({
      tables: [
        {
          node: "a",
          aggregate: {
            analysisType: "causal-psm",
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

    const suppressed = mergeCausalPsm({
      tables: [
        {
          node: "a",
          aggregate: {
            analysisType: "causal-psm",
            cohortSize: 4,
            suppressed: true,
          },
        },
        {
          node: "b",
          aggregate: {
            analysisType: "causal-psm",
            cohortSize: 40,
            effectEstimate: { beta: 0.1, standardError: 0.05 },
          },
        },
      ],
    });
    expect(suppressed.suppressedSites).toEqual(["a"]);
    expect(suppressed.metaPooled).toMatchObject({
      merged: false,
      code: "single_site",
    });

    expect(() =>
      mergeCausalPsm({
        tables: [
          {
            node: "a",
            aggregate: {
              analysisType: "causal-psm",
              cohortSize: 1,
              effectEstimate: { beta: 0.2, standardError: 0.1 },
              subjectKey: "sk",
            } as never,
          },
        ],
      }),
    ).toThrow(/行级/);
  });
});
