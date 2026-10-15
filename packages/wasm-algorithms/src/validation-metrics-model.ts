// 站点校验指标（Q16.16）：Mann–Whitney AUC、Hanley 标准误、五箱校准、九个阈值的决策曲线。
// 与 Wasm 逐字段同式。样本量或某一箱、某一阈值的预测阳性数低于 minCell 时，该指标写成 0 并标抑制。

export const VALIDATION_Q = 65536;
export const VALIDATION_MAX_N = 4096;
export const VALIDATION_CAL_BINS = 5;
export const VALIDATION_DC_POINTS = 9;

const HEADER_BYTES = 16;
const ROW_BYTES = 8;

export interface ValidationMetricsInput {
  minCell: number;
  label: readonly number[];
  score: readonly number[];
}

export interface CalibrationBinQ16 {
  n: number;
  events: number;
  meanQ: number;
  suppressed: 0 | 1;
}

export interface DecisionPointQ16 {
  threshold: number;
  netBenefitQ: number;
  suppressed: 0 | 1;
}

export interface ValidationMetricsQ16 {
  suppressed: 0 | 1;
  aucQ: number;
  seQ: number;
  nPos: number;
  nNeg: number;
  calibration: CalibrationBinQ16[];
  decision: DecisionPointQ16[];
}

export interface ValidationMetricsEncoded {
  n: number;
  k: number;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
  requiredBytes: number;
}

function isqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function align8(off: number): number {
  return (off + 7) & ~7;
}

function sat(v: bigint): number {
  const lo = -0x80000000n;
  const hi = 0x7fffffffn;
  if (v < lo) return Number(lo);
  if (v > hi) return Number(hi);
  return Number(v);
}

export function validationMetricsQ16(input: ValidationMetricsInput): ValidationMetricsQ16 {
  const n = input.label.length;
  const q = BigInt(VALIDATION_Q);
  let nPos = 0;
  let nNeg = 0;
  let concordant = 0;
  let ties = 0;
  const binN = new Array<number>(VALIDATION_CAL_BINS).fill(0);
  const binEvents = new Array<number>(VALIDATION_CAL_BINS).fill(0);
  const binSum = new Array<number>(VALIDATION_CAL_BINS).fill(0);
  for (let i = 0; i < n; i++) {
    if (input.label[i] === 1) nPos++;
    else nNeg++;
    const bin = Math.min(VALIDATION_CAL_BINS - 1, Math.floor((input.score[i] * VALIDATION_CAL_BINS) / VALIDATION_Q));
    binN[bin]++;
    binSum[bin] += input.score[i];
    if (input.label[i] === 1) binEvents[bin]++;
  }
  for (let i = 0; i < n; i++) {
    if (input.label[i] !== 1) continue;
    for (let j = 0; j < n; j++) {
      if (input.label[j] !== 0) continue;
      if (input.score[i] > input.score[j]) concordant++;
      else if (input.score[i] === input.score[j]) ties++;
    }
  }

  const calibration: CalibrationBinQ16[] = [];
  for (let b = 0; b < VALIDATION_CAL_BINS; b++) {
    if (n < input.minCell || binN[b] < input.minCell) {
      calibration.push({ n: 0, events: 0, meanQ: 0, suppressed: 1 });
    } else {
      calibration.push({
        n: binN[b],
        events: binEvents[b],
        meanQ: Math.floor(binSum[b] / binN[b]),
        suppressed: 0,
      });
    }
  }

  const decision: DecisionPointQ16[] = [];
  for (let k = 1; k <= VALIDATION_DC_POINTS; k++) {
    let tp = 0;
    let fp = 0;
    for (let i = 0; i < n; i++) {
      if (input.score[i] * 10 < k * VALIDATION_Q) continue;
      if (input.label[i] === 1) tp++;
      else fp++;
    }
    if (n < input.minCell || tp + fp < input.minCell) {
      decision.push({ threshold: k, netBenefitQ: 0, suppressed: 1 });
      continue;
    }
    const nb = (BigInt(tp) * q) / BigInt(n) - (BigInt(fp) * q * BigInt(k)) / (BigInt(n) * BigInt(10 - k));
    decision.push({ threshold: k, netBenefitQ: sat(nb), suppressed: 0 });
  }

  if (n < input.minCell || nPos === 0 || nNeg === 0) {
    return { suppressed: 1, aucQ: 0, seQ: 0, nPos, nNeg, calibration, decision };
  }
  const aucQ = (BigInt(2 * concordant + ties) * q) / BigInt(2 * nPos * nNeg);
  const q1 = (aucQ * q) / (2n * q - aucQ);
  const q2 = (2n * aucQ * aucQ) / (q + aucQ);
  const factor = q + BigInt(nPos - 1) * q1 + BigInt(nNeg - 1) * q2;
  const se2 = (aucQ * (q - aucQ) * factor) / (q * BigInt(nPos) * BigInt(nNeg));
  return {
    suppressed: 0,
    aucQ: sat(aucQ),
    seQ: sat(isqrt(se2)),
    nPos,
    nNeg,
    calibration,
    decision,
  };
}

