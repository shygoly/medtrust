/**
 * **配对算子的参考语义**（Q4 首选场景：跨院队列交集，协议 §4.5.2(1)）。
 *
 * 为什么放在这里：这条语义有**两份实现**——Wasm 模块（`modules/pairing-as`）与
 * 节点里的 TS 调用路径。两份实现漂移 = 「节点内配对」这件事说不清，所以参考语义与
 * 模块的源码放在同一个包里，两者用**同一组夹具做对拍**（`scripts/pairing-parity.test.mjs`）。
 *
 * 语义（与协议 §4.5.2 的例子一致）：
 *  ① **求交**：只有**每一方都出现**的主体才进入结果；只在一方出现的行不能进分子/分母
 *    （否则「A 院独有的暴露者」会被算进 B 院的结局里，那正是没有可对齐标识符时的错误做法）。
 *  ② 暴露 / 结局按「任一方登记过即为真」合并。
 *  ③ 分层由调用方给出（`stratify`），配对与分层都在**节点内**完成。
 *
 * 数据对齐（跨院 PSI 还是全空间共享盐）**不在本语义里**：它是数据侧的选择，
 * 只要各方给出的 `subjectKey` 可对齐，本语义就成立——因此模块的 ABI 也是**决策中立**的。
 */

export interface PseudonymRow {
  /** **可对齐**的主体假名键（跨持有方同一主体必须相同；由共享盐或跨院 PSI 对齐）。 */
  subjectKey: string;
  exposure: boolean;
  outcome: boolean;
  ageBand?: string;
  sex?: string;
}

export interface PairPartyTable {
  /** 数据持有方标识（URN）。 */
  node: string;
  rows: PseudonymRow[];
}

export interface PairStrata {
  ageBand?: readonly string[];
  sex?: readonly string[];
}

export interface PairCell {
  key: string;
  exposed: number;
  outcome: number;
  exposedWithOutcome: number;
  cohortSize: number;
  rate: number;
}

export interface PairResult {
  analysisType: "paired-cohort";
  /** 参与配对的主体总数（配对后的交集规模）。 */
  cohortSize: number;
  exposed: number;
  outcome: number;
  exposedWithOutcome: number;
  rate: number;
  strata: PairCell[];
  parties: string[];
}

/** 节点内配对：按 `subjectKey` 求交，暴露/结局按「任一方为真即为真」合并。 */
export function pairIntersection(input: {
  tables: readonly PairPartyTable[];
  stratify?: PairStrata;
}): PairResult {
  if (input.tables.length < 2)
    throw new Error("E_RUNTIME: 跨主体配对至少需要两方的表（单方配对没有意义）");

  const presence = new Map<string, Set<number>>();
  const merged = new Map<string, PseudonymRow>();
  for (const [index, table] of input.tables.entries()) {
    for (const row of table.rows) {
      if (!row.subjectKey)
        throw new Error("E_RUNTIME: 主体键缺失——未对齐的假名键不允许参与配对");
      const seen = presence.get(row.subjectKey) ?? new Set<number>();
      seen.add(index);
      presence.set(row.subjectKey, seen);
      const prev = merged.get(row.subjectKey);
      if (!prev) {
        merged.set(row.subjectKey, { ...row });
        continue;
      }
      prev.exposure = prev.exposure || row.exposure;
      prev.outcome = prev.outcome || row.outcome;
      prev.ageBand = prev.ageBand ?? row.ageBand;
      prev.sex = prev.sex ?? row.sex;
    }
  }

  const rows = [...merged.entries()]
    .filter(([key]) => presence.get(key)?.size === input.tables.length)
    .map(([, row]) => row)
    .sort((a, b) => (a.subjectKey < b.subjectKey ? -1 : 1));
  const inStrata = (row: PseudonymRow): boolean => {
    const age = input.stratify?.ageBand;
    const sex = input.stratify?.sex;
    if (age && !(row.ageBand !== undefined && age.includes(row.ageBand))) return false;
    if (sex && !(row.sex !== undefined && sex.includes(row.sex))) return false;
    return true;
  };

  const kept = rows.filter(inStrata);
  const exposed = kept.filter((r) => r.exposure).length;
  const outcome = kept.filter((r) => r.outcome).length;
  const both = kept.filter((r) => r.exposure && r.outcome).length;

  const strata = new Map<string, PseudonymRow[]>();
  for (const row of kept) {
    const key = `${row.ageBand ?? "all"}|${row.sex ?? "all"}`;
    strata.set(key, [...(strata.get(key) ?? []), row]);
  }

  return {
    analysisType: "paired-cohort",
    cohortSize: kept.length,
    exposed,
    outcome,
    exposedWithOutcome: both,
    rate: exposed === 0 ? 0 : both / exposed,
    parties: input.tables.map((t) => t.node).sort(),
    strata: [...strata.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, group]) => {
        const e = group.filter((r) => r.exposure).length;
        const o = group.filter((r) => r.outcome).length;
        const b = group.filter((r) => r.exposure && r.outcome).length;
        return {
          key,
          exposed: e,
          outcome: o,
          exposedWithOutcome: b,
          cohortSize: group.length,
          rate: e === 0 ? 0 : b / e,
        };
      }),
  };
}

