import { BadRequestException } from "@nestjs/common";
import {
  DEDUP_INCIDENCE_TEMPLATE_ID,
  buildDedupIncidencePlan,
  type DedupIncidenceTemplateInput,
} from "./plan-templates";

const INPUT: DedupIncidenceTemplateInput = {
  purpose: "跨院去重的发病率与罕见病登记演示研究",
  applicant: { org: "p-meddata", project: "dedup-incidence" },
  contracts: ["c-huashan", "c-ruijin", "c-huadong"],
  hospitals: [
    { participantId: "p-huashan", dataProductId: "dp-dedup-cohort-huashan" },
    { participantId: "p-ruijin", dataProductId: "dp-dedup-cohort-ruijin" },
    { participantId: "p-huadong", dataProductId: "dp-dedup-cohort-huadong" },
  ],
  teeNode: "urn:tds:sh-med:participant:tee-node-a",
  eventCodes: ["I21.9"],
  rareCodes: ["E76.0"],
  mergeAdjacent: true,
  minCell: 5,
  minCellRare: 10,
  notBefore: "2026-10-04T00:00:00Z",
  notAfter: "2026-10-05T00:00:00Z",
};

describe("跨院去重发病率与罕见病登记模板", () => {
  it("模板 id 与阶段骨架：每家医院 source→seal，节点内 dedup→decTee", () => {
    expect(DEDUP_INCIDENCE_TEMPLATE_ID).toBe("rws.dedup-incidence");
    const plan = buildDedupIncidencePlan(INPUT, "sh-med");
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_phuashan",
      "seal_phuashan",
      "src_pruijin",
      "seal_pruijin",
      "src_phuadong",
      "seal_phuadong",
      "dedup",
      "decTee",
    ]);
  });

  it("每家医院的封存阶段都带 dedup-cohort 投影与双编码白名单", () => {
    const plan = buildDedupIncidencePlan(INPUT, "sh-med");
    for (const id of ["seal_phuashan", "seal_pruijin", "seal_phuadong"]) {
      expect(plan.stages.find((s) => s.id === id)!.params).toMatchObject({
        projection: "dedup-cohort",
        eventCodes: ["I21.9"],
        rareCodes: ["E76.0"],
        mergeAdjacent: true,
      });
    }
  });

  it("节点阶段列出全部参与方角色，降密阶段带双阈值", () => {
    const plan = buildDedupIncidencePlan(INPUT, "sh-med");
    const stage = plan.stages.find((s) => s.id === "dedup")!;
    expect(stage.op).toBe("rws.dedup-incidence@1.0.0");
    expect(stage.at).toBe(INPUT.teeNode);
    expect(stage.params).toMatchObject({
      roles: {
        cohorts: [
          "urn:tds:sh-med:participant:p-huashan",
          "urn:tds:sh-med:participant:p-ruijin",
          "urn:tds:sh-med:participant:p-huadong",
        ],
      },
      eventCodes: ["I21.9"],
      rareCodes: ["E76.0"],
    });
    expect(plan.stages.find((s) => s.id === "decTee")!.params).toMatchObject({
      minCell: 5,
      minCellRare: 10,
      contractId: "c-huashan",
    });
  });

  it("双阈值缺省为 5 / 10", () => {
    const { minCell: _a, minCellRare: _b, ...rest } = INPUT;
    const plan = buildDedupIncidencePlan(
      rest as DedupIncidenceTemplateInput,
      "sh-med",
    );
    expect(plan.stages.find((s) => s.id === "decTee")!.params).toMatchObject({
      minCell: 5,
      minCellRare: 10,
    });
  });

  it("拒：只有一家医院 / 参与方重复 / 罕见病阈值小于常规 / 缺编码 / 非 URN 节点 / 缺合约", () => {
    const bad = (patch: Partial<DedupIncidenceTemplateInput>) => () =>
      buildDedupIncidencePlan({ ...INPUT, ...patch });
    expect(bad({ hospitals: [INPUT.hospitals[0]] })).toThrow(
      BadRequestException,
    );
    expect(
      bad({ hospitals: [INPUT.hospitals[0], INPUT.hospitals[0]] }),
    ).toThrow(BadRequestException);
    expect(bad({ minCellRare: 3 })).toThrow(BadRequestException);
    expect(bad({ eventCodes: [] })).toThrow(BadRequestException);
    expect(bad({ rareCodes: [] })).toThrow(BadRequestException);
    expect(bad({ teeNode: "tee-node-a" })).toThrow(BadRequestException);
    expect(bad({ contracts: [] })).toThrow(BadRequestException);
    expect(bad({ minCell: 0 })).toThrow(BadRequestException);
  });
});
