import { ckdEsrdRiskFlPredictionSpec } from "../compute-task/dto/fl-prediction-task-spec";
import { ORCHESTRATION_TEMPLATE_TO_KEY } from "../runtime/orchestration/orchestration.channels";
import { buildL4Plan, L4_TEMPLATE_ID } from "./plan-templates";

const input = () => ({
  purpose: "CKD→ESRD 风险预测（演示）",
  applicant: { org: "p-meddata", project: "ckd-esrd" },
  contracts: ["c1"],
  hospitals: [
    {
      participantId: "p-demohospa",
      dataProductId: "dp-insulin-panc-demohospa",
    },
    {
      participantId: "p-demohospb",
      dataProductId: "dp-insulin-panc-demohospb",
    },
  ],
  spec: {
    ...ckdEsrdRiskFlPredictionSpec(),
    modelType: "logistic_regression" as const,
    aggregation: "fedavg" as const,
  },
  notBefore: "2026-10-13T00:00:00Z",
  notAfter: "2026-11-13T00:00:00Z",
});

describe("L4 计划模板（批次 1A）", () => {
  it("每家医院 source→l4-train→declassify，平台 merge.fedavg", () => {
    const plan = buildL4Plan(input(), "hn-power");
    const ops = plan.stages.map((s) => s.op);
    expect(ops.filter((o) => o.startsWith("source.dataset"))).toHaveLength(2);
    expect(ops.filter((o) => o.startsWith("rws.l4-train"))).toHaveLength(2);
    expect(ops.filter((o) => o.startsWith("declassify"))).toHaveLength(2);
    expect(ops.filter((o) => o.startsWith("merge.fedavg"))).toHaveLength(1);
    const merge = plan.stages.find((s) => s.op.startsWith("merge.fedavg"));
    expect(merge?.inputs).toHaveLength(2);
    expect(merge?.at).toContain("platform");
  });

  it("数据源句柄按数据就近（ds://<node>/<product>）", () => {
    const plan = buildL4Plan(input(), "hn-power");
    const srcs = plan.stages.filter((s) => s.op.startsWith("source.dataset"));
    expect(srcs[0]?.inputs[0]?.from).toBe(
      "ds://p-demohospa/dp-insulin-panc-demohospa",
    );
  });

  it("只支持 logistic_regression + fedavg；缺医院/合约即拒", () => {
    expect(() =>
      buildL4Plan({
        ...input(),
        spec: { ...input().spec, modelType: "xgboost" as never },
      }),
    ).toThrow(/只支持/);
    expect(() => buildL4Plan({ ...input(), hospitals: [] })).toThrow(
      /至少需要一家医院/,
    );
    expect(() => buildL4Plan({ ...input(), contracts: [] })).toThrow(
      /至少需要一份合约/,
    );
  });

  it("模板 id 已登记进通道映射（通用入口与台账对得上）", () => {
    expect(ORCHESTRATION_TEMPLATE_TO_KEY[L4_TEMPLATE_ID]).toBe(
      "fl.l4-prediction",
    );
  });
});