/**
 * C3 聚合出域的**不可判定区间**：只知道两方的边际计数时，交集只能被限定在一个区间里。
 *
 * `n` 为两方的并集规模，`a`/`b` 为两方各自的计数，则交集 ∈ `[max(0, a+b−n), min(a,b)]`。
 * 区间宽度 > 0 时，任何仅由边际量构成的函数都无法确定交集——
 * **聚合出域不是精度不够，而是信息不存在**。
 */
export function joinableBounds(input: {
  a: number;
  b: number;
  union: number;
}): { lower: number; upper: number; width: number } {
  const lower = Math.max(0, input.a + input.b - input.union);
  const upper = Math.min(input.a, input.b);
  return { lower, upper, width: upper - lower };
}

/**
 * 把各方行**编码成模块 ABI 需要的数字列**（决策中立的落点）。
 *
 * 模块只看数字：全空间主体按 `subjectKey` 排序去重后取下标，
 * `present[i*P+p]` 表示第 p 方是否持有第 i 个主体；`exposure/outcome` 取「或」；
 * `stratum[i]` 是分层编号（由调用方映射，模块不知道分层含义）。
 *
 * 这样写的好处：无论假名键是靠全空间共享盐还是跨院 PSI 对齐的，**模块一行不改**——
 * 它只认「已经对齐的下标与标志」。
 */
export interface ModuleInput {
  parties: number;
  subjects: number;
  present: Uint8Array;
  exposure: Uint8Array;
  outcome: Uint8Array;
  stratum: Uint8Array;
  strataKeys: string[];
  subjectKeys: string[];
}

export function encodeForModule(input: {
  tables: readonly PairPartyTable[];
  /** 分层取值列表（顺序即模块收到的分层编号 0..k-1）。 */
  strataKeys: readonly string[];
}): ModuleInput {
  const parties = input.tables.length;
  const merged = new Map<string, PseudonymRow>();
  const presentByKey = new Map<string, Set<number>>();
  for (const [p, table] of input.tables.entries()) {
    for (const row of table.rows) {
      const seen = presentByKey.get(row.subjectKey) ?? new Set<number>();
      seen.add(p);
      presentByKey.set(row.subjectKey, seen);
      const prev = merged.get(row.subjectKey);
      if (!prev) merged.set(row.subjectKey, { ...row });
      else {
        prev.exposure = prev.exposure || row.exposure;
        prev.outcome = prev.outcome || row.outcome;
        prev.ageBand = prev.ageBand ?? row.ageBand;
        prev.sex = prev.sex ?? row.sex;
      }
    }
  }
  const subjectKeys = [...merged.keys()].sort();
  const subjects = subjectKeys.length;
  const present = new Uint8Array(subjects * parties);
  const exposure = new Uint8Array(subjects);
  const outcome = new Uint8Array(subjects);
  const stratum = new Uint8Array(subjects);
  subjectKeys.forEach((key, i) => {
    const row = merged.get(key)!;
    for (const p of presentByKey.get(key) ?? []) present[i * parties + p] = 1;
    exposure[i] = row.exposure ? 1 : 0;
    outcome[i] = row.outcome ? 1 : 0;
    const stratumKey = `${row.ageBand ?? "all"}|${row.sex ?? "all"}`;
    const idx = input.strataKeys.indexOf(stratumKey);
    stratum[i] = idx >= 0 ? idx : 0;
  });
  return {
    parties,
    subjects,
    present,
    exposure,
    outcome,
    stratum,
    strataKeys: [...input.strataKeys],
    subjectKeys,
  };
}
