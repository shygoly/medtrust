/**
 * **去重人数**的参考语义（C2 T6：按分层统计 distinct subject count）。
 *
 * 为什么放在这里：这条语义有**两份实现**——Wasm 模块（`modules/distinct-count-as`）
 * 与节点里的 TS 调用路径。两份实现漂移 = 「节点内去重」这件事说不清，所以参考
 * 语义与模块源码放在同一个包里，两者用**同一组夹具做对拍**
 * （`scripts/distinct-count-parity.test.mjs`）。
 *
 * 数据对齐与分层映射**不在本语义里**：宿主把主体键 / 分层键映成数字列，
 * 模块只认数字——与配对模块的「数字列 ABI」同一口径。
 */

export interface DistinctCountRow {
  /** 可对齐的主体假名键（同一主体必须相同）。 */
  subjectKey: string;
  ageBand?: string;
  sex?: string;
  /** 显式分层键；缺省用 `ageBand|sex`。 */
  stratumKey?: string;
}

export interface DistinctCountCell {
  key: string;
  distinct: number;
}

export interface DistinctCountResult {
  analysisType: "distinct-count";
  /** 全体去重主体数（跨分层取并）。 */
  totalDistinct: number;
  strata: DistinctCountCell[];
}

export function stratumKeyOf(row: DistinctCountRow): string {
  if (row.stratumKey) return row.stratumKey;
  return `${row.ageBand ?? "all"}|${row.sex ?? "all"}`;
}

/** 按分层统计去重主体数；全体去重是各分层主体的并。 */
export function distinctCount(input: {
  rows: readonly DistinctCountRow[];
  strataKeys?: readonly string[];
}): DistinctCountResult {
  const strataKeys = [...(input.strataKeys ?? defaultStrataKeys(input.rows))];
  const total = new Set<string>();
  const byStratum = new Map<string, Set<string>>(
    strataKeys.map((key) => [key, new Set<string>()]),
  );
  for (const row of input.rows) {
    if (!row.subjectKey)
      throw new Error("E_RUNTIME: 主体键缺失——未对齐的假名键不允许参与去重");
    total.add(row.subjectKey);
    const key = stratumKeyOf(row);
    const bucket = byStratum.get(key);
    if (bucket) bucket.add(row.subjectKey);
  }
  return {
    analysisType: "distinct-count",
    totalDistinct: total.size,
    strata: strataKeys.map((key) => ({
      key,
      distinct: byStratum.get(key)?.size ?? 0,
    })),
  };
}

export interface DistinctCountModuleInput {
  subjects: number;
  strata: number;
  subjectIds: Uint32Array;
  stratum: Uint8Array;
  strataKeys: string[];
  subjectKeys: string[];
}

/**
 * 把行编码成模块 ABI 需要的数字列（决策中立的落点）。
 *
 * 模块只看数字：主体按 `subjectKey` 排序去重后取下标，分层按调用方给出的
 * 键列表编号。无论假名键怎么对齐，**模块一行不改**。
 */
export function encodeDistinctCount(input: {
  rows: readonly DistinctCountRow[];
  strataKeys?: readonly string[];
}): DistinctCountModuleInput {
  const strataKeys = [...(input.strataKeys ?? defaultStrataKeys(input.rows))];
  for (const row of input.rows) {
    if (!row.subjectKey)
      throw new Error("E_RUNTIME: 主体键缺失——未对齐的假名键不允许参与去重");
  }
  const subjectKeys = [...new Set(input.rows.map((row) => row.subjectKey))].sort();
  const idOf = new Map(subjectKeys.map((key, i) => [key, i]));
  const n = input.rows.length;
  const subjectIds = new Uint32Array(n);
  const stratum = new Uint8Array(n);
  input.rows.forEach((row, i) => {
    subjectIds[i] = idOf.get(row.subjectKey) ?? 0;
    const idx = strataKeys.indexOf(stratumKeyOf(row));
    stratum[i] = idx >= 0 ? idx : 0;
  });
  return {
    subjects: n,
    strata: strataKeys.length,
    subjectIds,
    stratum,
    strataKeys,
    subjectKeys,
  };
}

function defaultStrataKeys(rows: readonly DistinctCountRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) keys.add(stratumKeyOf(row));
  return [...keys].sort();
}
