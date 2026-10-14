// L4 联邦预测（批次 1A）的**节点内定点训练**参考实现 —— 与 Wasm 模块同源。
//
// 为什么是定点而不是浮点：平台算子 schema 明令「承载受托分析逻辑的算子 MUST 是 wasm 或 oci」
// （packages/mdop/src/schema/operator.ts:19，D-MDOP-5），而既有 wasm 模块**只做整数**
//（ve-tnd.ts 无 f64/exp/log），parity 对拍是**逐字段相等**。LR 训练天然浮点，
// AssemblyScript 的 exp/log 与 V8 不保证逐位一致 —— 所以本模块用 Q16.16 定点做批量梯度下降，
// sigmoid 由**宿主传入的整数查表**（`buildFlLogisticLut`）实现，模块内零浮点、零能力导入。
//
// 语义必须与 `modules/fl-logistic-as/assembly/fl-logistic.ts` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/fl-logistic-parity.test.mjs`），漂移即测试红。
//
// 实测（同夹具、同超参，见 change mdop-fl-migration design D1c）：定点 vs 浮点 IRLS
// 的 AUC 到 4 位小数一致、max|Δθ| ≤ 0.03，唯一符号翻转发生在 ≈0 的噪声底系数上。

/** 该模块在 MDOP 里的算子 id（计划模板 buildL4Plan 引用它）。 */
export const FL_LOGISTIC_OPERATOR_ID = "rws.l4-train";
/** 分析类型（清单里与 wasm 模块配对）。 */
export const FL_LOGISTIC_ANALYSIS_TYPE = "fl-logistic";

/** Q16.16 定点比例。 */
export const FL_LOGISTIC_Q = 65536;
/** sigmoid 查表域 [-8, 8]（Q16.16）。 */
export const FL_LOGISTIC_Z_MIN_Q = -8 * FL_LOGISTIC_Q;
export const FL_LOGISTIC_Z_MAX_Q = 8 * FL_LOGISTIC_Q;
/** 查表条目数 = 分段数 + 1。 */
export const FL_LOGISTIC_LUT_N = 1024;
export const FL_LOGISTIC_LUT_LEN = FL_LOGISTIC_LUT_N + 1;

/** 默认超参（定点整数）：步长 0.5、L2 0.01。 */
export const FL_LOGISTIC_DEFAULT_STEP_Q = Math.round(0.5 * FL_LOGISTIC_Q);
export const FL_LOGISTIC_DEFAULT_L2_Q = Math.round(0.01 * FL_LOGISTIC_Q);
export const FL_LOGISTIC_DEFAULT_EPOCHS = 2000;

/** 输入块头部字节数（见模块 ABI 头注释）。 */
export const FL_LOGISTIC_HEADER_BYTES = 32;

/**
 * 生成 sigmoid 查表（Q16.16 整数，均匀分布于 [zMin, zMax]）。
 * 表只在这里生成一次，然后**写进 Wasm 的输入块**由模块索引 —— 单一事实源，无需在两种语言里复制常量。
 */
export function buildFlLogisticLut(): number[] {
  const out = new Array<number>(FL_LOGISTIC_LUT_LEN);
  for (let i = 0; i < FL_LOGISTIC_LUT_LEN; i++) {
    const z =
      (FL_LOGISTIC_Z_MIN_Q +
        ((FL_LOGISTIC_Z_MAX_Q - FL_LOGISTIC_Z_MIN_Q) * i) / FL_LOGISTIC_LUT_N) /
      FL_LOGISTIC_Q;
    out[i] = Math.round((1 / (1 + Math.exp(-z))) * FL_LOGISTIC_Q);
  }
  return out;
}

/**
 * 整数 sigmoid（Q16.16 入 / Q16.16 出）：查表 + 整数线性插值。
 * 与 Wasm 模块逐字段同式（只用整数乘除与截断）。
 */
export function flLogisticSigmoidQ(
  zQ: number,
  lut: readonly number[],
  zMinQ: number = FL_LOGISTIC_Z_MIN_Q,
  zMaxQ: number = FL_LOGISTIC_Z_MAX_Q,
): number {
  const den = zMaxQ - zMinQ;
  const off = zQ - zMinQ;
  if (off <= 0) return lut[0];
  if (off >= den) return lut[lut.length - 1];
  const num = off * (lut.length - 1);
  const i = Math.trunc(num / den);
  const rem = num - i * den;
  return Math.trunc((lut[i] * (den - rem) + lut[i + 1] * rem) / den);
}

/** 特征必须是整数（Q16.16）——非整数会让「编码后字节」与参考实现不一致，parity 就失去意义。 */
function assertIntegerMatrix(XQ: number[][]): void {
  for (const row of XQ) {
    for (const v of row) {
      if (!Number.isInteger(v)) {
        throw new Error(
          "fl-logistic: 特征必须是 Q16.16 整数（先乘比例再取整），收到 " + String(v),
        );
      }
    }
  }
}

export interface FlLogisticQ16Input {
  /** Q16.16 特征（行主序），由宿主编码。 */
  XQ: number[][];
  /** 0/1 标签。 */
  y: number[];
  epochs?: number;
  stepQ?: number;
  l2Q?: number;
  lut?: readonly number[];
}

export interface FlLogisticQ16Result {
  analysisType: typeof FL_LOGISTIC_ANALYSIS_TYPE;
  /** Q16.16 系数。 */
  thetaQ: number[];
  interceptQ: number;
  nSamples: number;
  positives: number;
  epochsUsed: number;
}

