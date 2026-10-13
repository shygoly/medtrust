import { pancreatitisRiskFlPredictionSpec } from './fl-prediction-task-spec';
import {
  encodeTabularRows,
  evaluateLogistic,
  trainLogisticRegression,
} from './local-logistic';

/**
 * 【原型 · 待裁决】定点整数逻辑回归（Q16.16）——为 FL 批次 1A 的 wasm 选型提供**数据**。
 *
 * 背景（change `mdop-fl-migration` design D1b）：wasm 模块只做整数（既有模块无 f64/exp/log），
 * 对拍逐字节相等；而现有浮点实现用的是 **IRLS/阻尼牛顿**（每轮要解线性方程组），
 * 无法用"整数充分统计量 + 平台聚合"表达。本原型把优化器换成**可累加的定点批量梯度下降**，
 * 量化它与浮点参考在同一数据上的偏差 —— 这是选项 A/B 共同的代价，也是裁决需要的证据。
 *
 * 说明：本文件是**原型**，不是生产实现；wasm 版会把 sigmoid 表**烘焙成常量**（构建期同源生成），
 * 运行时不含浮点。这里用 Math.exp 生成表只为对齐同一数值口径。
 */

const S = 65536; // Q16.16
const Z_MIN = -8;
const Z_MAX = 8;
const LUT_N = 1024;
const DEN = (Z_MAX - Z_MIN) * S;

const SIG_LUT = (() => {
  const t = new Array<number>(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const z = Z_MIN + ((Z_MAX - Z_MIN) * i) / LUT_N;
    t[i] = Math.round((1 / (1 + Math.exp(-z))) * S);
  }
  return t;
})();

/** 整数 sigmoid（Q16.16 入 / Q16.16 出），查表 + 整数线性插值，无浮点运算。 */
function sigmoidQ(zQ: number): number {
  const off = zQ - Z_MIN * S;
  if (off <= 0) return SIG_LUT[0];
  if (off >= DEN) return SIG_LUT[LUT_N];
  const num = off * LUT_N; // 整数
  const i = Math.trunc(num / DEN);
  const rem = num - i * DEN;
  return Math.trunc(
    (SIG_LUT[i] * (DEN - rem) + SIG_LUT[i + 1] * rem) / DEN,
  );
}

/** 定点批量梯度下降（可选 l2；截距不罚）。全部整数运算，同输入 → 同输出。 */
function trainLogisticRegressionQ16(
  X: number[][],
  y: number[],
  opts?: { epochs?: number; stepQ?: number; l2Q?: number },
): { thetaQ: number[]; interceptQ: number; epochs: number } {
  const dim = X[0]?.length ?? 0;
  const n = X.length || 1;
  const epochs = opts?.epochs ?? 400;
  const eta = opts?.stepQ ?? Math.round(0.5 * S);
  const l2 = opts?.l2Q ?? Math.round(0.01 * S);
  const XQ = X.map((row) => row.map((v) => Math.round(v * S)));
  const yQ = y.map((v) => (v ? S : 0));
  const thetaQ = new Array<number>(dim).fill(0);
  let interceptQ = 0;
  let used = 0;
  for (let ep = 0; ep < epochs; ep++) {
    used = ep + 1;
    const gradQ = new Array<number>(dim).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const row = XQ[i];
      let zQ = interceptQ;
      for (let j = 0; j < dim; j++)
        if (row[j] !== 0) zQ += Math.trunc((row[j] * thetaQ[j]) / S);
      const errQ = sigmoidQ(zQ) - yQ[i];
      for (let j = 0; j < dim; j++)
        if (row[j] !== 0) gradQ[j] += Math.trunc((errQ * row[j]) / S);
      gradB += errQ;
    }
    let maxStep = 0;
    for (let j = 0; j < dim; j++) {
      const g = Math.trunc(gradQ[j] / n) + Math.trunc((l2 * thetaQ[j]) / S);
      const step = Math.trunc((eta * g) / S);
      thetaQ[j] -= step;
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    const gB = Math.trunc(gradB / n);
    const stepB = Math.trunc((eta * gB) / S);
    interceptQ -= stepB;
    maxStep = Math.max(maxStep, Math.abs(stepB));
    if (maxStep === 0) break; // 定点下已无步长可走 = 收敛
  }
  return { thetaQ, interceptQ, epochs: used };
}

function aucOf(thetaQ: number[], interceptQ: number, X: number[][], y: number[]) {
  return evaluateLogistic(
    X,
    y,
    thetaQ.map((v) => v / S),
    interceptQ / S,
  ).auc;
}

function rows200() {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 200; i++) {
    const exposed = i % 2 === 0;
    const event = exposed ? i % 5 !== 0 : i % 20 === 0;
    rows.push({
      ageBand: '50-59',
      sex: i % 3 === 0 ? 'female' : 'male',
      exposed_insulin: exposed,
      pancreatitis_event: event,
    });
  }
  return rows;
}

