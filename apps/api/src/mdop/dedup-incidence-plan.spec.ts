import { BadRequestException } from "@nestjs/common";
import {
  DEDUP_INCIDENCE_TEMPLATE_ID,
  buildDedupIncidencePlan,
  type DedupIncidenceTemplateInput,
} from "./plan-templates";

const INPUT: DedupIncidenceTemplateInput = {
  purpose: "跨院去重的发病率与罕见病登记演示研究",
  applicant: { org: "p-meddata", project: "dedup-incidence" },
  contracts: ["c-demohospa", "c-demohospb", "c-huadong"],
  hospitals: [
    { participantId: "p-demohospa", dataProductId: "dp-dedup-cohort-demohospa" },
    { participantId: "p-demohospb", dataProductId: "dp-dedup-cohort-demohospb" },
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
      "src_pdemohospa",
      "seal_pdemohospa",
      "src_pdemohospb",
      "seal_pdemohospb",
      "src_phuadong",
      "seal_phuadong",
      "dedup",
      "decTee",
    ]);
  });

  it("每家医院的封存阶段都带 dedup-cohort 投影与双编码白名单", () => {
    const plan = buildDedupIncidencePlan(INPUT, "sh-med");
    for (const id of ["seal_pdemohospa", "seal_pdemohospb", "seal_phuadong"]) {
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
          "urn:tds:sh-med:participant:p-demohospa",
          "urn:tds:sh-med:participant:p-demohospb",
          "urn:tds:sh-med:participant:p-huadong",
        ],
      },
      eventCodes: ["I21.9"],
      rareCodes: ["E76.0"],
    });
    expect(plan.stages.find((s) => s.id === "decTee")!.params).toMatchObject({
      minCell: 5,
      minCellRare: 10,
      contractId: "c-demohospa",
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

  it("编码白名单 fail-closed：空 / 非数组 / 夹着非字符串或空串 → 400（两份白名单各自判）", () => {
    const bad = (patch: Record<string, unknown>) => () =>
      buildDedupIncidencePlan({
        ...INPUT,
        ...patch,
      } as DedupIncidenceTemplateInput);
    for (const invalid of [
      [],
      undefined,
      null,
      "I21.9",
      [""],
      ["I21.9", 7],
      [null],
    ]) {
      expect(bad({ eventCodes: invalid })).toThrow(BadRequestException);
      expect(bad({ rareCodes: invalid })).toThrow(BadRequestException);
    }
  });

  it("strataKeys：不合语法 / 重复 / 超过 64 个 / 不是数组 → 400；合规的原样写进节点阶段", () => {
    const withKeys = (strataKeys: unknown) => () =>
      buildDedupIncidencePlan(
        { ...INPUT, strataKeys } as DedupIncidenceTemplateInput,
        "sh-med",
      );
    expect(
      withKeys(["18-39|F", "40-64|M", "65+|F"])().stages.find(
        (s) => s.id === "dedup",
      )!.params,
    ).toMatchObject({ strataKeys: ["18-39|F", "40-64|M", "65+|F"] });
    expect(withKeys(["65+|F", "家住某某路 3 号|F"])).toThrow(
      BadRequestException,
    );
    expect(withKeys(["65+|F", "65+|F"])).toThrow(BadRequestException);
    expect(withKeys(Array.from({ length: 65 }, (_, i) => `${i}+|F`))).toThrow(
      BadRequestException,
    );
    expect(withKeys("65+|F")).toThrow(BadRequestException);
  });
});
