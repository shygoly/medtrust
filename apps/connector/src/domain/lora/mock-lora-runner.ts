/**
 * LoRA 训练执行器的占位实现（批次 1B）。
 *
 * 本期先提供确定性占位实现以支持端到端测试；批次 1C 再桥接到真实的 SecretFlow LoRA 实现。
 * 占位实现返回固定的 LoRA 权重增量，便于验证节点间安全聚合的正确性。
 */
import { Injectable, Logger } from '@nestjs/common';
// 本文件在 src/domain/lora/ 下：相对路径要退两级才到 src/。
// 原先只写了一级，是文件从 src/domain/lora-runner.ts 挪进子目录时漏改的，
// 结果连接器 `nest build` 一直编译不过（jest 逐文件加载没暴露出来）。
import type { LoraTrainRunner } from '../../wiring/wire-lora';
import type { LoraTrainingSpec } from '../../mdop/operators/lora';

const LORA_Q = 65536; // Q16.16 定点表示

@Injectable()
export class MockLoraTrainRunner implements LoraTrainRunner {
  private readonly logger = new Logger(MockLoraTrainRunner.name);

  async runLoraTrain(opts: {
    rows: Record<string, unknown>[];
    spec: LoraTrainingSpec;
  }): Promise<{
    baseModel: string;
    loraRank: number;
    deltaWeightsQ: number[];
    nSamples: number;
    moduleSm3: string;
  }> {
    const { rows, spec } = opts;
    const baseModel = spec.baseModel ?? 'llama-7b';
    const loraRank = spec.loraRank ?? 8;
    const nSamples = rows.length;

    this.logger.log(
      `MockLoraTrainRunner: 占位训练 n=${nSamples} baseModel=${baseModel} rank=${loraRank}`,
    );

    // 占位实现：返回确定性的权重增量（基于样本数和 rank）
    // 实际值 = [0.1, 0.2, -0.05, 0.15, ...] × nSamples / 100
    const scale = nSamples / 100;
    const baseWeights = [0.1, 0.2, -0.05, 0.15, 0.3, -0.1, 0.25, 0.12];
    const deltaWeights = baseWeights.slice(0, loraRank).map((w) => w * scale);
    const deltaWeightsQ = deltaWeights.map((w) => Math.round(w * LORA_Q));

    // 占位模块摘要：基于 baseModel + rank + nSamples 生成确定性哈希
    const moduleSm3 = `mock-lora-${baseModel}-r${loraRank}-n${nSamples}`;

    this.logger.log(
      `MockLoraTrainRunner: 完成 weights=${deltaWeightsQ.length} module=${moduleSm3}`,
    );

    return {
      baseModel,
      loraRank,
      deltaWeightsQ,
      nSamples,
      moduleSm3,
    };
  }
}
