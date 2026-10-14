// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import {
  encodeScri,
  scriCount,
  type ScriEventRow,
  type ScriInput,
  type ScriRegistryRow,
  type ScriResult,
  type ScriWindows,
} from '@medtrust/wasm-algorithms';

/**
 * 疫苗接种后不良事件 **SCRI** 的宿主适配：把节点内解封后的两方投影（疾控接种 + 医院事件）
 * 装进 SCRI 模块的数字列 ABI，再把模块输出回填成 `rws.vaccine-scri@1` 载荷。
 *
 * 与 `pairing-sandbox.ts` 同一套写法（投影 → 沙箱 → 回填 + 不变量校验）。ABI 是 4 参
 * `run(inOff, n, k, outOff)`，头部 20 字节放窗口与剂次数，因此调用时显式给 `abi: 'scri@1'`。
 *
 * 留在宿主、**不进模块**的东西：主体键（关联假名）、日期与编码文本、分层键文本。
 */

export interface ScriProjection {
  pairs: number;
  doses: number;
  strata: number;
  strataKeys: string[];
  windows: ScriWindows;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
}

function align8(value: number): number {
  return (value + 7) & ~7;
}

const HEADER = 20;

export function scriRequiredBytes(input: { pairs: number; doses: number; strata: number }): number {
  const outOff = align8(HEADER + input.pairs * 5 + input.doses);
  return outOff + 12 * input.strata;
}

export function projectScri(input: ScriInput): ScriProjection {
  const enc = encodeScri(input);
  const n = enc.dayDiff.length;
  const doses = enc.doseStratum.length;
  const bytes = new Uint8Array(HEADER + n * 5 + doses);
  const view = new DataView(bytes.buffer);
  const [r1, r2] = input.windows.risk;
  const [c1, c2] = input.windows.control;
  [r1, r2, c1, c2, doses].forEach((v, i) => view.setInt32(i * 4, v, true));
  bytes.set(new Uint8Array(enc.dayDiff.buffer, enc.dayDiff.byteOffset, enc.dayDiff.byteLength), HEADER);
  bytes.set(enc.pairStratum, HEADER + n * 4);
  bytes.set(enc.doseStratum, HEADER + n * 5);
  return {
    pairs: n,
    doses,
    strata: enc.strataKeys.length,
    strataKeys: enc.strataKeys,
    windows: input.windows,
    input: bytes,
    outOff: align8(bytes.length),
    outBytes: 12 * enc.strataKeys.length,
  };
}

/** 模块输出 → 结果，并校验不变量（计数不得超过配对数、剂次合计必须等于输入剂次数）。 */
export function scriFromSandboxOutput(input: { projection: ScriProjection; output: Uint8Array }): ScriResult {
  const { projection, output } = input;
  if (output.length < projection.outBytes)
    throw new Error(`沙箱输出长度不足：${output.length} < ${projection.outBytes}`);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let events = 0;
  let doses = 0;
  const strata = projection.strataKeys.map((key, s) => {
    const riskEvents = view.getUint32(s * 12, true);
    const controlEvents = view.getUint32(s * 12 + 4, true);
    const stratumDoses = view.getUint32(s * 12 + 8, true);
    events += riskEvents + controlEvents;
    doses += stratumDoses;
    return { key, doses: stratumDoses, riskEvents, controlEvents };
  });
  if (events > projection.pairs)
    throw new Error(`沙箱输出不变量违反：窗口内事件 ${events} > 配对数 ${projection.pairs}`);
  if (doses !== projection.doses)
    throw new Error(`沙箱输出不变量违反：剂次合计 ${doses} ≠ 输入剂次 ${projection.doses}`);
  return { analysisType: 'vaccine-scri', windows: projection.windows, strata };
}

/**
 * 出域候选（C3）：只带每个分层的三项计数。`buckets[].count` 取风险期与对照期里**较小的非零值**——
 * 输出闸门按它判小单元格，任一格偏小整层即被抑制（宁可少发一层，不让小格漏出去）。
 * 不输出合计：合计减去未抑制分层就能反推被抑制的那层。
 */
export function scriPayload(result: ScriResult): Record<string, unknown> {
  return {
    analysisType: 'vaccine-scri',
    windows: result.windows,
    strata: result.strata.map((s) => ({ ...s })),
    buckets: result.strata.map((s) => {
      const nonZero = [s.riskEvents, s.controlEvents].filter((v) => v > 0);
      return { key: s.key, count: nonZero.length ? Math.min(...nonZero) : 0 };
    }),
  };
}

/** 参考语义（测试对拍用；执行路径走模块）。 */
export function scriReference(input: ScriInput): ScriResult {
  return scriCount(input);
}

export type { ScriEventRow, ScriRegistryRow };
