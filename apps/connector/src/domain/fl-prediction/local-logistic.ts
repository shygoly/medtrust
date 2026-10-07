// In-connector L2 logistic regression for FedAvg tabular FL (pancreatitis risk demo).
// Trains on materialized rows; returns coefficient bundle (no patient rows).
import { createHash } from 'crypto';
import { FlFeatureColumn, FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { FlClassificationMetrics, FlModelParams } from './fl-run-result';

export const PANCREATITIS_FEATURE_SCHEMA_VERSION = 'pancreatitis-risk-v1';

export interface EncodedTabular {
  featureNames: string[];
  X: number[][];
  y: number[];
}

/** Expand featureColumns into a fixed one-hot / boolean vector schema. */
export function buildFeatureNames(featureColumns: readonly FlFeatureColumn[]): string[] {
  const names: string[] = [];
  for (const col of featureColumns) {
    if (col.dtype === 'categorical' && col.categories?.length) {
      for (const cat of col.categories) {
        names.push(`${col.name}=${cat}`);
      }
    } else {
      names.push(col.name);
    }
  }
  return names;
}

export function encodeTabularRows(
  rows: readonly Record<string, unknown>[],
  spec: FlPredictionTaskSpec,
): EncodedTabular {
  const featureNames = buildFeatureNames(spec.featureColumns);
  const X: number[][] = [];
  const y: number[] = [];

  for (const row of rows) {
    const vec = new Array(featureNames.length).fill(0);
    let offset = 0;
    for (const col of spec.featureColumns) {
      const raw = row[col.name];
      if (col.dtype === 'categorical' && col.categories?.length) {
        const idx = col.categories.indexOf(String(raw ?? ''));
        if (idx >= 0) vec[offset + idx] = 1;
        offset += col.categories.length;
      } else if (col.dtype === 'boolean') {
        vec[offset] = raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
        offset += 1;
      } else {
        const n = Number(raw);
        vec[offset] = Number.isFinite(n) ? n : 0;
        offset += 1;
      }
    }
    const label = row[spec.targetColumn];
    const yi =
      label === true || label === 1 || label === '1' || label === 'true' ? 1 : 0;
    X.push(vec);
    y.push(yi);
  }

  return { featureNames, X, y };
}

function sigmoid(z: number): number {
  if (z >= 20) return 1;
  if (z <= -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function scoreLogistic(
  x: number[],
  theta: number[],
  intercept: number,
): number {
  let z = intercept;
  for (let j = 0; j < theta.length; j++) z += theta[j] * (x[j] ?? 0);
  return sigmoid(z);
}

const DEFAULT_MAX_EPOCHS = 500;
const DEFAULT_GRADIENT_TOLERANCE = 1e-6;

/** 解对称正定线性方程组 A·x = b（列主元高斯消元；维度即特征数，很小）。奇异时返回 undefined。 */
function solveLinearSystem(A: number[][], b: number[]): number[] | undefined {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return undefined;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < m; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= m; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let sum = M[r][m];
    for (let c = r + 1; c < m; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

/**
 * L2 正则逻辑回归，阻尼牛顿法（IRLS），迭代到梯度收敛。
 *
 * 目标函数与原先的全批量梯度下降相同（平均对数损失 + l2/2·‖θ‖²，截距不罚）；
 * `learningRate` 是牛顿步的阻尼系数（封顶 1），`epochs` 是迭代上限。截距从基线事件率的 logit 起步。
 *
 * 为什么不是固定轮数的梯度下降：低事件率队列从零起步、固定几十轮时，前面的轮次只是在把整体概率
 * 往下压——各特征被一并压成负权重，暴露系数反号、AUC < 0.5（线上任务 10ca19d3 实测 0.418）；
 * 而把梯度下降跑到收敛在 5000 例上要十几秒，会堵住连接器的事件循环。
 */
export function trainLogisticRegression(
  X: number[][],
  y: number[],
  opts?: { learningRate?: number; epochs?: number; l2?: number; tolerance?: number },
): { theta: number[]; intercept: number } {
  const dim = X[0]?.length ?? 0;
  const step = Math.min(1, opts?.learningRate ?? 0.1);
  const maxEpochs = opts?.epochs ?? DEFAULT_MAX_EPOCHS;
  const l2 = opts?.l2 ?? 0.01;
  const tolerance = opts?.tolerance ?? DEFAULT_GRADIENT_TOLERANCE;
  const theta = new Array(dim).fill(0);
  const n = X.length || 1;
  const positives = y.reduce((acc, yi) => acc + yi, 0);
  const baseRate = Math.min(Math.max(positives / n, 1e-6), 1 - 1e-6);
  let intercept = Math.log(baseRate / (1 - baseRate));

  // 参数向量按 [θ…, 截距] 排；截距列恒为 1。
  const size = dim + 1;
  for (let ep = 0; ep < maxEpochs; ep++) {
    const gradient = new Array(size).fill(0);
    const hessian = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let i = 0; i < X.length; i++) {
      const p = scoreLogistic(X[i], theta, intercept);
      const err = p - y[i];
      const w = p * (1 - p);
      for (let j = 0; j < size; j++) {
        const xj = j === dim ? 1 : X[i][j];
        if (xj === 0) continue;
        gradient[j] += err * xj;
        for (let k = j; k < size; k++) {
          const xk = k === dim ? 1 : X[i][k];
          if (xk !== 0) hessian[j][k] += w * xj * xk;
        }
      }
    }
    let maxGradient = 0;
    for (let j = 0; j < size; j++) {
      gradient[j] = gradient[j] / n + (j < dim ? l2 * theta[j] : 0);
      maxGradient = Math.max(maxGradient, Math.abs(gradient[j]));
      for (let k = j; k < size; k++) {
        hessian[j][k] /= n;
        hessian[k][j] = hessian[j][k];
      }
      // 极小的岭项只为数值稳定（某一分箱没有样本、或 l2=0 时该方向曲率为零）
      hessian[j][j] += (j < dim ? l2 : 0) + 1e-9;
    }
    if (maxGradient < tolerance) break;

    // 牛顿方向解不出来（病态）时退回一步梯度下降，不中断训练
    const direction = solveLinearSystem(hessian, gradient) ?? gradient;
    for (let j = 0; j < dim; j++) theta[j] -= step * direction[j];
    intercept -= step * direction[dim];
  }
  return { theta, intercept };
}

function pairwiseAuc(scores: number[], y: number[]): number | undefined {
  let pos = 0;
  let neg = 0;
  for (const yi of y) (yi === 1 ? pos++ : neg++);
  if (pos === 0 || neg === 0) return undefined;
  let correct = 0;
  for (let i = 0; i < scores.length; i++) {
    if (y[i] !== 1) continue;
    for (let j = 0; j < scores.length; j++) {
      if (y[j] !== 0) continue;
      if (scores[i] > scores[j]) correct += 1;
      else if (scores[i] === scores[j]) correct += 0.5;
    }
  }
  return correct / (pos * neg);
}

export function evaluateLogistic(
  X: number[][],
  y: number[],
  theta: number[],
  intercept: number,
): FlClassificationMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const scores: number[] = [];
  for (let i = 0; i < X.length; i++) {
    const p = scoreLogistic(X[i], theta, intercept);
    scores.push(p);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 1 && y[i] === 0) fp++;
    else if (pred === 0 && y[i] === 0) tn++;
    else fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = X.length > 0 ? (tp + tn) / X.length : 0;
  const auc = pairwiseAuc(scores, y);
  return {
    auc: auc !== undefined ? Number(auc.toFixed(4)) : undefined,
    f1: Number(f1.toFixed(4)),
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    accuracy: Number(accuracy.toFixed(4)),
  };
}

export function trainLocalLogisticParty(opts: {
  taskId: string;
  participantId: string;
  rows: Record<string, unknown>[];
  spec: FlPredictionTaskSpec;
}): {
  sampleCount: number;
  localMetrics: FlClassificationMetrics;
  localModelHash: string;
  modelParams: FlModelParams;
  trainingMode: 'local-logistic';
} {
  const encoded = encodeTabularRows(opts.rows, opts.spec);
  if (!encoded.X.length) {
    throw new Error('local logistic: no tabular rows to train');
  }
  const { theta, intercept } = trainLogisticRegression(encoded.X, encoded.y, {
    learningRate: opts.spec.hyperparameters?.learningRate ?? 0.1,
    l2: opts.spec.hyperparameters?.regularization ?? 0.01,
  });
  const localMetrics = evaluateLogistic(encoded.X, encoded.y, theta, intercept);
  const modelParams: FlModelParams = {
    featureSchemaVersion: PANCREATITIS_FEATURE_SCHEMA_VERSION,
    featureNames: encoded.featureNames,
    theta,
    intercept,
    trainedOnSynthetic: true,
  };
  const localModelHash = `LOCAL:${createHash('sha256')
    .update(JSON.stringify({ theta, intercept, n: encoded.X.length, p: opts.participantId }))
    .digest('hex')
    .slice(0, 16)}`;
  return {
    sampleCount: encoded.X.length,
    localMetrics,
    localModelHash,
    modelParams,
    trainingMode: 'local-logistic',
  };
}

/** Encode a single patient form into the fixed feature vector. */
export function encodePatientForm(
  form: Record<string, unknown>,
  featureColumns: readonly FlFeatureColumn[],
  featureNames: readonly string[],
): number[] {
  const encoded = encodeTabularRows(
    [
      {
        ...form,
        // dummy target unused
        __label: 0,
      },
    ],
    {
      purpose: 'infer',
      federationMode: 'horizontal',
      modality: 'structured_ehr',
      parties: [],
      modelType: 'logistic_regression',
      objective: 'binary',
      targetColumn: '__label',
      featureColumns: [...featureColumns],
      aggregation: 'fedavg',
      rounds: 1,
      outputPolicy: { allowedArtifacts: ['model_weights'] },
    },
  );
  if (encoded.featureNames.join('|') !== featureNames.join('|')) {
    // Align by name if categories drift
    const vec = new Array(featureNames.length).fill(0);
    for (let i = 0; i < encoded.featureNames.length; i++) {
      const j = featureNames.indexOf(encoded.featureNames[i]);
      if (j >= 0) vec[j] = encoded.X[0][i];
    }
    return vec;
  }
  return encoded.X[0];
}
