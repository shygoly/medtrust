import { BadRequestException } from "@nestjs/common";
import {
  VE_TND_TEMPLATE_ID,
  buildVeTndPlan,
  type VeTndTemplateInput,
} from "./plan-templates";

const INPUT: VeTndTemplateInput = {
  purpose: "疫苗真实世界保护效果（检测阴性设计）演示研究",
  applicant: { org: "p-meddata", project: "ve-tnd" },
  contracts: ["c-cdc", "c-hospital"],
  registry: {
    participantId: "p-cdc-demo",
    dataProductId: "dp-ve-immunization-cdc",
  },
  tests: {
    participantId: "p-hospital-a",
    dataProductId: "dp-ve-tests-hospital",
  },
  teeNode: "urn:tds:sh-med:participant:tee-node-a",
  vaccineCodes: ["207", "208"],
  pathogenCodes: ["94500-6"],
  immuneDays: 14,
  minCell: 5,
  notBefore: "2026-10-04T00:00:00Z",
  notAfter: "2026-10-05T00:00:00Z",
};

describe("疫苗真实世界保护效果 TND 模板", () => {
  it("模板 id 与阶段骨架：两方 source→seal，节点内 veTnd→decTee", () => {
    expect(VE_TND_TEMPLATE_ID).toBe("rws.ve-tnd");
    const plan = buildVeTndPlan(INPUT, "sh-med");
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_pcdcdemo",
      "seal_pcdcdemo",
      "src_phospitala",
      "seal_phospitala",
      "veTnd",
      "decTee",
    ]);
  });

  it("封存阶段带投影名与编码白名单（最小投影：白名单外的疫苗/检测不出机构）", () => {
    const plan = buildVeTndPlan(INPUT, "sh-med");
    expect(
      plan.stages.find((s) => s.id === "seal_pcdcdemo")!.params,
    ).toMatchObject({
      projection: "ve-registry",
      vaccineCodes: ["207", "208"],
    });
    expect(
      plan.stages.find((s) => s.id === "seal_phospitala")!.params,
    ).toMatchObject({
      projection: "ve-tests",
      pathogenCodes: ["94500-6"],
    });
  });

  it("节点阶段按角色绑定两方，并带免疫建立期与编码口径", () => {
    const plan = buildVeTndPlan(INPUT, "sh-med");
    const stage = plan.stages.find((s) => s.id === "veTnd")!;
    expect(stage.at).toBe(INPUT.teeNode);
    expect(stage.op).toBe("rws.ve-tnd@1.0.0");
    expect(stage.params).toMatchObject({
      roles: {
        registry: "urn:tds:sh-med:participant:p-cdc-demo",
        tests: "urn:tds:sh-med:participant:p-hospital-a",
      },
      immuneDays: 14,
      vaccineCodes: ["207", "208"],
      pathogenCodes: ["94500-6"],
    });
    // 降密阶段在节点内、带 minCell 与合约
    expect(plan.stages.find((s) => s.id === "decTee")!.params).toMatchObject({
      minCell: 5,
      contractId: "c-cdc",
    });
  });

  it("免疫建立期缺省 14 天，可显式覆写", () => {
    const { immuneDays: _omitted, ...rest } = INPUT;
    const stage = (input: VeTndTemplateInput) =>
      buildVeTndPlan(input, "sh-med").stages.find((s) => s.id === "veTnd")!;
    expect(stage(rest as VeTndTemplateInput).params).toMatchObject({
      immuneDays: 14,
    });
    expect(stage({ ...INPUT, immuneDays: 21 }).params).toMatchObject({
      immuneDays: 21,
    });
  });

  it("拒：同一持有方 / 缺编码 / 非 URN 节点 / 免疫建立期非法 / 缺合约", () => {
    const bad = (patch: Partial<VeTndTemplateInput>) => () =>
      buildVeTndPlan({ ...INPUT, ...patch });
    expect(bad({ tests: INPUT.registry })).toThrow(BadRequestException);
    expect(bad({ vaccineCodes: [] })).toThrow(BadRequestException);
    expect(bad({ pathogenCodes: [] })).toThrow(BadRequestException);
    expect(bad({ teeNode: "tee-node-a" })).toThrow(BadRequestException);
    expect(bad({ immuneDays: 0 })).toThrow(BadRequestException);
    expect(bad({ immuneDays: 7.5 })).toThrow(BadRequestException);
    expect(bad({ contracts: [] })).toThrow(BadRequestException);
  });
});
