/**
 * 疫苗真实世界保护效果（检测阴性设计 TND）—— 参考语义与模块编码（宿主侧）。
 *
 * 设计（TND，疫苗有效性观察性研究的通行做法）：只在「因目标病就诊并做了检测」的人内比较
 * 接种状态与检测结果，VE = 1 − OR。阳性与阴性两组都已就医，**就医倾向被对齐**，
 * 避免了用全人群做分母时最常见的就医行为混杂。
 *
 * 两方数据：
 *  - 疾控（免疫规划）：`{subjectKey, vaccinationDate, vaccineCode, doseNo?}`，一剂一行；
 *  - 医院：`{subjectKey, testDate, pathogenCode, result, ageBand?, sex?}`，一次检测一行。
 * `subjectKey` 是跨机构关联假名；对齐在宿主（可信空间节点）内完成，模块只收数字列。
 *
 * 免疫状态判定（在节点内、由宿主编码完成，模块只按间隔天数分格）：
 *  - `gap = 检测日 − 检测日前最后一剂接种日`；无接种记录 → `NO_DOSE`（i32 最小值）；
 *  - `gap ≥ immuneDays`（默认 14）→ 已接种；`0 ≤ gap < immuneDays` → 部分免疫（单列，不入主分析）；
 *  - `gap < 0`（检测发生在该剂之前）→ 未接种。
 *
 * 这份 TS 实现是**参考语义**：与 `modules/ve-tnd-as/assembly/ve-tnd.ts` 用同一组夹具对拍。
 */

export type VeTndTestResult = 'pos' | 'neg';

export interface VeTndDoseRow {
  subjectKey: string;
  /** ISO 日期（`YYYY-MM-DD` 或完整时间戳）。 */
  vaccinationDate: string;
  vaccineCode: string;
  /** 剂次序号（1 = 首剂）；仅用于宿主分层，不参与免疫状态判定。 */
  doseNo?: number;
}

export interface VeTndTestRow {
  subjectKey: string;
  /** 检测日期（ISO）。 */
  testDate: string;
  pathogenCode: string;
  result: VeTndTestResult;
  ageBand?: string;
  sex?: string;
}

export interface VeTndInput {
  doses: readonly VeTndDoseRow[];
  tests: readonly VeTndTestRow[];
  /** 免疫建立期天数（≥1，缺省 14）。 */
  immuneDays?: number;
  /** 只统计这些疫苗编码（空或缺省 = 全部）。 */
  vaccineCodes?: readonly string[];
  /** 只统计这些病原检测编码（空或缺省 = 全部）。 */
  pathogenCodes?: readonly string[];
  /** 固定分层顺序（缺省按出现过的 `ageBand|sex` 排序）。 */
  strataKeys?: readonly string[];
}

export interface VeTndStratum {
  key: string;
  vaccPos: number;
  vaccNeg: number;
  unvaccPos: number;
  unvaccNeg: number;
  /** 部分免疫（接种后不足免疫建立期）——单列，**不计入主分析**，但必须输出以便审计。 */
  partialPos: number;
  partialNeg: number;
}

export interface VeTndResult {
  analysisType: 'vaccine-tnd';
  immuneDays: number;
  strata: VeTndStratum[];
}

const DAY_MS = 86_400_000;
export const DEFAULT_IMMUNE_DAYS = 14;
/** 与模块约定的哨兵：i32 最小值 = 该人检测日前无目标疫苗接种记录。 */
export const NO_DOSE = -2147483648;

export function dayNumber(value: string): number {
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(t)) throw new Error(`日期不可解析：${value}`);
  return Math.floor(t / DAY_MS);
}

export function assertImmuneDays(immuneDays: number): void {
  if (!Number.isInteger(immuneDays) || immuneDays < 1)
    throw new Error('免疫建立期必须是 ≥1 的整数天');
}

const stratumOf = (row: VeTndTestRow): string => `${row.ageBand ?? 'all'}|${row.sex ?? 'all'}`;

export interface VeTndEncoded {
  immuneDays: number;
  /** 每次检测的 `检测日 − 检测日前最后一剂接种日`（`NO_DOSE` = 无接种记录）。 */
  gapDays: Int32Array;
  /** 1 = 阳性，0 = 阴性。 */
  result: Uint8Array;
  testStratum: Uint8Array;
  strataKeys: string[];
}

/**
 * 宿主侧编码：按人对齐 + 纳入去重 + 免疫间隔 + 分层编号。模块只拿到这些数字。
 *
 * 纳入规则：
 *  1. 疫苗编码、病原编码按白名单过滤（空集合 = 不过滤）；
 *  2. 同一 `(subjectKey, testDate)` 的重复检测**只取首条**（同一次就诊的重复检测不得重复计数）；
 *  3. 分层键取自**医院侧检测行**（`ageBand|sex`）；缺失即 `all|all` ——
 *     分层键 MUST 由数据持有方本地补全，节点内不得用明文回填（design D4）。
 */
