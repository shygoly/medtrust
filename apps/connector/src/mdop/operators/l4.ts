import { Logger } from '@nestjs/common';
import {
  FL_LOGISTIC_DEFAULT_EPOCHS,
  FL_LOGISTIC_DEFAULT_L2_Q,
  FL_LOGISTIC_DEFAULT_STEP_Q,
  FL_LOGISTIC_Q,
  encodeFlLogistic,
  type FlLogisticEncodedInput,
} from '@medtrust/wasm-algorithms';
import { encodeTabularRows } from '../../domain/fl-prediction/local-logistic';
import type { FlPredictionTaskSpec } from '../../domain/fl-prediction/fl-prediction-task-spec';
import type { MdopStageExecutor, StageInput } from '../mdop-executor';

/**
 * L4 联邦预测的院内**定点训练**算子（批次 1A）。
 *
 * 承载分析逻辑的算子必须是 wasm（D-MDOP-5），所以这里只做**接线**：
 * 行 → 与旧链同一编码（`encodeTabularRows`）→ 乘 Q16.16 取整 → 交给沙箱里的
 * `rws.l4-train` 模块执行（`AlgorithmSandboxExecutor.runFixedCompute`，形状 `table@1`）。
 * 训练语义一份实现（wasm），TS 参考实现留在连接器侧作对拍基准（台账 `retained.test-reference`）。
 *
 * 出域：本阶段输出 **C0**（明文留在本节点），跨院出域只发生在下游 `declassify` 之后；
 * 1A **不新增**任何"节点→平台"通道（design D1d §2）。
 */

export const L4_OPS = {
  train: 'rws.l4-train@1.0.0',
} as const;

export interface L4ModelPayload {
  analysisType: 'fl-logistic';
  featureNames: string[];
  /** Q16.16 系数（与模块输出逐字段一致）。 */
  thetaQ: number[];
  interceptQ: number;
  /** 浮点口径（= 定点 / Q），仅便于下游展示与旧链对拍；**模型本身以定点为准**。 */
  theta: number[];
  intercept: number;
  nSamples: number;
  positives: number;
  moduleSm3: string;
}

export interface L4TrainedModel {
  featureNames: string[];
  thetaQ: number[];
  interceptQ: number;
  nSamples: number;
  positives: number;
  moduleSm3: string;
}

export interface L4OperatorDeps {
  /** 经沙箱跑已登记的 wasm 模块（接线由 wire-l4 提供）。 */
  runLogistic: (opts: {
    rows: Record<string, unknown>[];
    spec: FlPredictionTaskSpec;
    stage: StageInput;
  }) => Promise<L4TrainedModel>;
}

/** 行 → 模块输入块（Q16.16 整数特征；与旧链同一特征编码）。 */
export function encodeTrainingRows(
  rows: readonly Record<string, unknown>[],
  spec: FlPredictionTaskSpec,
): { encoded: FlLogisticEncodedInput; featureNames: string[] } {
  const { X, y, featureNames } = encodeTabularRows(rows, spec);
  const XQ = X.map((row) => row.map((v) => Math.round(v * FL_LOGISTIC_Q)));
  const epochs =
    (spec.hyperparameters as { epochs?: number } | undefined)?.epochs ??
    FL_LOGISTIC_DEFAULT_EPOCHS;
  const stepQ = Math.round(
    (spec.hyperparameters?.learningRate ?? 0.5) * FL_LOGISTIC_Q,
  );
  const l2Q = Math.round(
    (spec.hyperparameters?.regularization ?? 0.01) * FL_LOGISTIC_Q,
  );
  return {
    encoded: encodeFlLogistic({ XQ, y, epochs, stepQ, l2Q }),
    featureNames,
  };
}