export function encodeValidationMetrics(input: ValidationMetricsInput): ValidationMetricsEncoded {
  const n = input.label.length;
  if (input.score.length !== n) throw new Error("标签与分数长度不一致");
  if (n < 1 || n > VALIDATION_MAX_N) throw new Error("行数超出模块上限");
  if (input.minCell < 1) throw new Error("最小格非法");
  const rowsOff = HEADER_BYTES;
  const outOff = align8(rowsOff + n * ROW_BYTES);
  const outBytes = 32 + VALIDATION_CAL_BINS * 16 + VALIDATION_DC_POINTS * 16;
  const bytes = new Uint8Array(outOff + outBytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, input.minCell, true);
  view.setInt32(4, VALIDATION_Q, true);
  view.setInt32(8, VALIDATION_CAL_BINS, true);
  view.setInt32(12, VALIDATION_DC_POINTS, true);
  for (let i = 0; i < n; i++) {
    const label = input.label[i];
    const score = input.score[i];
    if ((label !== 0 && label !== 1) || !Number.isInteger(score) || score < 0 || score > VALIDATION_Q) {
      throw new Error("标签必须是 0 或 1，分数必须落在 0 到 Q");
    }
    const at = rowsOff + i * ROW_BYTES;
    bytes[at] = label;
    view.setInt32(at + 4, score, true);
  }
  return { n, k: VALIDATION_CAL_BINS, input: bytes, outOff, outBytes, requiredBytes: bytes.length };
}

export function decodeValidationMetrics(output: Uint8Array): ValidationMetricsQ16 {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const calibration: CalibrationBinQ16[] = [];
  for (let i = 0; i < VALIDATION_CAL_BINS; i++) {
    const at = 32 + i * 16;
    calibration.push({
      n: view.getInt32(at, true),
      events: view.getInt32(at + 4, true),
      meanQ: view.getInt32(at + 8, true),
      suppressed: view.getInt32(at + 12, true) === 1 ? 1 : 0,
    });
  }
  const decision: DecisionPointQ16[] = [];
  const dcOff = 32 + VALIDATION_CAL_BINS * 16;
  for (let i = 0; i < VALIDATION_DC_POINTS; i++) {
    const at = dcOff + i * 16;
    decision.push({
      threshold: view.getInt32(at, true),
      netBenefitQ: view.getInt32(at + 4, true),
      suppressed: view.getInt32(at + 8, true) === 1 ? 1 : 0,
    });
  }
  return {
    suppressed: view.getInt32(0, true) === 1 ? 1 : 0,
    aucQ: view.getInt32(4, true),
    seQ: view.getInt32(8, true),
    nPos: view.getInt32(12, true),
    nNeg: view.getInt32(16, true),
    calibration,
    decision,
  };
}
