// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { PlanInputError } from "@medtrust/mdop";

import { buildLoadForecastPlan } from "./load-forecast";

const validInput = () => ({
  purpose: "区域负荷预测",
  applicant: { org: "grid-co", project: "load-2026" },
  contracts: ["contract-001"],
  participants: [
    { participantId: "grid", dataProductId: "dp-grid", role: "grid" },
    { participantId: "weather", dataProductId: "dp-weather", role: "weather" },
  ],
  spec: { forecastHorizon: 24, features: ["mean", "std"], model: "lstm" },
  notBefore: "2026-10-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
});

function expectInputError(mutate: (input: Record<string, unknown>) => void, message: string) {
  const input = validInput() as Record<string, unknown>;
  mutate(input);
  expect(() => buildLoadForecastPlan(input)).toThrow(PlanInputError);
  expect(() => buildLoadForecastPlan(input)).toThrow(message);
}

describe("负荷预测计划模板", () => {
  describe("入参校验", () => {
    it("拒绝非对象入参", () => {
      expect(() => buildLoadForecastPlan(null)).toThrow(PlanInputError);
    });

    it("参与方少于 2 方时拒绝", () => {
      expectInputError((i) => {
        i.participants = [validInput().participants[0]];
      }, "负荷预测至少需要 2 方参与");
    });

    it("合约列表为空时拒绝", () => {
      expectInputError((i) => {
        i.contracts = [];
      }, "至少需要一份合约");
    });

    it("预测时长越界时拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, forecastHorizon: 0 };
      }, "预测时长应在 1-168 小时之间");
      expectInputError((i) => {
        i.spec = { ...validInput().spec, forecastHorizon: 169 };
      }, "预测时长应在 1-168 小时之间");
    });

    it("特征列表为空时拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, features: [] };
      }, "至少需要一个特征");
    });

    it("模型类型无效时拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, model: "gru" };
      }, "只支持 lstm 模型");
    });

    it("transformer 尚未实现，明确拒绝", () => {
      expectInputError((i) => {
        i.spec = { ...validInput().spec, model: "transformer" };
      }, "Transformer 模型尚未实现");
    });

    it("参与方角色非法时拒绝", () => {
      expectInputError((i) => {
        i.participants = [
          { participantId: "a", dataProductId: "dp-a", role: "solar" },
          { participantId: "b", dataProductId: "dp-b", role: "grid" },
        ];
      }, "参与方需包含 participantId、dataProductId 与合法 role");
    });
  });

  describe("阶段链构建", () => {
    it("每个参与方生成 source → feature-extraction → declassify 三阶段", () => {
      const plan = buildLoadForecastPlan(validInput());
      const grid = plan.stages.filter((s) => s.at === "grid" && !s.id.endsWith(".aggregate"));
      expect(grid.map((s) => s.op)).toEqual([
        "source.dataset@1.0.0",
        "power.feature-extraction@1.0.0",
        "declassify.small_cell@1.0.0",
      ]);
      expect(grid[1]!.inputs).toEqual([{ from: grid[0]!.id }]);
      expect(grid[2]!.inputs).toEqual([{ from: grid[1]!.id }]);
    });

    it("每个参与方生成一个 fedavg 安全聚合阶段，输入为所有方的脱密输出", () => {
      const plan = buildLoadForecastPlan(validInput());
      const aggregates = plan.stages.filter((s) => s.op === "secure_aggregate@1.0.0");
      expect(aggregates).toHaveLength(2);
      for (const agg of aggregates) {
        expect(agg.params).toEqual({ aggregation: "fedavg" });
        expect(agg.inputs.map((i) => i.from)).toEqual([
          "grid.declassify",
          "weather.declassify",
        ]);
      }
    });

    it("平台合并阶段透传 spec 并依赖全部聚合结果", () => {
      const plan = buildLoadForecastPlan(validInput());
      const merge = plan.stages.find((s) => s.op === "power.load-forecast-merge@1.0.0");
      expect(merge).toBeDefined();
      expect(merge!.at).toBe("platform");
      expect(merge!.params).toEqual({
        spec: { forecastHorizon: 24, features: ["mean", "std"], model: "lstm" },
      });
      expect(merge!.inputs.map((i) => i.from)).toEqual([
        "grid.aggregate",
        "weather.aggregate",
      ]);
    });

    it("不修改入参（特征数组做了拷贝）", () => {
      const input = validInput();
      const plan = buildLoadForecastPlan(input);
      const merge = plan.stages.find((s) => s.op === "power.load-forecast-merge@1.0.0")!;
      (merge.params.spec as { features: string[] }).features.push("extra");
      expect(input.spec.features).toEqual(["mean", "std"]);
    });

    it("透传有效期与可选伦理引用", () => {
      const plan = buildLoadForecastPlan({ ...validInput(), ethicsRef: "ETH-7" });
      expect(plan.not_before).toBe("2026-10-01T00:00:00Z");
      expect(plan.not_after).toBe("2026-12-31T00:00:00Z");
      expect(plan.ethics_ref).toBe("ETH-7");
    });
  });
});