export function registerL4TrainOperator(
  executor: MdopStageExecutor,
  deps: L4OperatorDeps,
  logger: Logger = new Logger('L4Operators'),
): void {
  executor.registerWasmOperator('rws.l4-train@', async (opRef, moduleDigest, input) => {
    const bare = (v: string) => v.replace(/^sm3:/, '').toLowerCase();
    if (!opRef.startsWith('rws.l4-train@'))
      throw new Error(`本节点没有该 wasm 算子的执行实现：${opRef}`);
    if (input.stage.op_digest && bare(input.stage.op_digest) !== bare(moduleDigest))
      throw new Error('阶段声明的模块摘要与清单不符（拒绝执行）');
    const spec = input.stage.params?.spec as FlPredictionTaskSpec | undefined;
    if (!spec) throw new Error('rws.l4-train 需要阶段参数 spec（训练规格）');
    const source = [...input.inputs.values()][0] as
      | { rows?: Record<string, unknown>[] }
      | undefined;
    if (!source?.rows?.length) throw new Error('rws.l4-train 缺上游数据集');

    const trained = await deps.runLogistic({
      rows: source.rows,
      spec,
      stage: input,
    });
    const payload: L4ModelPayload = {
      analysisType: 'fl-logistic',
      featureNames: trained.featureNames,
      thetaQ: trained.thetaQ,
      interceptQ: trained.interceptQ,
      theta: trained.thetaQ.map((v) => v / FL_LOGISTIC_Q),
      intercept: trained.interceptQ / FL_LOGISTIC_Q,
      nSamples: trained.nSamples,
      positives: trained.positives,
      moduleSm3: trained.moduleSm3,
    };
    logger.log(
      `rws.l4-train 完成 n=${payload.nSamples} d=${payload.thetaQ.length} module=${trained.moduleSm3.slice(0, 16)}…`,
    );
    return {
      label: 'C0',
      schema: 'mdop.table/1.0',
      payload: {
        ...(payload as unknown as Record<string, unknown>),
        // 同节点内传递：出域（declassify）要用训练行算指标、用规格决定产物口径。
        // 标签仍是 C0 —— 这段数据**不出节点**（与 source 阶段携带 rows 同一模式）。
        rows: source.rows,
        spec,
      },
    };
  });
}

import { createHash } from 'node:crypto';
import { canonicalSm3 } from '@medtrust/mdop';
import { evaluateLogistic } from '../../domain/fl-prediction/local-logistic';
import { assertSafeFlPartyRunResult } from '../../domain/fl-prediction/fl-output-guard';
import type {
  FlPartyRunResult,
  FlPredictionArtifactKind,
} from '../../domain/fl-prediction/fl-run-result';

/** 合约/参数给出的出域条件（与 L1.5 的 declassify 同口径：阈值取最大）。 */
export interface L4CohortPolicy {
  minCell: number;
  allowedArtifacts: readonly FlPredictionArtifactKind[];
  contractId?: string;
}

export interface L4DeclassifyInput {
  taskId: string;
  participantId: string;
  /** 本院训练行（C0，节点内；只在本地用于算指标）。 */
  rows: Record<string, unknown>[];
  spec: FlPredictionTaskSpec;
  model: L4ModelPayload;
}

/**
 * C0 模型载荷 → **C3 参与方结果**（L4 的 declassify 语义）。
 *
 * 与旧链同一出域口径（复用同一 `encodeTabularRows`/`evaluateLogistic`/`assertSafeFlPartyRunResult`），
 * 但补上旧链**缺的一道**：队列规模门槛（`n < minCell` 一律拒绝出域，fail-closed）。
 * 产物裁剪照 `allowedArtifacts`：只有允许 `model_weights` 时才带 `modelParams`。
 * `localModelHash` 沿用旧链公式（浮点口径的 θ 派生）以便与旧链可比；数值口径差异由 change D2 说明。
 */
