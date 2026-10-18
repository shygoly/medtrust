import {
  buildConditionPrevalencePlan,
  mergeCategoricalCounts,
  NO_CONDITION_LABEL,
  type ConditionPrevalenceTemplateInput,
} from "@medtrust/domain-med";
import { PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { CONDITION_PREVALENCE_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

/**
 * 批次 2：慢病标签现患（平台侧合并组第三型）。
 *
 * 与旧链的两处口径在这里钉住：一行多标签各计一次；无标签的行以占位分类计入（不是丢弃）。
 */

const INPUT: ConditionPrevalenceTemplateInput = {
  purpose: "慢病标签现患统计",
  applicant: { org: "p-meddata", project: "prev" },
  contracts: ["c-1"],
  holders: [
    { participantId: "p-demohospa", dataProductId: "dp-prev-demohospa" },
  ],
  categoryKeys: ["糖尿病", "高血压"],
  minCell: 5,
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("慢病标签现患（批次 2）", () => {
  it("阶段链：source→seal(list-categories)→categorical-count→declassify；占位分类自动进列表", () => {
    const plan = buildConditionPrevalencePlan(INPUT, "sh-med");
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_pdemohospa",
      "seal_pdemohospa",
      "count_pdemohospa",
      "dec_pdemohospa",
    ]);
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    expect(byId.seal_pdemohospa.params).toMatchObject({
      projection: "list-categories",
      listField: "conditions",
      emptyPlaceholder: NO_CONDITION_LABEL,
    });
    expect(byId.count_pdemohospa.op.endsWith("categorical-count@1.0.0")).toBe(
      true,
    );
    // 占位分类必须也在闭合列表里，否则无标签的行会在节点侧被拒
    expect(byId.count_pdemohospa.params).toMatchObject({
      categoryKeys: ["糖尿病", "高血压", NO_CONDITION_LABEL],
    });
  });

  it("countUnlabeled=false：不加占位、也不生成占位文案", () => {
    const plan = buildConditionPrevalencePlan(
      { ...INPUT, countUnlabeled: false },
      "sh-med",
    );
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    expect(byId.seal_pdemohospa.params).toMatchObject({ emptyPlaceholder: "" });
    expect(
      (byId.count_pdemohospa.params as { categoryKeys: string[] }).categoryKeys,
    ).toEqual(["糖尿病", "高血压"]);
  });

  it("经注册表（端点同一条路）：同一份计划；非法入参 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      CONDITION_PREVALENCE_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(
      buildConditionPrevalencePlan(INPUT, currentSpaceId()).stages,
    );
    expect(() =>
      buildPlanWithInputMapping(
        CONDITION_PREVALENCE_TEMPLATE_ID,
        {},
        currentSpaceId(),
      ),
    ).toThrow(BadRequestException);
  });

  it("拒：无持有方 / 无合约（categoryKeys 缺省走包侧默认词典，不再拒）", () => {
    expect(() =>
      buildConditionPrevalencePlan({ ...INPUT, holders: [] }, "sh-med"),
    ).toThrow(PlanInputError);
    expect(() =>
      buildConditionPrevalencePlan({ ...INPUT, contracts: [] }, "sh-med"),
    ).toThrow(PlanInputError);
  });

  it("省缺 categoryKeys：用包侧默认慢病标签词典（占位仍自动补）", () => {
    const plan = buildConditionPrevalencePlan(
      { ...INPUT, categoryKeys: undefined } as never,
      "sh-med",
    );
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    const keys = (byId.count_pdemohospa.params as { categoryKeys: string[] })
      .categoryKeys;
    expect(keys).toContain("高血压");
    expect(keys).toContain(NO_CONDITION_LABEL);
  });

  it("收集器（三型共用）：多院按分类键相加；别类型拒", () => {
    const merged = mergeCategoricalCounts({
      tables: [
        {
          node: "tee-1",
          aggregate: {
            analysisType: "categorical-count",
            rowCount: 4,
            recordCount: 4,
            buckets: [
              { key: "糖尿病", count: 3 },
              { key: NO_CONDITION_LABEL, count: 1 },
            ],
          } as never,
        },
        {
          node: "tee-2",
          aggregate: {
            analysisType: "categorical-count",
            rowCount: 2,
            recordCount: 2,
            buckets: [{ key: "糖尿病", count: 2 }],
          } as never,
        },
      ],
    });
    expect(merged.rowCount).toBe(6);
    // 分母同步汇总（差异 B 闭合）：两院记录数相加
    expect(merged.recordCount).toBe(6);
    expect(merged.buckets).toEqual([
      { key: "糖尿病", count: 5 },
      { key: NO_CONDITION_LABEL, count: 1 },
    ]);
  });
});