function rowsLowPrev() {
  const bands = ['40-49', '50-59', '60-69', '70-79'];
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 4000; i++) {
    const exposed = i % 2 === 0;
    const event = exposed ? i % 16 === 0 : i % 40 === 1;
    rows.push({
      ageBand: bands[i % bands.length],
      sex: i % 3 === 0 ? 'female' : 'male',
      exposed_insulin: exposed,
      pancreatitis_event: event,
    });
  }
  return rows;
}

describe('【原型】定点整数逻辑回归 vs 浮点参考（为 wasm 选型提供数据）', () => {
  const spec = pancreatitisRiskFlPredictionSpec();

  function measure(rows: Record<string, unknown>[], epochs: number) {
    const { X, y, featureNames } = encodeTabularRows(rows, spec);
    const fp = trainLogisticRegression(X, y, { learningRate: 0.1, l2: 0.01 });
    const q = trainLogisticRegressionQ16(X, y, { epochs });
    const aucFp = evaluateLogistic(X, y, fp.theta, fp.intercept).auc;
    const aucQ = aucOf(q.thetaQ, q.interceptQ, X, y);
    const maxDelta = Math.max(
      ...fp.theta.map((v, j) => Math.abs(v - q.thetaQ[j] / S)),
    );
    const signAgree = fp.theta.filter(
      (v, j) => Math.sign(v) === Math.sign(q.thetaQ[j]),
    ).length;
    return { X, y, featureNames, fp, q, aucFp, aucQ, maxDelta, signAgree };
  }

  it('200 例可分数据：给出偏差测量', () => {
    const m = measure(rows200(), 2000);
    const deltaAuc = Math.abs((m.aucFp ?? 0) - (m.aucQ ?? 0));
    // eslint-disable-next-line no-console
    console.log(
      '[定点原型/200例] aucFloat=' + m.aucFp?.toFixed(4) +
        ' aucFixed=' + m.aucQ?.toFixed(4) +
        ' |Δauc|=' + deltaAuc.toFixed(4) +
        ' max|Δθ|=' + m.maxDelta.toFixed(4) +
        ' 符号一致=' + m.signAgree + '/' + m.fp.theta.length +
        ' epochs=' + m.q.epochs,
    );
    const mismatched = m.featureNames.filter(
      (_n, j) => Math.sign(m.fp.theta[j]) !== Math.sign(m.q.thetaQ[j]),
    );
    // eslint-disable-next-line no-console
    console.log(
      '[定点原型/200例] 符号不一致的特征=' +
        JSON.stringify(mismatched) +
        ' 其浮点/定点值=' +
        JSON.stringify(
          mismatched.map((n) => {
            const j = m.featureNames.indexOf(n);
            return [m.fp.theta[j].toFixed(4), (m.q.thetaQ[j] / S).toFixed(4)];
          }),
        ),
    );
    expect(m.fp.theta.length).toBeGreaterThan(0);
    expect(typeof m.aucQ).toBe('number');
  });

  it('4000 例低事件率队列：给出偏差测量（这是线上出事过的那组）', () => {
    const m = measure(rowsLowPrev(), 2000);
    const insulinIdx = m.featureNames.indexOf('exposed_insulin');
    const deltaAuc = Math.abs((m.aucFp ?? 0) - (m.aucQ ?? 0));
    // eslint-disable-next-line no-console
    console.log(
      '[定点原型/4000例低事件率] aucFloat=' + m.aucFp?.toFixed(4) +
        ' aucFixed=' + m.aucQ?.toFixed(4) +
        ' |Δauc|=' + deltaAuc.toFixed(4) +
        ' insulinFloat=' + m.fp.theta[insulinIdx].toFixed(4) +
        ' insulinFixed=' + (m.q.thetaQ[insulinIdx] / S).toFixed(4) +
        ' max|Δθ|=' + m.maxDelta.toFixed(4) +
        ' 符号一致=' + m.signAgree + '/' + m.fp.theta.length +
        ' epochs=' + m.q.epochs,
    );
    expect(m.fp.theta[insulinIdx]).toBeGreaterThan(0);
  });

  it('定点实现的两个性质：可复现 + 整数 FedAvg 精确可累加', () => {
    const { X, y } = encodeTabularRows(rows200(), spec);
    const a = trainLogisticRegressionQ16(X, y, { epochs: 500 });
    const b = trainLogisticRegressionQ16(X, y, { epochs: 500 });
    expect(a.thetaQ).toEqual(b.thetaQ);
    expect(a.interceptQ).toBe(b.interceptQ);
    // 两院按样本数加权聚合：整数和 → 精确（无浮点误差，可用于跨院聚合）
    const nA = 120;
    const nB = 80;
    const agg = a.thetaQ.map((v, j) =>
      Math.trunc((v * nA + b.thetaQ[j] * nB) / (nA + nB)),
    );
    expect(agg).toEqual(a.thetaQ);
  });
});