export function encodeVeTnd(input: VeTndInput): VeTndEncoded {
  const immuneDays = input.immuneDays ?? DEFAULT_IMMUNE_DAYS;
  assertImmuneDays(immuneDays);
  const vaccines = new Set(input.vaccineCodes ?? []);
  const pathogens = new Set(input.pathogenCodes ?? []);

  // 每个主体的接种日（升序），只保留白名单内疫苗
  const dosesBySubject = new Map<string, number[]>();
  for (const d of input.doses) {
    if (vaccines.size > 0 && !vaccines.has(d.vaccineCode)) continue;
    const list = dosesBySubject.get(d.subjectKey) ?? [];
    list.push(dayNumber(d.vaccinationDate));
    dosesBySubject.set(d.subjectKey, list);
  }
  for (const list of dosesBySubject.values()) list.sort((a, b) => a - b);

  // 纳入的检测（按 (subjectKey, testDate) 去重，保首条）
  const seen = new Set<string>();
  const included: { row: VeTndTestRow; testDay: number }[] = [];
  for (const t of input.tests) {
    if (pathogens.size > 0 && !pathogens.has(t.pathogenCode)) continue;
    const key = `${t.subjectKey}\u0000${t.testDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    included.push({ row: t, testDay: dayNumber(t.testDate) });
  }

  const keys = input.strataKeys
    ? [...input.strataKeys]
    : [...new Set(included.map((x) => stratumOf(x.row)))].sort();
  if (keys.length > 64) throw new Error('分层数超过 64');
  const index = new Map(keys.map((k, i) => [k, i]));

  const gapDays: number[] = [];
  const result: number[] = [];
  const testStratum: number[] = [];
  for (const { row, testDay } of included) {
    const s = index.get(stratumOf(row));
    if (s === undefined) continue; // 固定分层之外的检测不计
    // 检测日当天或之前最后一剂（首剂之前 = 无接种）
    let gap = NO_DOSE;
    const days = dosesBySubject.get(row.subjectKey);
    if (days) {
      for (const day of days) {
        if (day <= testDay) gap = testDay - day;
        else break;
      }
    }
    gapDays.push(gap);
    // 只认明确的阳性 / 阴性：把其它值当阴性会撑大对照组、带偏保护效果，宁可整阶段拒
    if (row.result !== 'pos' && row.result !== 'neg') throw new Error('检测结果必须是 pos 或 neg');
    result.push(row.result === 'pos' ? 1 : 0);
    testStratum.push(s);
  }

  return {
    immuneDays,
    gapDays: Int32Array.from(gapDays),
    result: Uint8Array.from(result),
    testStratum: Uint8Array.from(testStratum),
    strataKeys: keys,
  };
}

/** 参考语义：与模块逐字段一致。 */
export function veTndCount(input: VeTndInput): VeTndResult {
  const enc = encodeVeTnd(input);
  const strata = enc.strataKeys.map((key) => ({
    key,
    vaccPos: 0,
    vaccNeg: 0,
    unvaccPos: 0,
    unvaccNeg: 0,
    partialPos: 0,
    partialNeg: 0,
  }));
  enc.gapDays.forEach((gap, i) => {
    const cell = strata[enc.testStratum[i]];
    const pos = enc.result[i] === 1;
    if (gap === NO_DOSE || gap < 0) {
      if (pos) cell.unvaccPos++;
      else cell.unvaccNeg++;
    } else if (gap >= enc.immuneDays) {
      if (pos) cell.vaccPos++;
      else cell.vaccNeg++;
    } else {
      if (pos) cell.partialPos++;
      else cell.partialNeg++;
    }
  });
  return { analysisType: 'vaccine-tnd', immuneDays: enc.immuneDays, strata };
}

export interface VeEstimate {
  oddsRatio: number;
  /** VE = 1 − OR。 */
  ve: number;
  ciLow: number;
  ciHigh: number;
  /** 是否因零格做了 Haldane-Anscombe 校正（各格 +0.5）。 */
  corrected: boolean;
}

const Z_95 = 1.959963984540054;

/**
 * 层内 VE 与 95% 区间（确定性计算，**不由语言模型产生数值**；design D7）。
 *
 * - `OR = (vaccPos × unvaccNeg) / (vaccNeg × unvaccPos)`，`VE = 1 − OR`；
 * - Wald/Woolf 法：`SE(lnOR) = sqrt(1/a + 1/b + 1/c + 1/d)`；
 * - 零格 → Haldane-Anscombe 校正（各格 +0.5）并置 `corrected = true`；
 * - `vaccPos = 0` 或 `unvaccPos = 0` → 返回 `null`：该层 **VE 不可估计**
 *   （呈现为「不可估计」，不得呈现为 0 或 100%）。
 */
export function estimateVe(s: VeTndStratum): VeEstimate | null {
  if (s.vaccPos === 0 || s.unvaccPos === 0) return null;
  let [a, b, c, d] = [s.vaccPos, s.vaccNeg, s.unvaccPos, s.unvaccNeg];
  const corrected = a === 0 || b === 0 || c === 0 || d === 0;
  if (corrected) {
    a += 0.5;
    b += 0.5;
    c += 0.5;
    d += 0.5;
  }
  const oddsRatio = (a * d) / (b * c);
  const se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const lnOr = Math.log(oddsRatio);
  const orLow = Math.exp(lnOr - Z_95 * se);
  const orHigh = Math.exp(lnOr + Z_95 * se);
  return {
    oddsRatio,
    ve: 1 - oddsRatio,
    ciLow: 1 - orHigh,
    ciHigh: 1 - orLow,
    corrected,
  };
}
