// 电力三个 wasm 模块共用的宿主侧编码与整数口径（参考实现与模块逐字段同式）。
//
// i64 语义一律用 BigInt 复刻：截断除法（向零）、逐位法整数平方根。Number 只用于 i32 范围内的量。

/** 各模块对单个样本绝对值的上限（与模块常量一致；宿主按量纲缩放到这个范围内）。 */
export const POWER_FIXED_MAX_ABS = 5_000_000;
/** 单块表的样本数上限。 */
export const POWER_FIXED_MAX_N = 65_536;
/** 单次调用的表计数上限。 */
export const POWER_FIXED_MAX_M = 65_536;

const I32_MAX = 2_147_483_647n;

/** 向零截断的 i64 除法。 */
export function idiv(a: bigint, b: bigint): bigint {
  return a / b;
}

/** 向下取整平方根（与模块同为唯一解，算法不同不影响结果）。 */
export function isqrtBig(x: bigint): bigint {
  if (x <= 0n) return 0n;
  let rest = x;
  let res = 0n;
  let bit = 1n << 62n;
  while (bit > rest) bit >>= 2n;
  while (bit !== 0n) {
    if (rest >= res + bit) {
      rest -= res + bit;
      res = (res >> 1n) + bit;
    } else {
      res >>= 1n;
    }
    bit >>= 2n;
  }
  return res;
}

export function clampI32(v: bigint): number {
  if (v > I32_MAX) return Number(I32_MAX);
  if (v < -I32_MAX) return -Number(I32_MAX);
  return Number(v);
}

export function assertIntegerSeries(series: readonly (readonly number[])[], label: string): void {
  for (const s of series) {
    for (const v of s) {
      if (!Number.isInteger(v)) {
        throw new Error(`${label}: 序列必须是整数（先按量纲缩放再取整），收到 ${String(v)}`);
      }
      if (Math.abs(v) > POWER_FIXED_MAX_ABS) {
        throw new Error(`${label}: 数值 ${v} 超出 ±${POWER_FIXED_MAX_ABS}（换更大的量纲）`);
      }
    }
  }
}

export interface PowerSeriesBlock {
  /** offsets u32[m+1] + values i32[Σn]（可再前置模块头部）。 */
  bytes: Uint8Array;
  m: number;
  totalSamples: number;
  maxSeriesLength: number;
}

/**
 * 编码多块表的序列：[header?] offsets u32[m+1] · values i32[Σn]。
 * header 由各模块自定（i32 小端），没有就传空数组。
 */
export function encodePowerSeries(
  series: readonly (readonly number[])[],
  header: readonly number[] = [],
): PowerSeriesBlock {
  const m = series.length;
  const total = series.reduce((s, x) => s + x.length, 0);
  const buffer = new ArrayBuffer(header.length * 4 + (m + 1) * 4 + total * 4);
  const view = new DataView(buffer);
  let off = 0;
  for (const h of header) {
    view.setInt32(off, h, true);
    off += 4;
  }
  let acc = 0;
  view.setUint32(off, 0, true);
  off += 4;
  for (const s of series) {
    acc += s.length;
    view.setUint32(off, acc, true);
    off += 4;
  }
  for (const s of series) {
    for (const v of s) {
      view.setInt32(off, v, true);
      off += 4;
    }
  }
  return {
    bytes: new Uint8Array(buffer),
    m,
    totalSamples: total,
    maxSeriesLength: series.reduce((mx, s) => Math.max(mx, s.length), 0),
  };
}

export function align8(off: number): number {
  return (off + 7) & ~7;
}

/** 读 i32 小端数组。 */
export function readI32s(bytes: Uint8Array, count: number, startIndex = 0): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(view.getInt32((startIndex + i) * 4, true));
  return out;
}

/**
 * 选量纲：让所有样本 |v·1000/unitW| ≤ MAX_ABS。功率单位 kW 入，返回每整数单位代表多少 W。
 * 候选 1 W、10 W、100 W、1 kW、10 kW —— 依次放大直到装得下。
 */
export function choosePowerUnitW(valuesKw: readonly number[]): number {
  let maxAbsW = 0;
  for (const v of valuesKw) maxAbsW = Math.max(maxAbsW, Math.abs(v) * 1000);
  for (const unit of [1, 10, 100, 1000, 10_000]) {
    if (Math.ceil(maxAbsW / unit) <= POWER_FIXED_MAX_ABS) return unit;
  }
  throw new Error(`功率幅值 ${maxAbsW} W 超出模块可表示范围`);
}

/** kW → 整数单位（四舍五入）。 */
export function kwToUnits(valuesKw: readonly number[], unitW: number): number[] {
  return valuesKw.map((v) => Math.round((v * 1000) / unitW));
}
