import {
  buildAeSignalPlan,
  mergeCategoricalCounts,
  type AeSignalTemplateInput,
} from "@medtrust/domain-med";
import { PlanInputError } from "@medtrust/mdop";
import { BadRequestException } from "@nestjs/common";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { AE_SIGNAL_TEMPLATE_ID } from "../runtime/orchestration/orchestration.channels";
import { buildPlanWithInputMapping } from "./template-registry";

/**
 * 批次 2：不良事件信号（平台侧合并组第二型）。
 *
 * 口径按 design D6：数**出现次数**（一行一起事件），分类键由模板给全；
 * 域词（字段名/器官系统）留在行业包，基座只按 eventField 参数取 —— 这一条也在这里钉住。
 */

const INPUT: AeSignalTemplateInput = {
  purpose: "不良事件信号监测",
  applicant: { org: "p-meddata", project: "ae" },
  contracts: ["c-1"],
  holders: [{ participantId: "p-demohospa", dataProductId: "dp-ae-demohospa" }],
  categoryKeys: ["Nervous", "Cardiac"],
  minCell: 5,
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-10-02T00:00:00Z",
};

describe("不良事件信号（批次 2）", () => {
  it("阶段链：source→seal(ae-signal + eventField)→categorical-count→declassify", () => {
    const plan = buildAeSignalPlan(INPUT, "sh-med");
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_pdemohospa",
      "seal_pdemohospa",
      "count_pdemohospa",
      "dec_pdemohospa",
    ]);
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    // 基座按名字取字段：域词在包侧
    expect(byId.seal_pdemohospa.params).toMatchObject({
      projection: "ae-signal",
      eventField: "adverseEvents",
      contractId: "c-1",
    });
    expect(byId.count_pdemohospa.op.endsWith("categorical-count@1.0.0")).toBe(true);
    expect(byId.count_pdemohospa.params).toMatchObject({
      dataset: { ref: "seal_pdemohospa" },
      categoryKeys: ["Nervous", "Cardiac"],
    });
  });

  it("经注册表（端点同一条路）：同一份计划；非法入参 400", () => {
    const viaRegistry = buildPlanWithInputMapping(
      AE_SIGNAL_TEMPLATE_ID,
      INPUT,
      currentSpaceId(),
    );
    expect(viaRegistry.stages).toEqual(buildAeSignalPlan(INPUT, currentSpaceId()).stages);
    expect(() =>
      buildPlanWithInputMapping(AE_SIGNAL_TEMPLATE_ID, {}, currentSpaceId()),
    ).toThrow(BadRequestException);
  });

  it("拒：无持有方 / 持有方重复 / 无合约（categoryKeys 缺省走包侧默认词典，不再拒）", () => {
    expect(() => buildAeSignalPlan({ ...INPUT, holders: [] }, "sh-med")).toThrow(PlanInputError);
    expect(() =>
      buildAeSignalPlan(
        { ...INPUT, holders: [INPUT.holders[0], INPUT.holders[0]] },
        "sh-med",
      ),
    ).toThrow(PlanInputError);
    expect(() => buildAeSignalPlan({ ...INPUT, contracts: [] }, "sh-med")).toThrow(PlanInputError);
  });

  it("省缺 categoryKeys：用包侧默认器官系统词典；hospitals 与 holders 同义", () => {
    const plan = buildAeSignalPlan({
      ...INPUT,
      categoryKeys: undefined,
      holders: undefined,
      hospitals: [{ participantId: "p-demohospa", dataProductId: "dp-1" }],
    } as never, "sh-med");
    const byId = Object.fromEntries(plan.stages.map((s) => [s.id, s]));
    const keys = (byId.count_pdemohospa.params as { categoryKeys: string[] }).categoryKeys;
    expect(keys).toContain("肝胆系统");
  });

  it("收集器：单院原样；多院按分类键相加（出现次数口径，同一人两起事件就是两起）", () => {
    const a = {
      analysisType: "categorical-count" as const,
      rowCount: 3,
      buckets: [
        { key: "Nervous", count: 2 },
        { key: "Cardiac", count: 1 },
      ],
    };
    const b = {
      analysisType: "categorical-count" as const,
      rowCount: 2,
      buckets: [{ key: "Nervous", count: 2 }],
    };
    expect(mergeCategoricalCounts({ tables: [{ node: "tee-1", aggregate: a as never }] })).toBe(a);
    const merged = mergeCategoricalCounts({
      tables: [
        { node: "tee-1", aggregate: a as never },
        { node: "tee-2", aggregate: b as never },
      ],
    });
    expect(merged.rowCount).toBe(5);
    expect(merged.buckets).toEqual([
      { key: "Nervous", count: 4 },
      { key: "Cardiac", count: 1 },
    ]);
    expect(() =>
      mergeCategoricalCounts({ tables: [{ node: "tee-1", aggregate: { analysisType: "paired-cohort" } as never }] }),
    ).toThrow(/只接受 categorical-count/);
  });
});
