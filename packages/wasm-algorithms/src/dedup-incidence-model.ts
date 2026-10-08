/**
 * 跨院去重的发病率与罕见病登记 —— 参考语义与模块编码（宿主侧）。
 *
 * 问题：同一患者常在多家医院留下记录（转诊/复查/异地就医）。各院记录直接相加会**重复计数**：
 * 发病率分子分母同时膨胀（虚假地区差异/时间趋势），罕见病把「1 例」变成「2 例」。
 *
 * 三件必须去重的东西（都在节点内做，各院只封最小投影）：
 *  1. **人头**：按关联假名取并集；
 *  2. **人时**：同一人的多段观察期取**区间并集**（重叠不得重复计人日；相邻段按开关合并）；
 *  3. **事件与罕见病**：事件按 `(主体, 编码, 日期)` 去重；罕见病按人计 1 例（首次诊断取最早）。
 *
 * 宿主契约（模块会校验，违反即返回 6）：三组列分别按
 * `(stratum, subject, startDay)` / `(stratum, subject, eventKey)` / `(stratum, subject)` **非降序**。
 *
 * 这份 TS 实现是**参考语义**：与 `modules/dedup-incidence-as/assembly/dedup-incidence.ts` 用同一组夹具对拍。
 */

export interface DedupObservationRow {
  subjectKey: string;
  ageBand?: string;
  sex?: string;
  /** 观察期起（ISO 日期）。 */
  start: string;
  /** 观察期止（ISO 日期，闭区间）。 */
  end: string;
}

export interface DedupEventRow {
  subjectKey: string;
  ageBand?: string;
  sex?: string;
  code: string;
  date: string;
}

export interface DedupRareRow {
  subjectKey: string;
  ageBand?: string;
  sex?: string;
  code: string;
  /** 首次诊断日期（多院重复时取最早）。 */
  firstDate: string;
}

export interface DedupIncidenceInput {
  observations: readonly DedupObservationRow[];
  events: readonly DedupEventRow[];
  rareDiseases: readonly DedupRareRow[];
  /** 研究窗口（闭区间）；给定时宿主在本地把观察期裁剪到窗口内、窗口外事件/罕见病剔除。 */
  window?: { start: string; end: string };
  /** 相邻观察期是否合并（相差 ≤ 1 天）；缺省 true。 */
  mergeAdjacent?: boolean;
  /** 只统计这些事件编码（空或缺省 = 全部）。 */
  eventCodes?: readonly string[];
  /** 只统计这些罕见病编码（空或缺省 = 全部）。 */
  rareCodes?: readonly string[];
  /** 固定分层顺序（缺省按出现过的 `ageBand|sex` 排序）。 */
  strataKeys?: readonly string[];
}

export interface DedupIncidenceStratum {
  key: string;
  /** 去重后人数（同一人在同一层只算一次）。 */
  uniqueSubjects: number;
  /** 观察期并集的人日数（重叠不重复计）。 */
  personDaysUnion: number;
  /** 去重后事件数（同一（主体, 编码, 日期）只算一次）。 */
  eventsDeduped: number;
  /** 去重后罕见病例数（同一人在同一层只算 1 例）。 */
  rareCases: number;
}

export interface DedupIncidenceResult {
  analysisType: 'dedup-incidence';
  mergeAdjacent: boolean;
  /** 是否裁剪到研究窗口。 */
  windowed: boolean;
  strata: DedupIncidenceStratum[];
}

const DAY_MS = 86_400_000;
export const DAYS_PER_YEAR = 365.25;

/** 内部工具：ISO 日期 → 天序号（不导出，避免与其它模型的同名工具冲突）。 */
function dayNumber(value: string): number {
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(t)) throw new Error(`日期不可解析：${value}`);
  return Math.floor(t / DAY_MS);
}

const keyOf = (row: { ageBand?: string; sex?: string }): string => `${row.ageBand ?? 'all'}|${row.sex ?? 'all'}`;

