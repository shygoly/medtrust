import {
  categoricalCount,
  encodeCategoricalCount,
  type CategoricalCountResult,
  type CategoricalCountRow,
} from '@medtrust/wasm-algorithms';

/**
 * **分类计数**的宿主适配（批次 2 / `mdop-rws-ladder-migration`）：把节点内解封后的投影装进
 * 分类计数模块的数字列 ABI，再把模块输出回填成 `rws.categorical-count@1` 载荷。
 *
 * 与 `distinct-count-sandbox.ts` 是同一套写法（投影 -> 沙箱 -> 回填 + 不变量校验），
 * 差别只有两处：
 *  1. 模块**计数出现次数**（不是去重主体）—— 这是旧链 L0/L1 三型的口径（design D6）；
 *  2. ABI 只有一列：`run(inOff, n, k, outOff)`，输入 `[category: u8[n]]`。
 *
 * 分类键文本一律留在宿主（模块只收编号），与主体键的处理原则一致。
 */

export interface CategoricalCountProjection {
  n: number;
  categories: number;
  categoryKeys: string[];
  input: Uint8Array;
  outOff: number;
  outBytes: number;
}

function align8(value: number): number {
  return (value + 7) & ~7;
}

/** 需要的内存字节数（宿主在调用模块**之前**按沙箱上限拒）。 */
export function categoricalCountRequiredBytes(input: {
  n: number;
  categories: number;
}): number {
  const outOff = align8(input.n);
  return outOff + 4 + 4 * input.categories;
}

/** 投影：投影行 -> 模块输入载荷（分类键由宿主映射成编号）。 */
export function projectCategoricalCount(input: {
  rows: readonly CategoricalCountRow[];
  categoryKeys?: readonly string[];
}): CategoricalCountProjection {
  const encoded = encodeCategoricalCount(input);
  const outOff = align8(encoded.n);
  return {
    n: encoded.n,
    categories: encoded.k,
    categoryKeys: encoded.categoryKeys,
    input: encoded.categories,
    outOff,
    outBytes: 4 + 4 * encoded.k,
  };
}

export function categoricalCountFromSandboxOutput(input: {
  projection: CategoricalCountProjection;
  output: Uint8Array;
}): CategoricalCountResult {
  const { projection, output } = input;
  const required = 4 + 4 * projection.categories;
  if (output.length < required)
    throw new Error(
      `沙箱输出长度不足：${output.length} < ${required}（分类数 ${projection.categories}）`,
    );
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const n = view.getUint32(0, true);
  if (n !== projection.n)
    throw new Error(`沙箱输出不变量违反：行数 ${n} != 输入行数 ${projection.n}`);
  const buckets = projection.categoryKeys.map((key, i) => {
    const count = view.getUint32(4 + i * 4, true);
    if (count > n)
      throw new Error(`沙箱输出不变量违反：分类 ${key} 的计数 ${count} > 行数 ${n}`);
    return { key, count };
  });
  // 计数口径的核心不变量：**各分类计数之和 = 行数**（每行恰好落进一个分类）。
  // 去重主体口径下这条不成立（同一人可落多层/多类）；分类计数口径下它必须成立，
  // 不成立说明模块或回填有一方错了，宁可失败也不出悄悄算错的数。
  const sum = buckets.reduce((acc, b) => acc + b.count, 0);
  if (sum !== n)
    throw new Error(`沙箱输出不变量违反：各分类计数之和 ${sum} != 行数 ${n}`);
  // 口径不变量保证「各桶之和 = 行数」，所以行数不必单独携带（消费方按和推导即可）。
  // 字段名用中性的 `rowCount`：新模块是新协议，不必背旧链的域词。
  return { analysisType: 'categorical-count', rowCount: n, buckets };
}

/**
 * 出域载荷（C3 候选）：只带分类计数，**没有主体键、没有行**。
 *
 * `recordCount` 是**记录数分母**（旧链 `cohortSize` 的对应物）：现患/不良事件两型里，一行可出多个分类，
 * 所以 `rowCount`（分类行数）不能替代它 —— 平台要复现旧链的 rate 就得有这个分母（对拍差异 B）。
 * 谁都知道自己数的是行还是记录，才不会把率算错。
 */
export function categoricalCountPayload(
  result: CategoricalCountResult,
  recordCount?: number,
): Record<string, unknown> {
  return {
    analysisType: 'categorical-count',
    rowCount: result.rowCount,
    ...(recordCount !== undefined ? { recordCount } : {}),
    buckets: result.buckets.map((b) => ({ key: b.key, count: b.count })),
  };
}
