/**
 * 通用**分类计数**模块的 TS 参考实现（批次 2 / `mdop-rws-ladder-migration` design D6）。
 *
 * 为什么需要它：旧链的 L0/L1 三型（`cohort-count` / `condition-prevalence` / `adverse-event-signal`）
 * 其实是同一件事 ——「按某个分类字段**计数出现次数**」，产物同形 `{ rowCount, buckets: [{key,count,rate}] }`。
 * MDOP 里原有的 `distinct-count` 数的是**去重主体**，与旧口径不同；与其悄悄换口径，不如把旧口径原样搬进来。
 *
 * 与旧链的对应：`cohort-count` 的分类字段是 `ageBand`、`condition-prevalence` 是 `conditions[]` 的每个标签、
 * `adverse-event-signal` 是 `adverseEvents[].organSystem`（一行多值各计一次）。三者都复用本模块。
 *
 * 模块只输出**计数**；`rate` 与排序属呈现口径，由平台侧按 `count / rowCount` 与需要排序计算
 * （保持模块最小：不做与语义无关的事）。
 */

export interface CategoricalCountRow {
  /** 分类键（宿主已把原始字段映射到这个键）。 */
  category: string;
}

export interface CategoricalCountCell {
  key: string;
  count: number;
}

export interface CategoricalCountResult {
  analysisType: "categorical-count";
  /** 参与计数的行数（旧链的 `cohort.length`，不是去重主体数）。 */
  rowCount: number;
  buckets: CategoricalCountCell[];
}

/** 参考语义：逐行按分类键计数（**不去重**）。 */
export function categoricalCount(input: {
  categoryKeys: readonly string[];
  categories: readonly number[];
}): CategoricalCountResult {
  const counts = new Array<number>(input.categoryKeys.length).fill(0);
  for (const idx of input.categories) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= input.categoryKeys.length)
      throw new Error(`E_RUNTIME: 分类下标越界：${idx}`);
    counts[idx] += 1;
  }
  return {
    analysisType: "categorical-count",
    rowCount: input.categories.length,
    buckets: input.categoryKeys.map((key, i) => ({ key, count: counts[i] })),
  };
}

export interface CategoricalCountModuleInput {
  n: number;
  k: number;
  categories: Uint8Array;
  categoryKeys: string[];
}

/** 把行编码成模块 ABI 需要的数字列（分类键 -> 下标，由宿主映射）。 */
export function encodeCategoricalCount(input: {
  rows: readonly CategoricalCountRow[];
  categoryKeys?: readonly string[];
}): CategoricalCountModuleInput {
  const categoryKeys = [
    ...(input.categoryKeys ?? [...new Set(input.rows.map((r) => r.category))].sort()),
  ];
  if (categoryKeys.length === 0) throw new Error("E_RUNTIME: 分类键列表为空");
  if (categoryKeys.length > 64) throw new Error("E_RUNTIME: 分类数超过 64（ABI u8 下标上限）");
  const indexOf = new Map(categoryKeys.map((key, i) => [key, i]));
  const categories = new Uint8Array(input.rows.length);
  input.rows.forEach((row, i) => {
    const idx = indexOf.get(row.category);
    if (idx === undefined)
      throw new Error(`E_RUNTIME: 分类键不在给定列表里：${row.category}`);
    categories[i] = idx;
  });
  return { n: input.rows.length, k: categoryKeys.length, categories, categoryKeys };
}