interface Normalized {
  strataKeys: string[];
  observations: { stratum: number; subject: string; start: number; end: number }[];
  events: { stratum: number; subject: string; eventKey: string }[];
  rare: { stratum: number; subject: string }[];
  mergeAdjacent: boolean;
  windowed: boolean;
}

/**
 * 归一化（列表语义，供参考实现使用）：窗口裁剪 → 白名单过滤 → 罕见病按（层, 主体）归并取最早 → 分层编号。
 *
 * 这是「宿主在节点内该做的事」的规范化描述；`encodeDedupIncidence` 在它之上再做
 * 主体/事件键的整数映射与排序，产出模块要的数字列。
 */
function normalize(input: DedupIncidenceInput): Normalized {
  const mergeAdjacent = input.mergeAdjacent ?? true;
  const events = new Set(input.eventCodes ?? []);
  const rares = new Set(input.rareCodes ?? []);
  const w = input.window
    ? { start: dayNumber(input.window.start), end: dayNumber(input.window.end) }
    : undefined;

  const keys = input.strataKeys
    ? [...input.strataKeys]
    : [
        ...new Set([
          ...input.observations.map(keyOf),
          ...input.events.map(keyOf),
          ...input.rareDiseases.map(keyOf),
        ]),
      ].sort();
  if (keys.length > 64) throw new Error('分层数超过 64');
  const index = new Map(keys.map((k, i) => [k, i]));

  const observations: Normalized['observations'] = [];
  for (const o of input.observations) {
    const s = index.get(keyOf(o));
    if (s === undefined) continue;
    let start = dayNumber(o.start);
    let end = dayNumber(o.end);
    if (start > end) throw new Error('观察期起点不得晚于终点');
    if (w) {
      start = Math.max(start, w.start);
      end = Math.min(end, w.end);
      if (start > end) continue; // 完全在窗口外
    }
    observations.push({ stratum: s, subject: o.subjectKey, start, end });
  }

  const evs: Normalized['events'] = [];
  for (const e of input.events) {
    const s = index.get(keyOf(e));
    if (s === undefined) continue;
    if (events.size > 0 && !events.has(e.code)) continue;
    const day = dayNumber(e.date);
    if (w && (day < w.start || day > w.end)) continue;
    evs.push({ stratum: s, subject: e.subjectKey, eventKey: `${e.code}\u0000${day}` });
  }

  // 罕见病：按（层, 主体）归并，首次诊断取最早
  const rareBySubject = new Map<string, { stratum: number; subject: string; first: number }>();
  for (const r of input.rareDiseases) {
    const s = index.get(keyOf(r));
    if (s === undefined) continue;
    if (rares.size > 0 && !rares.has(r.code)) continue;
    const first = dayNumber(r.firstDate);
    if (w && (first < w.start || first > w.end)) continue;
    const k = `${s}\u0000${r.subjectKey}`;
    const cur = rareBySubject.get(k);
    if (!cur || first < cur.first) rareBySubject.set(k, { stratum: s, subject: r.subjectKey, first });
  }

  return {
    strataKeys: keys,
    observations,
    events: evs,
    rare: [...rareBySubject.values()].map((r) => ({ stratum: r.stratum, subject: r.subject })),
    mergeAdjacent,
    windowed: w !== undefined,
  };
}