/**
 * 定点批量梯度下降（与 wasm 模块**逐步同式**）。
 * 全部整数运算：同输入 → 同输出（可复现、可逐字段对拍）。
 */
export function trainFlLogisticQ16(
  input: FlLogisticQ16Input,
): FlLogisticQ16Result {
  const lut = input.lut ?? buildFlLogisticLut();
  const n = input.XQ.length;
  const d = input.XQ[0]?.length ?? 0;
  if (n <= 0) throw new Error("fl-logistic: 没有训练行");
  if (d <= 0) throw new Error("fl-logistic: 没有特征列");
  assertIntegerMatrix(input.XQ);
  const epochs = input.epochs ?? FL_LOGISTIC_DEFAULT_EPOCHS;
  const stepQ = input.stepQ ?? FL_LOGISTIC_DEFAULT_STEP_Q;
  const l2Q = input.l2Q ?? FL_LOGISTIC_DEFAULT_L2_Q;
  const yQ = input.y.map((v) => (v ? FL_LOGISTIC_Q : 0));
  const thetaQ = new Array<number>(d).fill(0);
  let interceptQ = 0;
  let epochsUsed = 0;
  for (let ep = 0; ep < epochs; ep++) {
    epochsUsed = ep + 1;
    const gradQ = new Array<number>(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const row = input.XQ[i];
      let zQ = interceptQ;
      for (let j = 0; j < d; j++)
        if (row[j] !== 0) zQ += Math.trunc((row[j] * thetaQ[j]) / FL_LOGISTIC_Q);
      const errQ = flLogisticSigmoidQ(zQ, lut) - yQ[i];
      for (let j = 0; j < d; j++)
        if (row[j] !== 0)
          gradQ[j] += Math.trunc((errQ * row[j]) / FL_LOGISTIC_Q);
      gradB += errQ;
    }
    let maxStep = 0;
    for (let j = 0; j < d; j++) {
      const g =
        Math.trunc(gradQ[j] / n) +
        Math.trunc((l2Q * thetaQ[j]) / FL_LOGISTIC_Q);
      const step = Math.trunc((stepQ * g) / FL_LOGISTIC_Q);
      thetaQ[j] -= step;
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    const gB = Math.trunc(gradB / n);
    const stepB = Math.trunc((stepQ * gB) / FL_LOGISTIC_Q);
    interceptQ -= stepB;
    maxStep = Math.max(maxStep, Math.abs(stepB));
    if (maxStep === 0) break; // 定点下已无步长可走 = 收敛
  }
  let positives = 0;
  for (const v of input.y) if (v) positives++;
  return {
    analysisType: FL_LOGISTIC_ANALYSIS_TYPE,
    thetaQ,
    interceptQ,
    nSamples: n,
    positives,
    epochsUsed,
  };
}

export interface FlLogisticEncodedInput {
  /** 整个输入块（含头部、查表、特征、标签）。 */
  bytes: Uint8Array;
  n: number;
  d: number;
  /** 输出块需要的字节数（thetaQ[d] + interceptQ + nSamples + positives）。 */
  outBytes: number;
}

/** 把训练输入编码成模块输入块（与 ABI 头注释完全对应）。 */
export function encodeFlLogistic(input: FlLogisticQ16Input): FlLogisticEncodedInput {
  const lut = input.lut ?? buildFlLogisticLut();
  const n = input.XQ.length;
  const d = input.XQ[0]?.length ?? 0;
  const epochs = input.epochs ?? FL_LOGISTIC_DEFAULT_EPOCHS;
  const stepQ = input.stepQ ?? FL_LOGISTIC_DEFAULT_STEP_Q;
  const l2Q = input.l2Q ?? FL_LOGISTIC_DEFAULT_L2_Q;
  assertIntegerMatrix(input.XQ);
  const lutBytes = lut.length * 4;
  const xBytes = n * d * 4;
  const yBytes = n * 4;
  const total = FL_LOGISTIC_HEADER_BYTES + lutBytes + xBytes + yBytes;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setInt32(0, FL_LOGISTIC_Z_MIN_Q, true);
  view.setInt32(4, FL_LOGISTIC_Z_MAX_Q, true);
  view.setUint32(8, epochs, true);
  view.setInt32(12, stepQ, true);
  view.setInt32(16, l2Q, true);
  view.setUint32(20, lut.length, true);
  view.setInt32(24, 0, true);
  view.setInt32(28, 0, true);
  let off = FL_LOGISTIC_HEADER_BYTES;
  for (const v of lut) {
    view.setInt32(off, v, true);
    off += 4;
  }
  for (const row of input.XQ)
    for (const v of row) {
      view.setInt32(off, v, true);
      off += 4;
    }
  for (const v of input.y) {
    view.setInt32(off, v ? 1 : 0, true);
    off += 4;
  }
  return {
    bytes: new Uint8Array(buffer),
    n,
    d,
    outBytes: d * 4 + 12,
  };
}

/** 读模块输出块 → 结果。 */
export function decodeFlLogisticOutput(
  bytes: Uint8Array,
  d: number,
  epochsUsed = 0,
): FlLogisticQ16Result {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const thetaQ: number[] = [];
  for (let j = 0; j < d; j++) thetaQ.push(view.getInt32(j * 4, true));
  return {
    analysisType: FL_LOGISTIC_ANALYSIS_TYPE,
    thetaQ,
    interceptQ: view.getInt32(d * 4, true),
    nSamples: view.getInt32(d * 4 + 4, true),
    positives: view.getInt32(d * 4 + 8, true),
    epochsUsed,
  };
}
