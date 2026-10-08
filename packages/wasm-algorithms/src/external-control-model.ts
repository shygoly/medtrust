/**
 * 单臂试验的真实世界外部对照（D1）—— 参考语义与模块编码（宿主侧）。
 *
 * 设计：把申办方单臂试验受试者与医院历史病例（对照候选池）在**节点内**做
 * 确定性窗口匹配（同层、索引日 |Δ| ≤ caliperDays、每人至多 ratioK 个对照、窗口内取最早），
 * 得到每层「匹配试验组 阳/阴、被匹配对照 阳/阴、匹配数、未匹配数」，宿主侧再算
 * RR / RD 与 95% CI（Woolf；零格走 Haldane-Anscombe 并标注）。
 *
 * 与模块的分工：宿主负责排序（分层, 索引日, 假名）与日期→天数转换；模块只认数字列。
 * 不可估语义：某层 matched = 0、对照数 = 0、试验组或对照组零事件 → 估计返回 null
 * （呈现「不可估计」），MUST NOT 显示 RR = 0 或 ∞。
 */

const DAY_MS = 86_400_000;

export type ExternalControlOutcome = 'pos' | 'neg';

export interface ExternalControlTrialRow {
  subjectKey: string;
  ageBand: string;
  sex: string;
  /** 入组/索引日（YYYY-MM-DD）。 */
  indexDate: string;
  outcome: ExternalControlOutcome;
}

export interface ExternalControlRow extends ExternalControlTrialRow {}

export interface ExternalControlInput {
  trialRows: readonly ExternalControlTrialRow[];
  controlRows: readonly ExternalControlRow[];
  strataKeys: readonly string[];
  caliperDays: number;
  ratioK: number;
}

export interface ExternalControlStratum {
  key: string;
  mExpPos: number;
  mExpNeg: number;
  ctlPos: number;
  ctlNeg: number;
  matched: number;
  unmatched: number;
}

export interface ExternalControlResult {
  analysisType: 'external-control';
  caliperDays: number;
  ratioK: number;
  strata: ExternalControlStratum[];
}

/** 与另两个场景同口径：接受 `YYYY-MM-DD` 或完整 ISO 时间；解析不了即拒，不写成第 0 天。 */
function dayNumber(value: string): number {
  const t = Date.parse(typeof value === 'string' && value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(t)) throw new Error('日期不可解析');
  return Math.floor(t / DAY_MS);
}

export interface ExternalControlEncoded {
  nTrial: number;
  nCtrl: number;
  caliperDays: number;
  ratioK: number;
  trialDay: Int32Array;
  trialOutcome: Uint8Array;
  trialStratum: Uint8Array;
  ctrlDay: Int32Array;
  ctrlOutcome: Uint8Array;
  ctrlStratum: Uint8Array;
  strataKeys: string[];
  /** 输入区总字节数（头 16B 起）。 */
  layout: { header: number; trialDay: number; trialOutcome: number; trialStratum: number; ctrlDay: number; ctrlOutcome: number; ctrlStratum: number; bytes: number };
}

export function encodeExternalControl(input: ExternalControlInput): ExternalControlEncoded {
  if (!Number.isInteger(input.caliperDays) || input.caliperDays < 0) throw new Error('caliperDays 必须 ≥ 0');
  if (!Number.isInteger(input.ratioK) || input.ratioK < 1) throw new Error('ratioK 必须 ≥ 1');
  const strataIndex = new Map(input.strataKeys.map((k, i) => [k, i]));
  const keyOf = (r: { ageBand: string; sex: string }) => `${r.ageBand}|${r.sex}`;
  const stratify = (r: { ageBand: string; sex: string }) => {
    const s = strataIndex.get(keyOf(r));
    if (s === undefined) throw new Error(`分层 ${keyOf(r)} 不在 strataKeys`);
    return s;
  };
  const sortRows = <T extends ExternalControlTrialRow>(rows: readonly T[]): T[] =>
    [...rows].sort((a, b) => {
      const s = stratify(a) - stratify(b);
      if (s !== 0) return s;
      const d = dayNumber(a.indexDate) - dayNumber(b.indexDate);
      if (d !== 0) return d;
      return a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0;
    });
  const trial = sortRows(input.trialRows);
  const ctrl = sortRows(input.controlRows);
  const nTrial = trial.length;
  const nCtrl = ctrl.length;
  const trialDay = new Int32Array(nTrial);
  const trialOutcome = new Uint8Array(nTrial);
  const trialStratum = new Uint8Array(nTrial);
  trial.forEach((r, i) => {
    trialDay[i] = dayNumber(r.indexDate);
    trialOutcome[i] = r.outcome === 'pos' ? 1 : 0;
    trialStratum[i] = stratify(r);
  });
  const ctrlDay = new Int32Array(nCtrl);
  const ctrlOutcome = new Uint8Array(nCtrl);
  const ctrlStratum = new Uint8Array(nCtrl);
  ctrl.forEach((r, j) => {
    ctrlDay[j] = dayNumber(r.indexDate);
    ctrlOutcome[j] = r.outcome === 'pos' ? 1 : 0;
    ctrlStratum[j] = stratify(r);
  });
  const header = 16;
  const tDay = header;
  const tOut = tDay + nTrial * 4;
  const tStr = tOut + nTrial;
  const cDay = tStr + nTrial;
  const cOut = cDay + nCtrl * 4;
  const cStr = cOut + nCtrl;
  return {
    nTrial, nCtrl, caliperDays: input.caliperDays, ratioK: input.ratioK,
    trialDay, trialOutcome, trialStratum, ctrlDay, ctrlOutcome, ctrlStratum,
    strataKeys: [...input.strataKeys],
    layout: { header, trialDay: tDay, trialOutcome: tOut, trialStratum: tStr, ctrlDay: cDay, ctrlOutcome: cOut, ctrlStratum: cStr, bytes: cStr + nCtrl },
  };
}