/** 参考语义：与模块逐字段一致（区间并集 + 事件去重 + 罕见病去重）。 */
export function dedupIncidenceCount(input: DedupIncidenceInput): DedupIncidenceResult {
  const n = normalize(input);
  const strata: DedupIncidenceStratum[] = n.strataKeys.map((key) => ({
    key,
    uniqueSubjects: 0,
    personDaysUnion: 0,
    eventsDeduped: 0,
    rareCases: 0,
  }));

  // 观察期：按（层, 主体）分组后做区间并集
  const bySubject = new Map<string, { stratum: number; intervals: [number, number][] }>();
  for (const o of n.observations) {
    const k = `${o.stratum}\u0000${o.subject}`;
    const cur = bySubject.get(k) ?? { stratum: o.stratum, intervals: [] };
    cur.intervals.push([o.start, o.end]);
    bySubject.set(k, cur);
  }
  for (const { stratum, intervals } of bySubject.values()) {
    strata[stratum].uniqueSubjects++;
    intervals.sort((a, b) => a[0] - b[0]);
    const gap = n.mergeAdjacent ? 2 : 1;
    let [curStart, curEnd] = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      const [s, e] = intervals[i];
      if (s <= curEnd + gap) curEnd = Math.max(curEnd, e);
      else {
        strata[stratum].personDaysUnion += curEnd - curStart + 1;
        [curStart, curEnd] = [s, e];
      }
    }
    strata[stratum].personDaysUnion += curEnd - curStart + 1;
  }

  const seenEvents = new Set<string>();
  for (const e of n.events) {
    const k = `${e.stratum}\u0000${e.subject}\u0000${e.eventKey}`;
    if (seenEvents.has(k)) continue;
    seenEvents.add(k);
    strata[e.stratum].eventsDeduped++;
  }

  for (const r of n.rare) strata[r.stratum].rareCases++;

  return { analysisType: 'dedup-incidence', mergeAdjacent: n.mergeAdjacent, windowed: n.windowed, strata };
}

export interface DedupIncidenceEncoded {
  nObs: number;
  nEvents: number;
  nRare: number;
  mergeAdjacent: 0 | 1;
  subjectObs: Uint32Array;
  stratumObs: Uint8Array;
  startDay: Int32Array;
  endDay: Int32Array;
  subjectEv: Uint32Array;
  stratumEv: Uint8Array;
  eventKey: Uint32Array;
  subjectRare: Uint32Array;
  stratumRare: Uint8Array;
  strataKeys: string[];
  /** 每列在内存里的相对偏移（相对 `inOff + 16`；宿主与测试按同一算法摆放）。 */
  layout: {
    subjectObs: number;
    stratumObs: number;
    startDay: number;
    endDay: number;
    subjectEv: number;
    stratumEv: number;
    eventKey: number;
    subjectRare: number;
    stratumRare: number;
    bytes: number;
  };
}

/** 主键映射：0 保留未用，从 1 开始编号（便于「0 = 无」在别处复用）。 */
function idMapper(): (key: string) => number {
  const map = new Map<string, number>();
  return (key: string): number => {
    const cur = map.get(key);
    if (cur !== undefined) return cur;
    const next = map.size + 1;
    map.set(key, next);
    return next;
  };
}

/**
 * 宿主侧编码：把归一化后的三张表映射为整数键、**排序**、写成模块要的数字列。
 *
 * 排序契约（模块会校验）：观察按 (层, 主体, 起) ／ 事件按 (层, 主体, 事件键) ／ 罕见病按 (层, 主体)。
 */
export function encodeDedupIncidence(input: DedupIncidenceInput): DedupIncidenceEncoded {
  const n = normalize(input);
  const subjectId = idMapper();
  const eventKeyId = idMapper();

  const obs = n.observations
    .map((o) => ({ ...o, sid: subjectId(o.subject) }))
    .sort((a, b) => a.stratum - b.stratum || a.sid - b.sid || a.start - b.start);
  const evs = n.events
    .map((e) => ({ ...e, sid: subjectId(e.subject), eid: eventKeyId(e.eventKey) }))
    .sort((a, b) => a.stratum - b.stratum || a.sid - b.sid || a.eid - b.eid);
  const rare = n.rare
    .map((r) => ({ ...r, sid: subjectId(r.subject) }))
    .sort((a, b) => a.stratum - b.stratum || a.sid - b.sid);

  const nObs = obs.length;
  const nEvents = evs.length;
  const nRare = rare.length;
  const align4 = (v: number): number => (v + 3) & ~3;
  const rel = {
    subjectObs: 0,
    stratumObs: 0,
    startDay: 0,
    endDay: 0,
    subjectEv: 0,
    stratumEv: 0,
    eventKey: 0,
    subjectRare: 0,
    stratumRare: 0,
    bytes: 0,
  };
  let off = 0;
  rel.subjectObs = off;
  off += nObs * 4;
  rel.stratumObs = off;
  off += nObs;
  off = align4(off);
  rel.startDay = off;
  off += nObs * 4;
  rel.endDay = off;
  off += nObs * 4;
  rel.subjectEv = off;
  off += nEvents * 4;
  rel.stratumEv = off;
  off += nEvents;
  off = align4(off);
  rel.eventKey = off;
  off += nEvents * 4;
  rel.subjectRare = off;
  off += nRare * 4;
  rel.stratumRare = off;
  off += nRare;
  rel.bytes = off;

  return {
    nObs,
    nEvents,
    nRare,
    mergeAdjacent: n.mergeAdjacent ? 1 : 0,
    subjectObs: Uint32Array.from(obs.map((o) => o.sid)),
    stratumObs: Uint8Array.from(obs.map((o) => o.stratum)),
    startDay: Int32Array.from(obs.map((o) => o.start)),
    endDay: Int32Array.from(obs.map((o) => o.end)),
    subjectEv: Uint32Array.from(evs.map((e) => e.sid)),
    stratumEv: Uint8Array.from(evs.map((e) => e.stratum)),
    eventKey: Uint32Array.from(evs.map((e) => e.eid)),
    subjectRare: Uint32Array.from(rare.map((r) => r.sid)),
    stratumRare: Uint8Array.from(rare.map((r) => r.stratum)),
    strataKeys: n.strataKeys,
    layout: rel,
  };
}

