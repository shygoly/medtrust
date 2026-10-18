import {
  mergeLoraFedAvgSecure,
  type LoraSecureAggregateResult,
} from "./merge-lora-secure";

describe("mergeLoraFedAvgSecure（批次 1B，节点间安全聚合）", () => {
  const mockResult = (
    participantId: string,
    weightsQ: number[],
    totalSamples: number,
  ): LoraSecureAggregateResult => ({
    analysisType: "lora-fedavg-secure",
    participantId,
    baseModel: "llama-7b",
    loraRank: 8,
    aggregatedWeightsQ: weightsQ,
    aggregatedWeights: weightsQ.map((v) => v / 65536),
    totalSamples,
    nParties: 2,
  });

  it("验证所有方权重一致性后取第一方结果", () => {
    const weightsQ = [100000, 200000, -50000];
    const merged = mergeLoraFedAvgSecure({
      parties: [
        { node: "hospa", result: mockResult("hospa", weightsQ, 500) },
        { node: "hospb", result: mockResult("hospb", weightsQ, 500) },
      ],
    });

    expect(merged.analysisType).toBe("lora-fedavg-secure");
    expect(merged.participantId).toBe("platform");
    expect(merged.baseModel).toBe("llama-7b");
    expect(merged.loraRank).toBe(8);
    expect(merged.aggregatedWeightsQ).toEqual(weightsQ);
    expect(merged.totalSamples).toBe(500);
    expect(merged.nParties).toBe(2);
  });

  it("容忍 ±1 个 LSB 的定点误差", () => {
    const weightsQ1 = [100000, 200000, -50000];
    const weightsQ2 = [100001, 200000, -50001]; // ±1 LSB
    const merged = mergeLoraFedAvgSecure({
      parties: [
        { node: "hospa", result: mockResult("hospa", weightsQ1, 500) },
        { node: "hospb", result: mockResult("hospb", weightsQ2, 500) },
      ],
    });

    expect(merged.aggregatedWeightsQ).toEqual(weightsQ1);
  });

  it("拒绝权重不一致（超出容差）", () => {
    const weightsQ1 = [100000, 200000, -50000];
    const weightsQ2 = [100010, 200000, -50000]; // 超出 ±1 LSB
    expect(() =>
      mergeLoraFedAvgSecure({
        parties: [
          { node: "hospa", result: mockResult("hospa", weightsQ1, 500) },
          { node: "hospb", result: mockResult("hospb", weightsQ2, 500) },
        ],
      }),
    ).toThrow(/权重\[0\]不一致/);
  });

  it("拒绝 baseModel 不一致", () => {
    const weightsQ = [100000, 200000];
    const r1 = mockResult("hospa", weightsQ, 500);
    const r2 = {
      ...mockResult("hospb", weightsQ, 500),
      baseModel: "llama-13b",
    };
    expect(() =>
      mergeLoraFedAvgSecure({
        parties: [
          { node: "hospa", result: r1 },
          { node: "hospb", result: r2 },
        ],
      }),
    ).toThrow(/baseModel 不一致/);
  });

  it("拒绝 loraRank 不一致", () => {
    const weightsQ = [100000, 200000];
    const r1 = mockResult("hospa", weightsQ, 500);
    const r2 = { ...mockResult("hospb", weightsQ, 500), loraRank: 16 };
    expect(() =>
      mergeLoraFedAvgSecure({
        parties: [
          { node: "hospa", result: r1 },
          { node: "hospb", result: r2 },
        ],
      }),
    ).toThrow(/loraRank 不一致/);
  });

  it("拒绝权重维度不一致", () => {
    const weightsQ1 = [100000, 200000];
    const weightsQ2 = [100000, 200000, 300000];
    expect(() =>
      mergeLoraFedAvgSecure({
        parties: [
          { node: "hospa", result: mockResult("hospa", weightsQ1, 500) },
          { node: "hospb", result: mockResult("hospb", weightsQ2, 500) },
        ],
      }),
    ).toThrow(/权重维度不一致/);
  });

  it("拒绝 totalSamples 不一致", () => {
    const weightsQ = [100000, 200000];
    expect(() =>
      mergeLoraFedAvgSecure({
        parties: [
          { node: "hospa", result: mockResult("hospa", weightsQ, 500) },
          { node: "hospb", result: mockResult("hospb", weightsQ, 600) },
        ],
      }),
    ).toThrow(/totalSamples 不一致/);
  });

  it("拒绝空投递列表", () => {
    expect(() => mergeLoraFedAvgSecure({ parties: [] })).toThrow(
      /没有收到任何参与方结果/,
    );
  });

  it("拒绝分析类型不一致", () => {
    const weightsQ = [100000, 200000];
    const r1 = mockResult("hospa", weightsQ, 500);
    const r2 = {
      ...mockResult("hospb", weightsQ, 500),
      analysisType: "other-type" as never,
    };
    expect(() =>
      mergeLoraFedAvgSecure({
        parties: [
          { node: "hospa", result: r1 },
          { node: "hospb", result: r2 },
        ],
      }),
    ).toThrow(/分析类型不一致/);
  });
});
