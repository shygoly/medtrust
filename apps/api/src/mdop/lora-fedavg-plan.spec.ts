import { buildLoraFedAvgPlan } from "@medtrust/domain-med";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { ORCHESTRATION_TEMPLATE_TO_KEY } from "../runtime/orchestration/orchestration.channels";
import { LORA_FEDAVG_TEMPLATE_ID } from "./plan-templates";

const input = () => ({
  purpose: "LoRA FedAvg 节点间安全聚合（演示）",
  applicant: { org: "p-meddata", project: "lora-demo" },
  contracts: ["c1"],
  hospitals: [
    {
      participantId: "p-demohospa",
      dataProductId: "dp-lora-demohospa",
    },
    {
      participantId: "p-demohospb",
      dataProductId: "dp-lora-demohospb",
    },
  ],
  spec: {
    modelType: "lora",
    aggregation: "fedavg" as const,
    baseModel: "llama-7b",
    loraRank: 8,
  },
  notBefore: "2026-10-15T00:00:00Z",
  notAfter: "2026-11-15T00:00:00Z",
});

describe("LoRA FedAvg 计划模板（批次 1B，节点间安全聚合）", () => {
  it("构建包含 secure_aggregate 与 merge.fedavg-secure 的计划", () => {
    const plan = buildLoraFedAvgPlan(input(), currentSpaceId());
    expect(plan.stages).toHaveLength(9); // 2 院 × (src + train + dec) + 2 院 × agg + 1 merge
    expect(plan.purpose).toBe(input().purpose);
    expect(plan.applicant).toEqual(input().applicant);
    expect(plan.contracts).toEqual(input().contracts);
  });

  it("每家医院有数据源 → LoRA 训练 → 小单元脱密", () => {
    const plan = buildLoraFedAvgPlan(input(), currentSpaceId());
    const srcs = plan.stages.filter((s) => s.op.startsWith("source.dataset"));
    expect(srcs).toHaveLength(2);
    expect(srcs[0]?.inputs[0]?.from).toBe("ds://p-demohospa/dp-lora-demohospa");

    const trains = plan.stages.filter((s) => s.op.startsWith("rws.lora-train"));
    expect(trains).toHaveLength(2);
    expect(trains[0]?.params).toMatchObject({ spec: input().spec });

    const decs = plan.stages.filter((s) =>
      s.op.startsWith("declassify.small_cell"),
    );
    expect(decs).toHaveLength(2);
  });

  it("节点间安全聚合：各院本地解密并聚合", () => {
    const plan = buildLoraFedAvgPlan(input(), currentSpaceId());
    const aggs = plan.stages.filter((s) => s.op.startsWith("secure_aggregate"));
    expect(aggs).toHaveLength(2);

    // 每个聚合阶段吃所有院的脱密输出
    expect(aggs[0]?.inputs).toHaveLength(2);
    expect(aggs[0]?.params).toMatchObject({
      aggregation: "fedavg",
      spec: input().spec,
    });

    // 各院在本地运行聚合
    expect(aggs[0]?.at).toContain("p-demohospa");
    expect(aggs[1]?.at).toContain("p-demohospb");
  });

  it("平台合并使用 merge.fedavg-secure 吃各院聚合后的 C3", () => {
    const plan = buildLoraFedAvgPlan(input(), currentSpaceId());
    const merge = plan.stages.find((s) =>
      s.op.startsWith("merge.fedavg-secure"),
    );
    expect(merge).toBeDefined();
    expect(merge?.inputs).toHaveLength(2); // 2 院聚合结果
    expect(merge?.at).toContain("platform");
  });

  it("只支持 fedavg 聚合；少于 2 家医院即拒", () => {
    expect(() =>
      buildLoraFedAvgPlan(
        {
          ...input(),
          spec: { ...input().spec, aggregation: "secureboost" as never },
        },
        currentSpaceId(),
      ),
    ).toThrow(/只支持 fedavg/);

    expect(() =>
      buildLoraFedAvgPlan(
        { ...input(), hospitals: [input().hospitals[0]!] },
        currentSpaceId(),
      ),
    ).toThrow(/至少需要两家医院/);

    expect(() =>
      buildLoraFedAvgPlan({ ...input(), contracts: [] }, currentSpaceId()),
    ).toThrow(/至少需要一份合约/);
  });

  it("模板 id 已登记进通道映射（通用入口与台账对得上）", () => {
    expect(ORCHESTRATION_TEMPLATE_TO_KEY[LORA_FEDAVG_TEMPLATE_ID]).toBe(
      "fl.lora-fedavg",
    );
  });
});