/** 粗发病率（每 10 万人年）。人日为 0 时返回 `null`（率不可估）。 */
export function incidenceRatePer100k(eventsDeduped: number, personDaysUnion: number): number | null {
  if (personDaysUnion <= 0) return null;
  return (eventsDeduped / (personDaysUnion / DAYS_PER_YEAR)) * 100_000;
}

function poissonCdf(k: number, lambda: number): number {
  // P(X ≤ k; λ)：逐项递推，k 在试点规模（数百）内数值稳定
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

/** CDF 在 λ 上单调递减 → 二分求 `f(λ) = target`。 */
function bisectDecreasing(f: (lambda: number) => number, target: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  while (b - a > 1e-10) {
    const mid = (a + b) / 2;
    if (f(mid) > target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/**
 * 事件数的 **Poisson 精确区间**（λ 的 95% 区间），返回 λ 区间；
 * 换算成率 = λ / 人年。`k = 0` 时下界为 0、上界 `−ln(α/2)`（精确）。
 *
 * 参考值（α = 0.05）：k = 0 → (0, 3.6889)；k = 1 → (0.0253, 5.5716)；k = 10 → (4.795, 18.390)。
 */
export function poissonExactCi(k: number, alpha = 0.05): { low: number; high: number } {
  if (!Number.isInteger(k) || k < 0) throw new Error('事件数必须是非负整数');
  if (!(alpha > 0 && alpha < 1)) throw new Error('alpha 必须落在 (0,1)');
  if (k === 0) return { low: 0, high: -Math.log(alpha / 2) };
  // 下界：解 P(X ≤ k−1; λ) = 1 − α/2
  const low = bisectDecreasing((l) => poissonCdf(k - 1, l), 1 - alpha / 2, 0, Math.max(k, 1));
  // 上界：解 P(X ≤ k; λ) = α/2（先扩上界直到 CDF 掉到目标之下）
  let hi = Math.max(k + 1, 1);
  while (poissonCdf(k, hi) > alpha / 2) hi *= 2;
  const high = bisectDecreasing((l) => poissonCdf(k, l), alpha / 2, 0, hi);
  return { low, high };
}

/** 发病率的 95% 精确区间（每 10 万人年）；人日为 0 时返回 `null`。 */
export function incidenceRateCiPer100k(
  eventsDeduped: number,
  personDaysUnion: number,
  alpha = 0.05,
): { low: number; high: number } | null {
  if (personDaysUnion <= 0) return null;
  const years = personDaysUnion / DAYS_PER_YEAR;
  const { low, high } = poissonExactCi(eventsDeduped, alpha);
  return { low: (low / years) * 100_000, high: (high / years) * 100_000 };
}