/** 参考语义：与模块逐字段一致（同排序、同窗口、同「窗口内取最早」贪心）。 */
export function externalControlCount(input: ExternalControlInput): ExternalControlResult {
  const enc = encodeExternalControl(input);
  const S = enc.strataKeys.length;
  const strata: ExternalControlStratum[] = enc.strataKeys.map((key) => ({
    key, mExpPos: 0, mExpNeg: 0, ctlPos: 0, ctlNeg: 0, matched: 0, unmatched: 0,
  }));
  let ptr = 0;
  for (let i = 0; i < enc.nTrial; i++) {
    const s = enc.trialStratum[i]!;
    const day = enc.trialDay[i]!;
    const lo = day - enc.caliperDays;
    while (ptr < enc.nCtrl) {
      const ps = enc.ctrlStratum[ptr]!;
      if (ps < s || (ps === s && enc.ctrlDay[ptr]! < lo)) { ptr++; continue; }
      break;
    }
    let taken = 0;
    const j0 = ptr;
    let j = ptr;
    while (taken < enc.ratioK && j < enc.nCtrl) {
      if (enc.ctrlStratum[j] !== s) break;
      if (enc.ctrlDay[j]! > day + enc.caliperDays) break;
      if (enc.ctrlOutcome[j] === 1) strata[s]!.ctlPos += 1;
      else strata[s]!.ctlNeg += 1;
      taken++; j++;
    }
    if (taken > 0) {
      strata[s]!.matched += 1;
      if (enc.trialOutcome[i] === 1) strata[s]!.mExpPos += 1;
      else strata[s]!.mExpNeg += 1;
      ptr = j;
    } else {
      strata[s]!.unmatched += 1;
    }
    void j0;
  }
  return { analysisType: 'external-control', caliperDays: input.caliperDays, ratioK: input.ratioK, strata };
}

export interface ExternalControlEstimate {
  rr: number;
  rrCi: { low: number; high: number };
  rd: number;
  rdCi: { low: number; high: number };
  p1: number;
  p0: number;
  n1: number;
  n0: number;
  corrected: boolean;
}

/** RR / RD + 95% CI（Woolf）。零事件格走 Haldane-Anscombe（全部 +0.5）并标注；
 *  分母为 0 或任一侧零事件 → null（「不可估计」，不得显示 0 / ∞）。 */
export function estimateExternalControl(s: ExternalControlStratum): ExternalControlEstimate | null {
  const n1 = s.matched;
  const n0 = s.ctlPos + s.ctlNeg;
  if (n1 === 0 || n0 === 0) return null;
  const a0 = s.mExpPos, b0 = s.mExpNeg, c0 = s.ctlPos, d0 = s.ctlNeg;
  if (a0 === 0 || c0 === 0) return null; // 任一侧零事件：不可估（口径与 VE 一致）
  const corrected = a0 === 0 || b0 === 0 || c0 === 0 || d0 === 0;
  const a = a0 || 0.5, b = b0 || 0.5, c = c0 || 0.5, d = d0 || 0.5;
  const p1 = a / n1;
  const p0 = c / n0;
  const rr = p1 / p0;
  const seLn = Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n0);
  const z = 1.959963984540054;
  const rd = p1 - p0;
  const seRd = Math.sqrt((a * (n1 - a)) / (n1 * n1 * n1) + (c * (n0 - c)) / (n0 * n0 * n0));
  return {
    rr,
    rrCi: { low: rr * Math.exp(-z * seLn), high: rr * Math.exp(z * seLn) },
    rd,
    rdCi: { low: rd - z * seRd, high: rd + z * seRd },
    p1, p0, n1, n0, corrected,
  };
}