export function buildL4PartyResult(
  input: L4DeclassifyInput,
  policy: L4CohortPolicy,
): FlPartyRunResult & { moduleSm3: string } {
  const n = input.rows.length;
  if (!Number.isFinite(policy.minCell) || policy.minCell <= 0) {
    throw new Error('declassify.small_cell 需要合约或参数给出 minCell');
  }
  if (n < policy.minCell) {
    // 队列太小：**拒绝出域**，不释放模型、也不伪造一个"脱敏"模型
    throw new Error(
      `队列 ${n} < minCell ${policy.minCell}：拒绝出域（fail-closed，不伪造）`,
    );
  }
  const theta = input.model.theta;
  const intercept = input.model.intercept;
  const { X, y } = encodeTabularRows(input.rows, input.spec);
  const localMetrics = evaluateLogistic(X, y, theta, intercept);
  const allowWeights = policy.allowedArtifacts.includes('model_weights');
  const localModelHash = `LOCAL:${createHash('sha256')
    .update(JSON.stringify({ theta, intercept, n, p: input.participantId }))
    .digest('hex')
    .slice(0, 16)}`;
  const base: FlPartyRunResult & { moduleSm3: string } = {
    taskId: input.taskId,
    participantId: input.participantId,
    roundsCompleted: input.spec.rounds,
    sampleCount: n,
    localMetrics,
    localModelHash,
    trainingMode: 'local-logistic',
    moduleSm3: input.model.moduleSm3,
    ...(allowWeights
      ? {
          modelParams: {
            featureSchemaVersion:
              'l4-fl-logistic@1#' +
              canonicalSm3(input.model.featureNames).slice(0, 8),
            featureNames: input.model.featureNames,
            theta,
            intercept,
            trainedOnSynthetic: false,
          },
        }
      : {}),
  };
  return assertSafeFlPartyRunResult(base) as FlPartyRunResult & {
    moduleSm3: string;
  };
}

export interface L4DeclassifyDeps {
  /** 合约条款（读 publication.minCell）。 */
  contractTerms?: Record<string, unknown>;
}

/**
 * 链上第二环：认领 **L4 模型载荷**；别的载荷婉拒（交给 L1.5 那环）。
 * 队列门槛/指标/哈希/产物策略都在 `buildL4PartyResult`（纯函数，已单测）。
 */
export function registerL4DeclassifyOperator(
  executor: MdopStageExecutor,
  logger: Logger = new Logger('L4Operators'),
): void {
  executor.appendSystemHandler(
    `declassify.small_cell@1.0.0`,
    async (input) => {
      const model = [...input.inputs.values()][0] as unknown as
        | (L4ModelPayload & {
            rows?: Record<string, unknown>[];
            spec?: FlPredictionTaskSpec;
          })
        | undefined;
      if (model?.analysisType !== 'fl-logistic') return undefined;
      if (!model.rows?.length || !model.spec)
        throw new Error('L4 出域缺训练行或规格（上游 l4-train 载荷不完整）');
      const contractMinCell = Number(
        (input.contractTerms as { publication?: { minCell?: number } } | undefined)
          ?.publication?.minCell ?? 0,
      );
      const paramMinCell = Number(input.stage.params?.minCell ?? 0);
      const minCell = Math.max(contractMinCell, paramMinCell);
      // 参与方 id 从阶段节点 URN 取（确定性；不依赖进程环境）
      const participantId = String(input.stage.node ?? '').split(':').pop() ?? '';
      const released = buildL4PartyResult(
        {
          taskId: input.jobId,
          participantId,
          rows: model.rows,
          spec: model.spec,
          model,
        },
        {
          minCell,
          allowedArtifacts: model.spec.outputPolicy.allowedArtifacts,
        },
      );
      logger.log(
        `declassify.small_cell(L4) 过门槛 minCell=${minCell} n=${released.sampleCount}`,
      );
      return {
        label: 'C3',
        schema: 'mdop.table/1.0',
        payload: released as unknown as Record<string, unknown>,
      };
    },
  );
}
