/**
 * 疫苗接种后不良事件 **自身对照风险期（SCRI）** —— 参考语义与模块编码（宿主侧）。
 *
 * 设计（药物警戒常用的自身对照设计）：只看**接种过、且发生过事件**的人自己，
 * 比较事件落在接种后「风险期」与「对照期」的次数。混杂（年龄、基础病等稳定因素）被自身对照抵消，
 * 不需要未接种人群。相对发生率 RI =（风险期事件 / 风险期天数）÷（对照期事件 / 对照期天数）。
 *
 * 两方数据：
 *  - 免疫规划（疾控）：`{subjectKey, vaccinationDate, vaccineCode, ageBand, sex}`，一剂一行；
 *  - 医院：`{subjectKey, eventDate, eventCode}`，一次事件一行。
 * `subjectKey` 是跨院关联假名；对齐在宿主（可信空间节点）内完成，模块只收数字列。
 *
 * 这份 TS 实现是**参考语义**：与 `modules/scri-as/assembly/scri.ts` 用同一组夹具对拍。
 */

export interface ScriRegistryRow {
  subjectKey: string;
  /** ISO 日期（`YYYY-MM-DD` 或完整时间戳）。 */
  vaccinationDate: string;
  vaccineCode: string;
  ageBand?: string;
  sex?: string;
}

export interface ScriEventRow {
  subjectKey: string;
  eventDate: string;
  eventCode: string;
}

export interface ScriWindows {
  /** 风险期（接种后第几天，闭区间）。 */
  risk: [number, number];
  /** 对照期（闭区间，不得与风险期重叠）。 */
  control: [number, number];
}

export interface ScriInput {
  registry: readonly ScriRegistryRow[];
  events: readonly ScriEventRow[];
  windows: ScriWindows;
  /** 只统计这些疫苗编码（空或缺省 = 全部）。 */
  vaccineCodes?: readonly string[];
  /** 只统计这些事件编码（空或缺省 = 全部）。 */
  eventCodes?: readonly string[];
  /** 固定分层顺序（缺省按出现过的 `ageBand|sex` 排序）。 */
  strataKeys?: readonly string[];
}

export interface ScriStratum {
  key: string;
  doses: number;
  riskEvents: number;
  controlEvents: number;
}

export interface ScriResult {
  analysisType: 'vaccine-scri';
  windows: ScriWindows;
  strata: ScriStratum[];
}

const DAY_MS = 86_400_000;

function dayNumber(value: string): number {
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(t)) throw new Error(`日期不可解析：${value}`);
  return Math.floor(t / DAY_MS);
}

export function assertWindows(windows: ScriWindows): void {
  const [r1, r2] = windows.risk;
  const [c1, c2] = windows.control;
  for (const v of [r1, r2, c1, c2])
    if (!Number.isInteger(v)) throw new Error('风险期 / 对照期必须是整数天');
  if (r1 > r2 || c1 > c2) throw new Error('窗口起点不得晚于终点');
  if (!(r2 < c1 || c2 < r1)) throw new Error('风险期与对照期不得重叠');
}

const stratumOf = (row: ScriRegistryRow): string => `${row.ageBand ?? 'all'}|${row.sex ?? 'all'}`;

export interface ScriEncoded {
  /** 「剂次 × 事件」配对的间隔天数。 */
  dayDiff: Int32Array;
  pairStratum: Uint8Array;
  doseStratum: Uint8Array;
  strataKeys: string[];
}

/** 宿主侧编码：对齐 + 过滤 + 日期差 + 分层编号。模块只拿到这些数字。 */
export function encodeScri(input: ScriInput): ScriEncoded {
  assertWindows(input.windows);
  const vaccines = new Set(input.vaccineCodes ?? []);
  const outcomes = new Set(input.eventCodes ?? []);
  const doses = input.registry.filter((r) => vaccines.size === 0 || vaccines.has(r.vaccineCode));
  const eventsBySubject = new Map<string, number[]>();
  for (const e of input.events) {
    if (outcomes.size > 0 && !outcomes.has(e.eventCode)) continue;
    const list = eventsBySubject.get(e.subjectKey) ?? [];
    list.push(dayNumber(e.eventDate));
    eventsBySubject.set(e.subjectKey, list);
  }

  const keys = input.strataKeys
    ? [...input.strataKeys]
    : [...new Set(doses.map(stratumOf))].sort();
  if (keys.length > 64) throw new Error('分层数超过 64');
  const index = new Map(keys.map((k, i) => [k, i]));

  const diffs: number[] = [];
  const pairStrata: number[] = [];
  const doseStrata: number[] = [];
  for (const dose of doses) {
    const s = index.get(stratumOf(dose));
    if (s === undefined) continue; // 固定分层之外的剂次不计
    doseStrata.push(s);
    const day = dayNumber(dose.vaccinationDate);
    for (const eventDay of eventsBySubject.get(dose.subjectKey) ?? []) {
      diffs.push(eventDay - day);
      pairStrata.push(s);
    }
  }
  return {
    dayDiff: Int32Array.from(diffs),
    pairStratum: Uint8Array.from(pairStrata),
    doseStratum: Uint8Array.from(doseStrata),
    strataKeys: keys,
  };
}

/** 参考语义：与模块逐字段一致。 */
export function scriCount(input: ScriInput): ScriResult {
  const enc = encodeScri(input);
  const [r1, r2] = input.windows.risk;
  const [c1, c2] = input.windows.control;
  const strata = enc.strataKeys.map((key) => ({ key, doses: 0, riskEvents: 0, controlEvents: 0 }));
  enc.dayDiff.forEach((d, i) => {
    const cell = strata[enc.pairStratum[i]];
    if (d >= r1 && d <= r2) cell.riskEvents++;
    else if (d >= c1 && d <= c2) cell.controlEvents++;
  });
  enc.doseStratum.forEach((s) => strata[s].doses++);
  return { analysisType: 'vaccine-scri', windows: input.windows, strata };
}
