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
  spec: { forecastHorizon: 24, features: ["mean", "std"], model: "baseline" },
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
      }, "只支持 baseline 模型");
    });

    it("未实现的模型（lstm / transformer）显式拒绝，不用基线冒充", () => {
      for (const model of ["lstm", "transformer"]) {
        expectInputError((i) => {
          i.spec = { ...validInput().spec, model };
        }, `预测模型 ${model} 尚未实现`);
      }
    });

    it("已实现的 baseline 通过校验，且计划里记的就是它", () => {
      const plan = buildLoadForecastPlan({
        ...validInput(),
        spec: { ...validInput().spec, model: "baseline" },
      });
      const merge = plan.stages.find((s) => s.at === "platform")!;
      expect((merge.params as { spec: { model: string } }).spec.model).toBe("baseline");
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
      const grid = plan.stages.filter((s) => s.id.startsWith("grid."));
      expect(grid.map((s) => s.op)).toEqual([
        "source.dataset@1.0.0",
        "power.feature-extraction@1.0.0",
        "declassify.small_cell@1.0.0",
      ]);
      // 数据源句柄进输入：编译器据此把阶段钉在数据所在节点
      expect(grid[0]!.inputs).toEqual([{ from: "ds://grid/dp-grid" }]);
      expect(grid[0]!.params.uri).toBe("ds://grid/dp-grid");
      expect(grid[1]!.inputs).toEqual([{ from: grid[0]!.id }]);
      expect(grid[2]!.inputs).toEqual([{ from: grid[1]!.id }]);
      expect(grid[2]!.params).toEqual({ contractId: "contract-001" });
    });

    it("不经 secure_aggregate（节点级 C3 已是聚合量，重复上传会被重复计数）", () => {
      const plan = buildLoadForecastPlan(validInput());
      expect(plan.stages.some((s) => s.op.startsWith("secure_aggregate@"))).toBe(false);
    });

    it("出域参数透传到降密阶段", () => {
      const plan = buildLoadForecastPlan({ ...validInput(), release: { minCell: 10, dpEpsilon: 0.5 } });
      const dec = plan.stages.find((s) => s.id === "grid.declassify")!;
      expect(dec.params).toEqual({ contractId: "contract-001", minCell: 10, dpEpsilon: 0.5 });
    });

    it("平台合并阶段透传 spec 并依赖全部降密输出", () => {
      const plan = buildLoadForecastPlan(validInput());
      const merge = plan.stages.find((s) => s.op === "power.load-forecast-merge@1.0.0");
      expect(merge).toBeDefined();
      expect(merge!.at).toBe("platform");
      expect(merge!.params).toEqual({
        spec: { forecastHorizon: 24, features: ["mean", "std"], model: "baseline" },
      });
      expect(merge!.inputs.map((i) => i.from)).toEqual([
        "grid.declassify",
        "weather.declassify",
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
