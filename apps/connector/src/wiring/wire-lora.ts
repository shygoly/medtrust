/**
 * 组装关注点（Nest provider）：LoRA FedAvg 批次 1B 的算子接线。
 *
 * 把 LoRA 的院内训练算子接到「SecretFlow LoRA 实现 + 节点间安全聚合」上。
 * 与 L4 的差异：
 *   - L4：wasm 定点逻辑回归 → 节点内转浮点指标
 *   - LoRA：SecretFlow LoRA 训练 → 定点权重 → 节点间安全聚合
 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import {
  registerLoraDeclassifyOperator,
  registerLoraTrainOperator,
  type LoraTrainingSpec,
} from '../mdop/operators/lora';

/**
 * LoRA 训练执行器接口（本期复用 SecretFlow LoRA 实现，批次 1B 后再评估 wasm 迁移）。
 */
export interface LoraTrainRunner {
  runLoraTrain(opts: {
    rows: Record<string, unknown>[];
    spec: LoraTrainingSpec;
  }): Promise<{
    baseModel: string;
    loraRank: number;
    deltaWeightsQ: number[];
    nSamples: number;
    moduleSm3: string;
  }>;
}

@Injectable()
export class LoraOperatorWiring implements OnModuleInit {
  private readonly logger = new Logger(LoraOperatorWiring.name);

  constructor(
    private readonly executor: MdopStageExecutor,
    @Optional() private readonly loraRunner?: LoraTrainRunner,
  ) {}

  onModuleInit(): void {
    registerLoraTrainOperator(
      this.executor,
      {
        runLoraTrain: async ({ rows, spec, stage }) => {
          if (!this.loraRunner) {
            throw new Error(
              '本节点未接入 LoRA 训练执行器（MDOP LoRA 需要它，fail-closed）',
            );
          }

          this.logger.log(
            `LoRA 训练开始 job=${stage.jobId} stage=${stage.stage.id} n=${rows.length} baseModel=${spec.baseModel ?? 'default'} rank=${spec.loraRank ?? 8}`,
          );

          const result = await this.loraRunner.runLoraTrain({ rows, spec });

          this.logger.log(
            `LoRA 训练完成 n=${result.nSamples} rank=${result.loraRank} weights=${result.deltaWeightsQ.length}`,
          );

          return result;
        },
      },
      this.logger,
    );

    // 出域环：与 L4 共用 `declassify.small_cell` 这个 op，按载荷语义分派（链式，互不覆盖）
    registerLoraDeclassifyOperator(this.executor, this.logger);

    this.logger.log(
      `LoRA 算子已注册：wasm=[${this.executor.registeredWasmOps().join(', ')}] system=[${this.executor.registeredSystemOps().join(', ')}]`,
    );
  }
}
