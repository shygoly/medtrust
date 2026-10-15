// 站内 Cox（单协变量、β=0 的一步 Newton）+ 分箱 Kaplan–Meier。与 Wasm 逐字段同式。
//
// 分数和信息量按整数截断累加，再换成 Q16.16 的 log HR 与标准误。
// 生存率在每个箱的左端点取值（不含该天的事件）。在险人数低于 minCell 的箱把生存率和人数都写成 0。
// 事件数低于 minCell，或信息量为 0，则抑制 log HR，不交出占位数字。

export const SURVIVAL_EFFECT_Q = 65536;
export const SURVIVAL_MAX_N = 4096;
export const SURVIVAL_MAX_DAY = 4095;
export const SURVIVAL_MAX_BINS = 64;

const HEADER_BYTES = 16;
const ROW_BYTES = 8;
const HIST_DAYS = SURVIVAL_MAX_DAY + 1;
const HIST_BYTES = 4 * HIST_DAYS * 4;

export interface SurvivalEffectInput {
  minCell: number;
  binWidth: number;
  treated: readonly number[];
  event: readonly number[];
  duration: readonly number[];
}

export interface SurvivalBinQ16 {
  t: number;
  survQ: number;
  atRisk: number;
  suppressed: 0 | 1;
}

export interface SurvivalEffectQ16 {
  logHrQ: number;
  seQ: number;
  suppressed: 0 | 1;
  bins: SurvivalBinQ16[];
}

export interface SurvivalEffectEncoded {
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

export function survivalEffectQ16(input: SurvivalEffectInput): SurvivalEffectQ16 {
  const n = input.treated.length;
  const q = BigInt(SURVIVAL_EFFECT_Q);
  const eventT = new Int32Array(HIST_DAYS);
  const eventC = new Int32Array(HIST_DAYS);
  const exitT = new Int32Array(HIST_DAYS);
  const exitC = new Int32Array(HIST_DAYS);
  let maxDur = 0;
  let events = 0;
  let riskT = 0;
  let riskC = 0;
  for (let i = 0; i < n; i++) {
    const day = input.duration[i];
    if (day > maxDur) maxDur = day;
    if (input.treated[i] === 1) {
      riskT++;
      exitT[day]++;
      if (input.event[i] === 1) {
        eventT[day]++;
        events++;
      }
    } else {
      riskC++;
      exitC[day]++;
      if (input.event[i] === 1) {
        eventC[day]++;
        events++;
      }
    }
  }

  let scoreQ = 0n;
  let infoQ = 0n;
  let survQ = q;
  const bins: SurvivalBinQ16[] = [];
  let rt = riskT;
  let rc = riskC;
  for (let day = 0; day <= maxDur; day++) {
    const risk = rt + rc;
    if (day % input.binWidth === 0) {
      if (risk < input.minCell) bins.push({ t: day, survQ: 0, atRisk: 0, suppressed: 1 });
      else bins.push({ t: day, survQ: Number(survQ), atRisk: risk, suppressed: 0 });
    }
    const e1 = eventT[day];
    const e0 = eventC[day];
    const dEvents = e1 + e0;
    const s0 = risk;
    const s1 = rt;
    if (dEvents > 0 && s0 > 0) {
      scoreQ += BigInt(e1) * q - (BigInt(dEvents) * BigInt(s1) * q) / BigInt(s0);
      infoQ += (BigInt(dEvents) * BigInt(s1) * BigInt(s0 - s1) * q) / (BigInt(s0) * BigInt(s0));
      for (let k = 0; k < dEvents; k++) survQ = (survQ * BigInt(s0 - 1)) / BigInt(s0);
    }
    rt -= exitT[day];
    rc -= exitC[day];
  }

  if (events < input.minCell || infoQ === 0n) {
    return { logHrQ: 0, seQ: 0, suppressed: 1, bins };
  }
  const logHrQ = (scoreQ * q) / infoQ;
  const se2 = (q * q * q) / infoQ;
  const se = isqrt(se2);
  const hi = 0x7fffffffn;
  const lo = -0x80000000n;
  return {
    logHrQ: Number(logHrQ < lo ? lo : logHrQ > hi ? hi : logHrQ),
    seQ: Number(se > hi ? hi : se),
    suppressed: 0,
    bins,
  };
}

export function encodeSurvivalEffect(input: SurvivalEffectInput): SurvivalEffectEncoded {
  const n = input.treated.length;
  if (input.event.length !== n || input.duration.length !== n) {
    throw new Error("暴露、事件、随访长度不一致");
  }
  if (n < 1 || n > SURVIVAL_MAX_N) throw new Error("行数超出模块上限");
  if (input.minCell < 1 || input.binWidth < 1) throw new Error("最小格或箱宽非法");
  let maxDur = 0;
  for (const day of input.duration) {
    if (!Number.isInteger(day) || day < 0 || day > SURVIVAL_MAX_DAY) {
      throw new Error("随访天数超出 0 到 4095");
    }
    if (day > maxDur) maxDur = day;
  }
  const bins = Math.floor(maxDur / input.binWidth) + 1;
  if (bins > SURVIVAL_MAX_BINS) throw new Error("分箱数超出模块上限");
  const rowsOff = HEADER_BYTES;
  const scratch = align8(rowsOff + n * ROW_BYTES);
  const outOff = align8(scratch + HIST_BYTES);
  const outBytes = 24 + bins * 16;
  const bytes = new Uint8Array(outOff + 24 + SURVIVAL_MAX_BINS * 16);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, input.minCell, true);
  view.setInt32(4, input.binWidth, true);
  view.setInt32(8, SURVIVAL_EFFECT_Q, true);
  view.setInt32(12, SURVIVAL_MAX_BINS, true);
  for (let i = 0; i < n; i++) {
    const t = input.treated[i];
    const y = input.event[i];
    if ((t !== 0 && t !== 1) || (y !== 0 && y !== 1)) {
      throw new Error("暴露和事件必须是 0 或 1");
    }
    const at = rowsOff + i * ROW_BYTES;
    bytes[at] = t;
    bytes[at + 1] = y;
    view.setInt32(at + 4, input.duration[i], true);
  }
  return {
    n,
    k: SURVIVAL_MAX_BINS,
    input: bytes,
    outOff,
    outBytes,
    requiredBytes: bytes.length,
  };
}

export function decodeSurvivalEffect(output: Uint8Array): SurvivalEffectQ16 {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const nBins = view.getInt32(16, true);
  const bins: SurvivalBinQ16[] = [];
  for (let i = 0; i < nBins; i++) {
    const at = 24 + i * 16;
    bins.push({
      t: view.getInt32(at, true),
      survQ: view.getInt32(at + 4, true),
      atRisk: view.getInt32(at + 8, true),
      suppressed: view.getInt32(at + 12, true) === 1 ? 1 : 0,
    });
  }
  return {
    logHrQ: view.getInt32(4, true),
    seQ: view.getInt32(8, true),
    suppressed: view.getInt32(12, true) === 1 ? 1 : 0,
    bins,
  };
}
