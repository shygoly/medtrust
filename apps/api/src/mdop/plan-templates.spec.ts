import { BadRequestException } from "@nestjs/common";
import {
  PAIRED_COHORT_TEMPLATE_ID,
  buildPairedCohortPlan,
} from "./plan-templates";
import { placeStage } from "./mdop-jobs.service";

/**
 * 首个 C2 场景的计划模板（任务 3.12c）。
 *
 * 两件事要钉住：① 模板产出的阶段链形状（各院封存 → 节点内配对 → 节点内降密）；
 * ② **节点侧阶段必须显式写 `at`** —— 不写就会被「多节点依赖」的默认规则丢给平台，
 * 而平台既不该也不能解封（这条用 `placeStage` 直接钉）。
 */

const TEE = "urn:tds:sh-med:participant:tee-1";
const PLATFORM = "urn:tds:sh-med:participant:platform";

function plan(over: Record<string, unknown> = {}) {
  return buildPairedCohortPlan({
    purpose: "RWS.EFFECTIVENESS",
    applicant: { org: "sponsor", project: "p1" },
    contracts: ["ctr-1"],
    holders: [
      { participantId: "p-demohospa", dataProductId: "dp-1" },
      { participantId: "p-demohospb", dataProductId: "dp-2" },
    ],
    teeNode: TEE,
    strata: ["60-69|F", "70-79|M"],
    minCell: 5,
    notBefore: "2026-09-24T00:00:00.000Z",
    notAfter: "2026-10-24T00:00:00.000Z",
    ...over,
  });
}

describe("跨院配对计划模板（任务 3.12c）", () => {
  it("阶段链：各院 source→seal（留在该院）→ 节点内 pair → 节点内降密", () => {
    const draft = plan();
    expect(PAIRED_COHORT_TEMPLATE_ID).toBe("rws.paired-cohort");
    expect(draft.stages.map((s) => s.id)).toEqual([
      "src_pdemohospa",
      "seal_pdemohospa",
      "src_pdemohospb",
      "seal_pdemohospb",
      "pair",
      "decTee",
    ]);
    // 封存留在持有方侧：数据源句柄让编译器把这两步钉在该院
    const sealA = draft.stages.find((s) => s.id === "seal_pdemohospa")!;
    expect(sealA.op).toBe("seal.envelope@1.0.0");
    expect(sealA.at).toBeUndefined();
    // 节点侧两步都点名可信空间节点
    const pair = draft.stages.find((s) => s.id === "pair")!;
    expect(pair.op).toBe("rws.paired-cohort@1.0.0");
    expect(pair.at).toBe(TEE);
    expect(pair.inputs.map((i) => i.from)).toEqual([
      "seal_pdemohospa",
      "seal_pdemohospb",
    ]);
    expect(pair.params).toEqual({ strata: ["60-69|F", "70-79|M"] });
    const dec = draft.stages.find((s) => s.id === "decTee")!;
    expect(dec.op).toBe("declassify.small_cell@1.0.0");
    expect(dec.at).toBe(TEE);
    expect(dec.params).toMatchObject({ minCell: 5, contractId: "ctr-1" });
  });

  it("参数护栏：少于两家持有方 / 没给可信空间节点 / 没有合约 → 直接拒", () => {
    expect(() =>
      plan({
        holders: [{ participantId: "p-demohospa", dataProductId: "dp-1" }],
      }),
    ).toThrow(BadRequestException);
    expect(() => plan({ teeNode: "tee-1" })).toThrow(/可信空间节点/);
    expect(() => plan({ contracts: [] })).toThrow(BadRequestException);
  });

  it("落点规则：显式 `at` 才落在节点；不写就会被默认丢给平台（模板为什么必须写 at）", () => {
    const upstream = new Set([
      "urn:tds:sh-med:participant:p-demohospa",
      "urn:tds:sh-med:participant:p-demohospb",
    ]);
    // 不写 at：多上游节点 → 平台合并（对 C2 来说是错的落点：平台解不开）
    expect(placeStage({ id: "pair" }, upstream, PLATFORM)).toBe(PLATFORM);
    // 写 at：落在可信空间节点，随后由编译器的 assertC2Target 判合约策略与证明登记
    expect(placeStage({ id: "pair", at: TEE }, upstream, PLATFORM)).toBe(TEE);
  });
});
