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

/** Mini-batch GD logistic regression with L2 penalty. */
export function trainLogisticRegression(
  X: number[][],
  y: number[],
  opts?: { learningRate?: number; epochs?: number; l2?: number },
): { theta: number[]; intercept: number } {
  const dim = X[0]?.length ?? 0;
  const lr = opts?.learningRate ?? 0.1;
  const epochs = opts?.epochs ?? 80;
  const l2 = opts?.l2 ?? 0.01;
  const theta = new Array(dim).fill(0);
  let intercept = 0;
  const n = X.length || 1;

  for (let ep = 0; ep < epochs; ep++) {
    const gTheta = new Array(dim).fill(0);
    let gIntercept = 0;
    for (let i = 0; i < X.length; i++) {
      const p = scoreLogistic(X[i], theta, intercept);
      const err = p - y[i];
      gIntercept += err;
      for (let j = 0; j < dim; j++) gTheta[j] += err * X[i][j];
    }
    intercept -= (lr * gIntercept) / n;
    for (let j = 0; j < dim; j++) {
      theta[j] -= (lr * (gTheta[j] / n + l2 * theta[j]));
    }
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
    epochs: 80,
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
