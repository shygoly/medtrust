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
      payload: payload as unknown as Record<string, unknown>,
    };
  });
}
