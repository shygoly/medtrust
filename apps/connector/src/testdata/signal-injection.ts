// 信号注入测试数据层 (rws-test-data-signal-injection, D-DATA-1)。
// 在真实(或合成)人口基座之上注入**已知真值**信号:暴露臂 + 混杂 + 结局(带时间)+ 编码噪声。
// 注入参数即 answer key,供 e2e 断言管道复原(容许错分向零衰减)。
// 纯函数 + seeded PRNG:确定性、可 jest 单测。仅产测试数据,不入生产运行时路径。
import type { AdverseEvent, InternalRecord } from '../domain/types';

export interface InjectionParams {
  exposureDrug: string; // 暴露臂用药(目标药,disproportionality 的 drug of interest)
  comparatorDrug: string; // 对照臂用药(同适应证替代治疗)
  outcomeTerm: string; // 结局不良事件术语(如 acute pancreatitis)
  trueHR: number; // 暴露对结局的真实效应(注入真值)
  zOddsRatio: number; // 混杂 Z 对结局的效应
  baseIncidence: number; // 无暴露无 Z 的基础发病率
  codeSensitivity: number; // 编码噪声:真结局被记为编码的概率(L0 目标 Se)
  codeSpecificity: number; // 编码噪声:无结局不被误编的概率(L0 目标 Sp)
  pZ: number; // 混杂流行率
  pExposedBase: number; // 基础暴露分配概率
  pExposedZDelta: number; // Z 抬高暴露概率(confounding by indication)
  followUpDays: number; // 随访窗(供 L3 时间到事件)
}

export const DEFAULT_INJECTION: InjectionParams = {
  // Arms aligned to Synthea diabetes-module formulary (Task 1.2):
  // metformin RxNorm 860975 (first-line) vs insulin RxNorm 106892 (escalation).
  // See data/synthea/diabetes-formulary.md — not sitagliptin (absent from Synthea).
  exposureDrug: 'insulin',
  comparatorDrug: 'metformin',
  outcomeTerm: 'acute pancreatitis',
  trueHR: 2.5,
  zOddsRatio: 2.0,
  baseIncidence: 0.03,
  codeSensitivity: 0.88,
  codeSpecificity: 0.98,
  pZ: 0.3,
  pExposedBase: 0.5,
  pExposedZDelta: 0.2,
  followUpDays: 365,
};

export interface BaseSubject {
  subjectKey: string;
  site: string;
  ageBand?: string;
  sex?: string;
}

export interface SubjectTruth {
  subjectKey: string;
  site: string;
  arm: 'exposed' | 'comparator';
  z: 0 | 1;
  truePancreatitis: boolean;
  codedPancreatitis: boolean;
  timeToEventDays?: number;
}

export interface AnswerKey {
  params: InjectionParams;
  seed: number;
  totalSubjects: number;
  perSite: Record<string, { subjects: number; trueEvents: number; codedEvents: number }>;
}

export interface InjectedDataset {
  records: InternalRecord[]; // 连接器所见(编码后)
  truth: SubjectTruth[]; // 真值(供 L0 金标准 + e2e 复原断言)
  answerKey: AnswerKey;
}

// mulberry32:确定性 seeded PRNG。
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 便捷:生成占位基座(测试/快速生成用;生产由 Synthea loader 提供 base)。 */
export function syntheticBase(n: number, sites: string[]): BaseSubject[] {
  const out: BaseSubject[] = [];
  for (let i = 0; i < n; i++) {
    const site = sites[i % sites.length];
    out.push({ subjectKey: `${site}-${i}`, site });
  }
  return out;
}

