import { BadRequestException } from "@nestjs/common";
import { buildVaccineScriPlan, type VaccineScriTemplateInput } from "./plan-templates";
import { collectVaccineScri } from "./operators/collect-vaccine-scri";
import { buildC3Facts, contradictedVerdicts, scriRelativeIncidence } from "../result-interpreter/c3-facts";

const INPUT: VaccineScriTemplateInput = {
  purpose: "疫苗接种后不良反应主动监测演示研究",
  applicant: { org: "p-meddata", project: "aefi" },
  contracts: ["c-cdc", "c-ruijin"],
  registry: { participantId: "p-cdc-demo", dataProductId: "dp-aefi-immunization-cdc" },
  events: { participantId: "p-ruijin", dataProductId: "dp-aefi-events-ruijin" },
  teeNode: "urn:tds:sh-med:participant:tee-node-a",
  vaccineCodes: ["207", "208"],
  eventCodes: ["I40.9", "I30.9"],
  riskWindow: [1, 7],
  controlWindow: [-42, -22],
  minCell: 5,
  notBefore: "2026-10-03T00:00:00Z",
  notAfter: "2026-10-04T00:00:00Z",
};

describe("疫苗接种后不良事件 SCRI 模板", () => {
  it("两方各 source→seal，节点内 scri→decTee；封存阶段带投影名与编码过滤；节点阶段按角色绑定", () => {
    const plan = buildVaccineScriPlan(INPUT, "sh-med");
    expect(plan.stages.map((s) => s.id)).toEqual([
      "src_pcdcdemo",
      "seal_pcdcdemo",
      "src_pruijin",
      "seal_pruijin",
      "scri",
      "decTee",
    ]);
    const sealCdc = plan.stages.find((s) => s.id === "seal_pcdcdemo")!;
    expect(sealCdc.params).toMatchObject({ projection: "scri-registry", vaccineCodes: ["207", "208"] });
    const sealHosp = plan.stages.find((s) => s.id === "seal_pruijin")!;
    expect(sealHosp.params).toMatchObject({ projection: "scri-events", eventCodes: ["I40.9", "I30.9"] });
    const scri = plan.stages.find((s) => s.id === "scri")!;
    expect(scri.at).toBe(INPUT.teeNode);
    expect(scri.params).toMatchObject({
      roles: {
        registry: "urn:tds:sh-med:participant:p-cdc-demo",
        events: "urn:tds:sh-med:participant:p-ruijin",
      },
      riskWindow: [1, 7],
      controlWindow: [-42, -22],
    });
  });

  it("拒：窗口重叠 / 同一持有方 / 缺编码 / 缺可信空间节点", () => {
    const bad = (patch: Partial<VaccineScriTemplateInput>) => () => buildVaccineScriPlan({ ...INPUT, ...patch });
    expect(bad({ controlWindow: [5, 20] })).toThrow(BadRequestException);
    expect(bad({ events: INPUT.registry })).toThrow(BadRequestException);
    expect(bad({ vaccineCodes: [] })).toThrow(BadRequestException);
    expect(bad({ teeNode: "tee-node-a" })).toThrow(BadRequestException);
  });
});

describe("SCRI 收集与解读", () => {
  const aggregate = {
    analysisType: "vaccine-scri" as const,
    windows: { risk: [1, 7] as [number, number], control: [-42, -22] as [number, number] },
    strata: [
      { key: "<40|M", doses: 1737, riskEvents: 43, controlEvents: 29 },
      { key: "40+|F", doses: 0, riskEvents: 0, controlEvents: 0, suppressed: true },
    ],
  };

  it("单节点原样收集；形状不对即拒", () => {
    expect(collectVaccineScri({ tables: [{ node: "n", aggregate }] }).strata).toHaveLength(2);
    expect(() =>
      collectVaccineScri({ tables: [{ node: "n", aggregate: { ...aggregate, strata: [{ key: "x", doses: -1 }] } as never }] }),
    ).toThrow(/形状非法/);
  });

  it("相对发生率与 Clopper-Pearson 区间（43 vs 29，7 天 vs 21 天）", () => {
    const ri = scriRelativeIncidence({ riskEvents: 43, controlEvents: 29, riskDays: 7, controlDays: 21 })!;
    expect(ri.ri).toBeCloseTo(4.448, 2);
    expect(ri.lower).toBeGreaterThan(2.6);
    expect(ri.lower).toBeLessThan(2.8);
    expect(ri.upper).toBeGreaterThan(7.2);
    expect(ri.upper).toBeLessThan(7.6);
    expect(scriRelativeIncidence({ riskEvents: 3, controlEvents: 0, riskDays: 7, controlDays: 21 })).toBeNull();
  });

  it("事实清单：给出方向判断，被抑制分层单列", () => {
    const facts = buildC3Facts(aggregate as never).join("\n");
    expect(facts).toContain("40 岁以下男性");
    expect(facts).toContain("相对发生率 4.45");
    expect(facts).toContain("风险期发生率高于对照期");
    expect(facts).toContain("被抑制、不参与解读：40 岁及以上女性");
  });

  // 真跑 job-murps5q9-09483c50 的发布结果（Synthea 合成人群 + 注入信号）
  const published = {
    analysisType: "vaccine-scri" as const,
    windows: { risk: [1, 7] as [number, number], control: [-42, -22] as [number, number] },
    strata: [
      { key: "<40|F", doses: 1795, riskEvents: 9, controlEvents: 35 },
      { key: "<40|M", doses: 1737, riskEvents: 43, controlEvents: 29 },
      { key: "40+|F", doses: 2286, riskEvents: 9, controlEvents: 28 },
      { key: "40+|M", doses: 2168, riskEvents: 9, controlEvents: 35 },
    ],
  };

  it("结论行在明细之前、确定性归纳好（模型只转述）", () => {
    const facts = buildC3Facts(published as never);
    expect(facts[2]).toBe(
      "结论：4 个分层中，「40 岁以下男性」风险期发生率高于对照期（相对发生率 4.45（95% CI 2.71–7.39））；其余 3 个分层无统计学差异",
    );
  });

  it("结论回查：数字都对但把显著分层说成不显著的草稿被拒", () => {
    // LLMA qwen3-1.7b 在只有逐层明细时的实际输出
    const wrong =
      "40 岁以下女性和男性的风险期发生率分别为 0.77 和 4.45，但均未达到统计学显著性。40 岁及以上人群的风险期发生率也未明显升高。";
    expect(contradictedVerdicts(wrong, published as never)).toHaveLength(2);
    const right =
      "40 岁以下男性接种后第 1–7 天的风险期发生率高于对照期（相对发生率 4.45），其余 3 个分层无统计学差异；此为粗结果，需进一步研究确认。";
    expect(contradictedVerdicts(right, published as never)).toEqual([]);
  });
});
