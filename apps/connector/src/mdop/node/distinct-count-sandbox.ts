import {
  distinctCount,
  encodeDistinctCount,
  type DistinctCountResult,
  type DistinctCountRow,
} from '@medtrust/wasm-algorithms';

/**
 * 按分层**去重人数**的宿主适配（C2 T6）：把节点内解封后的投影装进去重模块的
 * 数字列 ABI，再把模块输出回填成 `rws.distinct-count@1` 载荷。
 *
 * 与 `pairing-sandbox.ts` 是同一套写法（投影 → 沙箱 → 回填 + 不变量校验），
 * 差别只有 ABI 形状：去重模块是 `run(inOff, n, k, outOff)`（4 参，k = 分层数），
 * 因此调用时必须在请求里明确 `abi: 'distinct-count@1'`——**沙箱不认识模块语义，
 * 但必须认识调用形状**。
 *
 * 两处刻意留在宿主一侧（**不进模块、不进沙箱内存里的字符串**）：
 *  ① **主体键**：模块只认「已对齐的下标」，键文本留在宿主；
 *  ② **分层键**：`ageBand|sex` → 分层编号的映射在宿主，模块只收编号。
 */

export interface DistinctCountProjection {
  subjects: number;
  strata: number;
  strataKeys: string[];
  input: Uint8Array;
  outOff: number;
  outBytes: number;
  subjectKeys: string[];
}

function align8(value: number): number {
  return (value + 7) & ~7;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

/** 需要的内存字节数（宿主在调用模块**之前**按沙箱上限拒）。 */
export function distinctCountRequiredBytes(input: {
  subjects: number;
  strata: number;
}): number {
  const inBytes = input.subjects * 5;
  const scratchOff = align8(inBytes);
  const outOff = align4(scratchOff + input.subjects * 8);
  return outOff + 4 + 4 * input.strata;
}

/** 投影：对齐后的行 → 模块输入载荷。对齐本身由数据侧负责。 */
export function projectDistinctCount(input: {
  rows: readonly DistinctCountRow[];
  strataKeys?: readonly string[];
}): DistinctCountProjection {
  const encoded = encodeDistinctCount(input);
  const n = encoded.subjects;
  const inputBytes = new Uint8Array(n * 4 + n);
  inputBytes.set(new Uint8Array(encoded.subjectIds.buffer), 0);
  inputBytes.set(encoded.stratum, n * 4);
  const scratchOff = align8(inputBytes.length);
  const outOff = align4(scratchOff + n * 8);
  return {
    subjects: n,
    strata: encoded.strata,
    strataKeys: encoded.strataKeys,
    input: inputBytes,
    outOff,
    outBytes: 4 + 4 * encoded.strata,
    subjectKeys: encoded.subjectKeys,
  };
}

export function distinctCountFromSandboxOutput(input: {
  projection: DistinctCountProjection;
  output: Uint8Array;
}): DistinctCountResult {
  const { projection, output } = input;
  const required = 4 + 4 * projection.strata;
  if (output.length < required)
    throw new Error(`沙箱输出长度不足：${output.length} < ${required}（分层数 ${projection.strata}）`);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const totalDistinct = view.getUint32(0, true);
  if (totalDistinct > projection.subjectKeys.length)
    throw new Error(
      `沙箱输出不变量违反：全体去重 ${totalDistinct} > 主体种类 ${projection.subjectKeys.length}`,
    );
  const strata = projection.strataKeys.map((key, s) => {
    const distinct = view.getUint32(4 + s * 4, true);
    if (distinct > totalDistinct)
      throw new Error(`沙箱输出不变量违反：分层 ${key} 的去重 ${distinct} > 全体 ${totalDistinct}`);
    return { key, distinct };
  });
  return { analysisType: 'distinct-count', totalDistinct, strata };
}

/** 出域载荷（C3 候选）：只带聚合量，**没有主体键、没有行**。 */
export function distinctCountPayload(result: DistinctCountResult): Record<string, unknown> {
  return {
    analysisType: 'distinct-count',
    totalDistinct: result.totalDistinct,
    strata: result.strata.map((s) => ({ key: s.key, distinct: s.distinct })),
    buckets: result.strata.map((s) => ({ key: s.key, count: s.distinct })),
  };
}

/** 参考语义（测试对拍用；执行路径走模块，不走这份）。 */
export function distinctCountReference(input: {
  rows: readonly DistinctCountRow[];
  strataKeys?: readonly string[];
}): DistinctCountResult {
  return distinctCount(input);
}