export function injectSignal(
  base: readonly BaseSubject[],
  params: InjectionParams,
  seed: number,
): InjectedDataset {
  const rnd = mulberry32(seed);
  const b0 = Math.log(params.baseIncidence / (1 - params.baseIncidence));
  const bExp = Math.log(params.trueHR);
  const bZ = Math.log(params.zOddsRatio);

  const records: InternalRecord[] = [];
  const truth: SubjectTruth[] = [];
  const perSite: AnswerKey['perSite'] = {};

  for (const subj of base) {
    const z: 0 | 1 = rnd() < params.pZ ? 1 : 0;
    const pExposed = clamp(params.pExposedBase + params.pExposedZDelta * z, 0, 0.95);
    const exposed = rnd() < pExposed;
    const pOutcome = logistic(b0 + bExp * (exposed ? 1 : 0) + bZ * z);
    const truePanc = rnd() < pOutcome;
    // 编码噪声:非差异错分
    const coded = truePanc ? rnd() < params.codeSensitivity : rnd() < 1 - params.codeSpecificity;
    const timeToEventDays = truePanc
      ? Math.max(1, Math.round(rnd() * params.followUpDays))
      : undefined;

    const ae: AdverseEvent[] = coded
      ? [{ organSystem: '消化系统', term: params.outcomeTerm, serious: true }]
      : [];
    records.push({
      subjectKey: subj.subjectKey,
      ageBand: subj.ageBand ?? '50-59',
      sex: subj.sex,
      conditions: ['diabetes', 'synthetic-injected'],
      medications: [exposed ? params.exposureDrug : params.comparatorDrug],
      adverseEvents: ae,
      followUpDays: timeToEventDays ?? params.followUpDays,
      eventOccurred: coded,
      treated: exposed,
    });
    truth.push({
      subjectKey: subj.subjectKey,
      site: subj.site,
      arm: exposed ? 'exposed' : 'comparator',
      z,
      truePancreatitis: truePanc,
      codedPancreatitis: coded,
      timeToEventDays,
    });
    const s = (perSite[subj.site] ??= { subjects: 0, trueEvents: 0, codedEvents: 0 });
    s.subjects++;
    if (truePanc) s.trueEvents++;
    if (coded) s.codedEvents++;
  }

  return {
    records,
    truth,
    answerKey: { params, seed, totalSubjects: base.length, perSite },
  };
}

// ---------- 分析辅助(测试 + e2e 复用) ----------

export interface Cells {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** 四格:暴露(含目标药)× 结局(编码后不良事件)。 */
export function cellsFromRecords(
  records: readonly InternalRecord[],
  params: InjectionParams,
): Cells {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const r of records) {
    const exposed = r.medications.includes(params.exposureDrug);
    const outcome = r.adverseEvents.some((e) => e.term === params.outcomeTerm);
    if (exposed) outcome ? a++ : b++;
    else outcome ? c++ : d++;
  }
  return { a, b, c, d };
}

export function crudeOddsRatio(c: Cells): number {
  return (c.a * c.d) / (c.b * c.c);
}

/** Mantel-Haenszel:按真值 Z 分层的 OR(L3 会做的调整的粗版)。 */
export function stratifiedOddsRatio(
  records: readonly InternalRecord[],
  truth: readonly SubjectTruth[],
  params: InjectionParams,
): number {
  const zByKey = new Map(truth.map((t) => [t.subjectKey, t.z]));
  let num = 0;
  let den = 0;
  for (const z of [0, 1]) {
    const stratum = records.filter((r) => zByKey.get(r.subjectKey) === z);
    const { a, b, c, d } = cellsFromRecords(stratum, params);
    const n = a + b + c + d;
    if (n > 0) {
      num += (a * d) / n;
      den += (b * c) / n;
    }
  }
  return num / den;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  sensitivity: number;
  specificity: number;
}

/** L0 混淆矩阵:编码结局 vs 真实结局(金标准 = 注入真值)。 */
export function confusionFromTruth(truth: readonly SubjectTruth[]): Confusion {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const t of truth) {
    if (t.truePancreatitis) t.codedPancreatitis ? tp++ : fn++;
    else t.codedPancreatitis ? fp++ : tn++;
  }
  return { tp, fp, fn, tn, sensitivity: tp / (tp + fn), specificity: tn / (tn + fp) };
}
