/**
 * LoRA FedAvg 安全聚合的平台合并器（批次 1B）。
 *
 * 与 L4 的差异：
 *   - L4：各院上传浮点指标 → 平台按样本量加权平均
 *   - LoRA：各院本地解密并聚合密文 → 平台收各院聚合后的 C3（一致性验证）
 *
 * 协议 v0.3 节点间安全聚合：各院收到所有方的密文贡献，本地解密并聚合；
 * 平台收到 N 份聚合结果（N = 参与医院数），验证一致性后取任一份作为最终结果。
 */

export interface LoraSecureAggregateResult {
  analysisType: 'lora-fedavg-secure';
  participantId: string;
  baseModel: string;
  loraRank: number;
  /** 聚合后的 LoRA 权重增量（定点表示，Q16.16）。 */
  aggregatedWeightsQ: number[];
  /** 浮点口径（= 定点 / Q），便于展示与调试。 */
  aggregatedWeights: number[];
  /** 参与方总样本量。 */
  totalSamples: number;
  nParties: number;
}

export interface LoraFedAvgSecureMergeInput {
  spec?: unknown;
  parties: Array<{
    node: string;
    result: LoraSecureAggregateResult;
  }>;
}

/**
 * 合并 LoRA 节点间安全聚合结果（批次 1B）。
 *
 * 各院本地解密并聚合后，理论上应该得到相同的结果；平台验证一致性，取任一份作为最终输出。
 */
export function mergeLoraFedAvgSecure(
  input: LoraFedAvgSecureMergeInput,
): LoraSecureAggregateResult {
  if (!input.parties.length) {
    throw new Error('LoRA 安全聚合合并：没有收到任何参与方结果');
  }

  // 验证所有方的分析类型一致
  const analysisTypes = new Set(
    input.parties.map((p) => p.result.analysisType),
  );
  if (analysisTypes.size > 1 || ![...analysisTypes][0]?.includes('lora-fedavg')) {
    throw new Error(
      `LoRA 安全聚合合并：分析类型不一致或不是 lora-fedavg-secure（收到：${[...analysisTypes].join(', ')}）`,
    );
  }

  const first = input.parties[0]!.result;
  const baseModel = first.baseModel;
  const loraRank = first.loraRank;
  const weightsLength = first.aggregatedWeightsQ.length;

  // 验证所有方的基础模型、LoRA rank、权重维度一致
  for (const party of input.parties) {
    const r = party.result;
    if (r.baseModel !== baseModel) {
      throw new Error(
        `LoRA 安全聚合合并：baseModel 不一致（${r.baseModel} vs ${baseModel}）`,
      );
    }
    if (r.loraRank !== loraRank) {
      throw new Error(
        `LoRA 安全聚合合并：loraRank 不一致（${r.loraRank} vs ${loraRank}）`,
      );
    }
    if (r.aggregatedWeightsQ.length !== weightsLength) {
      throw new Error(
        `LoRA 安全聚合合并：权重维度不一致（${r.aggregatedWeightsQ.length} vs ${weightsLength}）`,
      );
    }
  }

  // 验证权重一致性：所有方的聚合结果应该相同（协议 v0.3 保证）
  const EPSILON = 1; // 定点表示的容差（±1 个 LSB）
  for (let i = 0; i < weightsLength; i++) {
    const values = input.parties.map((p) => p.result.aggregatedWeightsQ[i]!);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min > EPSILON) {
      throw new Error(
        `LoRA 安全聚合合并：权重[${i}]不一致（范围 [${min}, ${max}]，超出容差 ${EPSILON}）`,
      );
    }
  }

  // 验证样本量一致性
  const totalSamples = first.totalSamples;
  for (const party of input.parties) {
    if (party.result.totalSamples !== totalSamples) {
      throw new Error(
        `LoRA 安全聚合合并：totalSamples 不一致（${party.result.totalSamples} vs ${totalSamples}）`,
      );
    }
  }

  // 一致性验证通过，取第一方的结果作为最终输出
  return {
    analysisType: 'lora-fedavg-secure',
    participantId: 'platform',
    baseModel,
    loraRank,
    aggregatedWeightsQ: first.aggregatedWeightsQ,
    aggregatedWeights: first.aggregatedWeights,
    totalSamples,
    nParties: input.parties.length,
  };
}
