// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { PlanInputError } from "@medtrust/mdop";

import { buildDemandResponsePlan } from "./demand-response";

const validInput = () => ({
  purpose: "工业园区削峰填谷",
  applicant: { org: "grid-co", project: "dr-2026" },
  contracts: ["contract-dr-001"],
  participants: [
    { participantId: "plant-a", dataProductId: "dp-a" },
    { participantId: "plant-b", dataProductId: "dp-b" },
  ],
  spec: {
    targetLoad: Array.from({ length: 24 }, (_, h) => 200 + 10 * Math.sin((2 * Math.PI * h) / 24)),
    incentiveBudget: 10_000,
    timeWindow: [8, 22] as [number, number],
  },
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
});

function expectInputError(mutate: (input: Record<string, unknown>) => void, message: string) {
  const input = validInput() as Record<string, unknown>;
  mutate(input);
  expect(() => buildDemandResponsePlan(input)).toThrow(PlanInputError);
  expect(() => buildDemandResponsePlan(input)).toThrow(message);
}

describe("需求响应计划模板", () => {
  describe("入参校验", () => {
    it("参与方少于 2 方时拒绝", () => {
      expectInputError((i) => {
        i.participants = [validInput().participants[0]];
      }, "需求响应至少需要 2 方参与");
    });

    it("激励预算 ≤ 0 时拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, incentiveBudget: 0 };
      }, "激励预算必须为正数");
    });

    it("目标负荷长度 ≠ 24 时拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, targetLoad: [1, 2, 3] };
      }, "目标负荷曲线应包含 24 小时数据");
    });

    it("时间窗口无效时拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, timeWindow: [18, 8] };
      }, "调节时间窗口无效");
    });
  });

  describe("阶段链构建", () => {
    it("每个参与方生成 source → dr-potential → declassify", () => {
      const plan = buildDemandResponsePlan(validInput());
      const plantA = plan.stages.filter((s) => s.id.startsWith("plant-a."));
      expect(plantA.map((s) => s.op)).toEqual([
        "source.dataset@1.0.0",
        "power.dr-potential@1.0.0",
        "declassify.small_cell@1.0.0",
      ]);
    });

    it("平台生成 power.dr-optimize，输入为各方脱密输出", () => {
      const plan = buildDemandResponsePlan(validInput());
      const opt = plan.stages.find((s) => s.op === "power.dr-optimize@1.0.0");
      expect(opt).toBeDefined();
      expect(opt!.at).toBe("platform");
      expect(opt!.inputs).toEqual([{ from: "plant-a.declassify" }, { from: "plant-b.declassify" }]);
      expect((opt!.params as { spec: { incentiveBudget: number } }).spec.incentiveBudget).toBe(10_000);
    });
  });
});
