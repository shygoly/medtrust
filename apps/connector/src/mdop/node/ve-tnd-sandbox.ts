import {
  encodeVeTnd,
  veTndCount,
  type VeTndInput,
  type VeTndResult,
} from '@medtrust/wasm-algorithms';

/**
 * 疫苗真实世界保护效果（检测阴性设计）的宿主适配：把节点内解封后的两方投影
 * （疾控接种 + 医院检测）装进 `ve-tnd` 模块的数字列 ABI，再把模块输出回填成 `rws.ve-tnd@1` 载荷。
 *
 * 与 `scri-sandbox.ts` 同一套写法（投影 → 沙箱 → 回填 + 不变量校验）。ABI 是 4 参
 * `run(inOff, n, k, outOff)`，头部 4 字节放免疫建立期天数，因此调用时显式给 `abi: 've-tnd@1'`。
 *
 * 留在宿主、**不进模块**的东西：主体键（关联假名）、日期与编码文本、分层键文本。
 * 模块只按 `gapDays` 分格：`≥ immuneDays` 已接种 / `0..immuneDays-1` 部分免疫 / 哨兵 未接种。
 */

export interface VeTndProjection {
  tests: number;
  strata: number;
  strataKeys: string[];
  immuneDays: number;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
}

function align8(value: number): number {
  return (value + 7) & ~7;
}

const HEADER = 4;
const CELL_BYTES = 24; // 每层 6 个 u32

/** 需要的内存字节数（宿主在调用模块**之前**按沙箱上限拒）。 */
export function veTndRequiredBytes(input: { tests: number; strata: number }): number {
  return align8(HEADER + input.tests * 6) + CELL_BYTES * input.strata;
}

/** 投影：纳入的检测行 → 模块输入载荷（宿主已完成按人对齐与免疫间隔计算）。 */
export function projectVeTnd(input: VeTndInput): VeTndProjection {
  const enc = encodeVeTnd(input);
  const n = enc.gapDays.length;
  const bytes = new Uint8Array(HEADER + n * 6);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, enc.immuneDays, true);
  bytes.set(
    new Uint8Array(enc.gapDays.buffer, enc.gapDays.byteOffset, enc.gapDays.byteLength),
    HEADER,
  );
  bytes.set(enc.result, HEADER + n * 4);
  bytes.set(enc.testStratum, HEADER + n * 5);
  return {
    tests: n,
    strata: enc.strataKeys.length,
    strataKeys: enc.strataKeys,
    immuneDays: enc.immuneDays,
    input: bytes,
    outOff: align8(bytes.length),
    outBytes: CELL_BYTES * enc.strataKeys.length,
  };
}

/**
 * 模块输出 → 结果，并校验不变量：**每层六格之和必须等于纳入的检测数**。
 *
 * 这条不变量是「模块只做计数」的兜底：任何一格被漏掉或重复计入都会让合计对不上，
 * 此时宁可整阶段失败，也不把算错的计数交到发布审查。
 */
export function veTndFromSandboxOutput(input: {
  projection: VeTndProjection;
  output: Uint8Array;
}): VeTndResult {
  const { projection, output } = input;
  if (output.length < projection.outBytes)
    throw new Error(`沙箱输出长度不足：${output.length} < ${projection.outBytes}`);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let total = 0;
  const strata = projection.strataKeys.map((key, s) => {
    const vaccPos = view.getUint32(s * CELL_BYTES, true);
    const vaccNeg = view.getUint32(s * CELL_BYTES + 4, true);
    const unvaccPos = view.getUint32(s * CELL_BYTES + 8, true);
    const unvaccNeg = view.getUint32(s * CELL_BYTES + 12, true);
    const partialPos = view.getUint32(s * CELL_BYTES + 16, true);
    const partialNeg = view.getUint32(s * CELL_BYTES + 20, true);
    total += vaccPos + vaccNeg + unvaccPos + unvaccNeg + partialPos + partialNeg;
    return { key, vaccPos, vaccNeg, unvaccPos, unvaccNeg, partialPos, partialNeg };
  });
  if (total !== projection.tests)
    throw new Error(
      `沙箱输出不变量违反：六格合计 ${total} ≠ 纳入检测数 ${projection.tests}`,
    );
  return { analysisType: 'vaccine-tnd', immuneDays: projection.immuneDays, strata };
}

/**
 * 出域候选（C3）：只带每个分层的六个计数。
 *
 * `buckets[].count` 取**四个主分析格**（已接种/未接种 × 阳性/阴性）里较小的非零值——
 * 输出闸门按它判小单元格，任一格偏小整层即被抑制。部分免疫两格单列（审计用），
 * 不参与主分析的抑制判据，但**一并受闸门约束**（不许绕开闸门单独出）。
 * 不输出合计：合计减去未抑制分层就能反推被抑制的那层。
 */
export function veTndPayload(result: VeTndResult): Record<string, unknown> {
  return {
    analysisType: 'vaccine-tnd',
    immuneDays: result.immuneDays,
    strata: result.strata.map((s) => ({ ...s })),
    buckets: result.strata.map((s) => {
      const nonZero = [s.vaccPos, s.vaccNeg, s.unvaccPos, s.unvaccNeg].filter((v) => v > 0);
      return { key: s.key, count: nonZero.length ? Math.min(...nonZero) : 0 };
    }),
  };
}

/** 参考语义（测试对拍用；执行路径走模块）。 */
export function veTndReference(input: VeTndInput): VeTndResult {
  return veTndCount(input);
}
