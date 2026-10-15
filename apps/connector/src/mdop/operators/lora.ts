import { Logger } from '@nestjs/common';
import type { MdopStageExecutor, StageInput } from '../mdop-executor';

/**
 * LoRA FedAvg 的院内训练算子（批次 1B，节点间安全聚合）。
 *
 * 承载分析逻辑的算子必须是 wasm（D-MDOP-5），所以这里只做**接线**：
 * 行 → LoRA 训练（复用 SecretFlow LoRA 实现）→ 输出定点权重增量 → 交给下游 secure_aggregate。
 *
 * 出域：本阶段输出 **C0**（明文留在本节点），跨院出域只发生在节点间安全聚合之后；
 * 批次 1B 使用协议 v0.3 的密文路由通道进行节点间聚合。
 */

export const LORA_OPS = {
  train: 'rws.lora-train@1.0.0',
} as const;

export interface LoraTrainingSpec {
  modelType: 'lora';
  aggregation: 'fedavg';
  baseModel?: string;
  loraRank?: number;
  learningRate?: number;
  epochs?: number;
  readonly [field: string]: unknown;
}

export interface LoraModelPayload {
  analysisType: 'lora-fedavg';
  baseModel: string;
  loraRank: number;
  /** LoRA 权重增量（定点表示，Q16.16）。 */
  deltaWeightsQ: number[];
  /** 浮点口径（= 定点 / Q），便于展示与调试；**模型本身以定点为准**。 */
  deltaWeights: number[];
  nSamples: number;
  moduleSm3: string;
}

export interface LoraTrainedModel {
  baseModel: string;
  loraRank: number;
  deltaWeightsQ: number[];
  nSamples: number;
  moduleSm3: string;
}

export interface LoraOperatorDeps {
  /** 经沙箱或 SecretFlow 运行 LoRA 训练（接线由 wire-lora 提供）。 */
  runLoraTrain: (opts: {
    rows: Record<string, unknown>[];
    spec: LoraTrainingSpec;
    stage: StageInput;
  }) => Promise<LoraTrainedModel>;
}

const LORA_Q = 65536; // Q16.16 定点表示

/**
 * 注册 LoRA 训练算子（批次 1B）。
 *
 * 与 L4 的差异：
 *   - L4：逻辑回归定点权重 → 节点内转浮点指标
 *   - LoRA：LoRA 增量定点权重 → 节点间安全聚合
 */
export function registerLoraTrainOperator(
  executor: MdopStageExecutor,
  deps: LoraOperatorDeps,
  logger: Logger = new Logger('LoraOperators'),
): void {
  executor.registerWasmOperator('rws.lora-train@', async (opRef, moduleDigest, input) => {
    const bare = (v: string) => v.replace(/^sm3:/, '').toLowerCase();
    if (!opRef.startsWith('rws.lora-train@'))
      throw new Error(`本节点没有该 wasm 算子的执行实现：${opRef}`);
    if (input.stage.op_digest && bare(input.stage.op_digest) !== bare(moduleDigest))
      throw new Error('阶段声明的模块摘要与清单不符（拒绝执行）');

    const spec = input.stage.params?.spec as LoraTrainingSpec | undefined;
    if (!spec) throw new Error('rws.lora-train 需要阶段参数 spec（训练规格）');
    if (spec.modelType !== 'lora')
      throw new Error('rws.lora-train 只支持 modelType=lora');
    if (spec.aggregation !== 'fedavg')
      throw new Error('rws.lora-train 只支持 aggregation=fedavg');

    const source = [...input.inputs.values()][0] as
      | { rows?: Record<string, unknown>[] }
      | undefined;
    if (!source?.rows?.length) throw new Error('rws.lora-train 缺上游数据集');

    const trained = await deps.runLoraTrain({
      rows: source.rows,
      spec,
      stage: input,
    });

    const payload: LoraModelPayload = {
      analysisType: 'lora-fedavg',
      baseModel: trained.baseModel,
      loraRank: trained.loraRank,
      deltaWeightsQ: trained.deltaWeightsQ,
      deltaWeights: trained.deltaWeightsQ.map((v) => v / LORA_Q),
      nSamples: trained.nSamples,
      moduleSm3: trained.moduleSm3,
    };

    logger.log(
      `rws.lora-train 完成 n=${payload.nSamples} rank=${payload.loraRank} weights=${payload.deltaWeightsQ.length} module=${trained.moduleSm3.slice(0, 16)}…`,
    );

    return {
      label: 'C0',
      schema: 'mdop.table/1.0',
      payload: {
        ...(payload as unknown as Record<string, unknown>),
        // 同节点内传递：declassify 需要训练规格，secure_aggregate 需要权重
        rows: source.rows,
        spec,
      },
    };
  });
}

/**
 * LoRA 的 declassify 算子（批次 1B）。
 *
 * 与 L4 的差异：
 *   - L4：输出 C3 参与方结果（包含指标与可选的权重）
 *   - LoRA：输出 C3 权重增量（供节点间安全聚合）
 */
export function registerLoraDeclassifyOperator(
  executor: MdopStageExecutor,
  logger: Logger = new Logger('LoraOperators'),
): void {
  executor.appendSystemHandler(
    `declassify.small_cell@1.0.0`,
    async (input) => {
      const model = [...input.inputs.values()][0] as unknown as
        | (LoraModelPayload & {
            rows?: Record<string, unknown>[];
            spec?: LoraTrainingSpec;
          })
        | undefined;

      // 只认领 LoRA 载荷，其他类型婉拒（交给 L4 或其他算子）
      if (model?.analysisType !== 'lora-fedavg') return undefined;

      if (!model.rows?.length || !model.spec)
        throw new Error('LoRA 出域缺训练行或规格（上游 lora-train 载荷不完整）');

      const contractMinCell = Number(
        (input.contractTerms as { publication?: { minCell?: number } } | undefined)
          ?.publication?.minCell ?? 0,
      );
      const paramMinCell = Number(input.stage.params?.minCell ?? 0);
      const minCell = Math.max(contractMinCell, paramMinCell);

      const n = model.rows.length;
      if (!Number.isFinite(minCell) || minCell <= 0) {
        throw new Error('declassify.small_cell 需要合约或参数给出 minCell');
      }
      if (n < minCell) {
        throw new Error(
          `队列 ${n} < minCell ${minCell}：拒绝出域（fail-closed）`,
        );
      }

      // 参与方 id 从阶段节点 URN 取
      const participantId = String(input.stage.node ?? '').split(':').pop() ?? '';

      const released = {
        taskId: input.jobId,
        participantId,
        analysisType: 'lora-fedavg',
        baseModel: model.baseModel,
        loraRank: model.loraRank,
        deltaWeightsQ: model.deltaWeightsQ,
        deltaWeights: model.deltaWeights,
        nSamples: model.nSamples,
        moduleSm3: model.moduleSm3,
      };

      logger.log(
        `declassify.small_cell(LoRA) 过门槛 minCell=${minCell} n=${released.nSamples} participantId=${participantId}`,
      );

      return {
        label: 'C3',
        schema: 'mdop.table/1.0',
        payload: released as unknown as Record<string, unknown>,
      };
    },
  );
}
