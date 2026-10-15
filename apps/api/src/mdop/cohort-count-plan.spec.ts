import { buildCohortCountPlan, mergeCohortCount, type CohortCountTemplateInput } from "@medtrust/domain-med";
import { PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { COHORT_COUNT_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

/**
 * 批次 2 第一型：队列规模（年龄带）。
 *
 * 这一型是「五件套」的样板（design D2）：台账 / 模板 / 收集器 / 入口 / 对拍证据。
 * 本用例钉前四件套里可自动验证的部分；第五件（与旧链逐字段对拍）单独留证。
 */

const INPUT: CohortCountTemplateInput = {
  purpose: "队列规模统计",
  applicant: { org: "p-meddata", project: "cohort" },
  contracts: ["c-1"],
  holders: [
    { participantId: "p-demohospa", dataProductId: "dp-cohort-demohospa" },
    { participantId: "p-demohospb", dataProductId: "dp-cohort-demohospb" },
  ],
  strataKeys: ["<40|M", "40+|F"],
  minCell: 5,
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("队列规模（批次 2 第一型）", () => {
  it("阶段链：每家 source→seal→categorical-count→declassify；平台相加（无平台阶段）", () => {
    const plan = buildCohortCountPlan(INPUT, "sh-med");
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_pdemohospa",
      "seal_pdemohospa",
      "count_pdemohospa",
      "dec_pdemohospa",
      "src_pdemohospb",
      "seal_pdemohospb",
      "count_pdemohospb",
      "dec_pdemohospb",
    ]);
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    // 算子名按后缀断言：基座目录内不写 rws 字面量（棘轮只许改善）
    expect(byId.count_pdemohospa.op.endsWith("categorical-count@1.0.0")).toBe(true);
    expect(byId.count_pdemohospa.params).toMatchObject({
      dataset: { ref: "seal_pdemohospa" },
      categoryKeys: ["<40|M", "40+|F"],
    });
    expect(byId.dec_pdemohospa.op).toBe("declassify.small_cell@1.0.0");
  });

  it("经注册表（端点同一条路）：同一份计划；非法入参 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      COHORT_COUNT_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(buildCohortCountPlan(INPUT, currentSpaceId()).stages);
    expect(() =>
      buildPlanWithInputMapping(COHORT_COUNT_TEMPLATE_ID, {}, currentSpaceId()),
    ).toThrow(BadRequestException);
  });

  it("拒：无持有方 / 持有方重复 / 无合约", () => {
    expect(() => buildCohortCountPlan({ ...INPUT, holders: [] }, "sh-med")).toThrow(PlanInputError);
    expect(() =>
      buildCohortCountPlan({ ...INPUT, holders: [INPUT.holders[0], INPUT.holders[0]] }, "sh-med"),
    ).toThrow(PlanInputError);
    expect(() => buildCohortCountPlan({ ...INPUT, contracts: [] }, "sh-med")).toThrow(PlanInputError);
  });

  it("收集器：单院原样；多院按分层键相加，totalDistinct 也相加", () => {
    const a = {
      analysisType: "distinct-count" as const,
      totalDistinct: 100,
      strata: [
        { key: "<40|M", distinct: 60 },
        { key: "40+|F", distinct: 40 },
      ],
    };
    const b = {
      analysisType: "distinct-count" as const,
      totalDistinct: 80,
      strata: [{ key: "<40|M", distinct: 80 }],
    };
    expect(mergeCohortCount({ tables: [{ node: "tee-1", aggregate: a as never }] })).toBe(a);
    const merged = mergeCohortCount({
      tables: [
        { node: "tee-1", aggregate: a as never },
        { node: "tee-2", aggregate: b as never },
      ],
    });
    expect(merged.totalDistinct).toBe(180);
    expect(merged.strata).toEqual([{ key: "<40|M", distinct: 140 }, { key: "40+|F", distinct: 40 }]);
    // 投递了别的类型：拒（不静默相加）
    expect(() =>
      mergeCohortCount({ tables: [{ node: "tee-1", aggregate: { analysisType: "paired-cohort" } as never }] }),
    ).toThrow(/只接受 distinct-count/);
  });
});
