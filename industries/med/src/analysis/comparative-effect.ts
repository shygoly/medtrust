// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * L2 比较效果的**纯统计**（下移自连接器 `domain/comparative-effect.ts`）。
 *
 * 站点内计算与批处理共用这一份。产物是站点效应量载荷，不是连接器的 `AggregateResult`
 * （那条依赖链留在 legacy 执行器，直到 O7 观察窗后删旧接线）。
 */
import type { InternalRecord } from "../records/internal-record";
import { matchesAdverseEvent, matchesCondition, matchesMedication } from "./clinical-matching";

export interface Contingency2x2 {
  a: number; // exposed + outcome
  b: number; // exposed + no outcome
  c: number; // unexposed + outcome
  d: number; // unexposed + no outcome
}

export interface MantelHaenszelResult {
  logOr: number;
  or: number;
  standardError: number;
  ci95: [number, number];
}

export interface LogisticFitResult {
  beta: number[]; // [intercept, exposure]
  covariance: number[][];
  logOr: number;
  standardError: number;
  ci95: [number, number];
}

export type StratifyField = 'ageBand' | 'sex';

const Z_975 = 1.959963984540054;

function contingencyTotal(t: Contingency2x2): number {
  return t.a + t.b + t.c + t.d;
}

/** 分层 bucket 总样本量 (a+b+c+d). */
export function stratumSampleSize(bucket: {
  count: number;
  b?: number;
  c?: number;
  d?: number;
}): number {
  return bucket.count + (bucket.b ?? 0) + (bucket.c ?? 0) + (bucket.d ?? 0);
}

export function bucketToContingency2x2(bucket: {
  count: number;
  b?: number;
  c?: number;
  d?: number;
}): Contingency2x2 {
  return { a: bucket.count, b: bucket.b ?? 0, c: bucket.c ?? 0, d: bucket.d ?? 0 };
}

function poolContingencyTables(tables: Contingency2x2[]): Contingency2x2 {
  return tables.reduce(
    (acc, t) => ({
      a: acc.a + t.a,
      b: acc.b + t.b,
      c: acc.c + t.c,
      d: acc.d + t.d,
    }),
    { a: 0, b: 0, c: 0, d: 0 },
  );
}

function woolfLogOr(t: Contingency2x2): { logOr: number; standardError: number } {
  let { a, b, c, d } = t;
  if (a === 0 || b === 0 || c === 0 || d === 0) {
    a += 0.5;
    b += 0.5;
    c += 0.5;
    d += 0.5;
  }
  const logOr = Math.log((a * d) / (b * c));
  const standardError = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  return { logOr, standardError };
}

/**
 * rws-study-protocol-spec D6: absolute-risk expression derived from the
 * pooled {a,b,c,d} cells. 《指导原则》§3.1 requires both relative AND absolute
 * risk estimates — relative-only is dangerously misleading at low baseline.
 *
 * Baseline = P(event|unexposed) = c/(c+d); risk difference = exposed rate
 * minus baseline. CI is Wald on the difference of two independent proportions
 * (bounded to [-1, 1]). The baseline MUST come from post-gate aggregate
 * counts — the caller passes only the surviving strata after suppression.
 */
export interface AbsoluteRiskEstimate {
  riskDifference: number;
  ci95: [number, number];
  baselineRate: number;
  baselineSource: "aggregated_site_counts";
}

function absoluteRiskFromTables(pooled: Contingency2x2): AbsoluteRiskEstimate {
  const nExp = pooled.a + pooled.b;
  const nUnexp = pooled.c + pooled.d;
  // Guard against div-by-zero (shouldn't happen post-pool, but be defensive).
  const pExp = nExp > 0 ? pooled.a / nExp : 0;
  const pUnexp = nUnexp > 0 ? pooled.c / nUnexp : 0;
  const rd = pExp - pUnexp;
  // SE of a difference of independent proportions.
  const varExp = nExp > 0 ? (pExp * (1 - pExp)) / nExp : 0;
  const varUnexp = nUnexp > 0 ? (pUnexp * (1 - pUnexp)) / nUnexp : 0;
  const se = Math.sqrt(varExp + varUnexp);
  const lo = Math.max(-1, rd - Z_975 * se);
  const hi = Math.min(1, rd + Z_975 * se);
  return {
    riskDifference: +rd.toFixed(6),
    ci95: [
      +lo.toFixed(6),
      +hi.toFixed(6),
    ],
    baselineRate: +pUnexp.toFixed(6),
    baselineSource: 'aggregated_site_counts',
  };
}

/** 由过闸后剩余分层 2×2 重算站点效应量 (输出闸门 4.3 用). */
export interface StratifiedEffectEstimate {
  measure: "log_or";
  beta: number;
  standardError: number;
  covariance: number[][];
  ci95: [number, number];
  mantelHaenszel: MantelHaenszelResult;
  absoluteRisk: AbsoluteRiskEstimate;
}

export function effectEstimateFromStratifiedTables(
  tables: Contingency2x2[],
): StratifiedEffectEstimate | undefined {
  if (!tables.length) return undefined;
  const mh = mantelHaenszelPooledOr(tables);
  const pooled = poolContingencyTables(tables);
  const woolf = woolfLogOr(pooled);
  const ci95: [number, number] = [
    woolf.logOr - Z_975 * woolf.standardError,
    woolf.logOr + Z_975 * woolf.standardError,
  ];
  return {
    measure: 'log_or',
    beta: +woolf.logOr.toFixed(6),
    standardError: +woolf.standardError.toFixed(6),
    covariance: [
      [0, 0],
      [0, +(woolf.standardError ** 2).toFixed(6)],
    ],
    ci95: ci95.map((x) => +x.toFixed(6)) as [number, number],
    mantelHaenszel: {
      logOr: +mh.logOr.toFixed(6),
      or: +mh.or.toFixed(6),
      standardError: +mh.standardError.toFixed(6),
      ci95: mh.ci95.map((x) => +x.toFixed(6)) as [number, number],
    },
    // D6: absolute-risk expression from the same pooled cells. Absent only
    // when the pooled table is degenerate (impossible post-pool of non-empty
    // strata, but the guard inside keeps the type honest).
    absoluteRisk: absoluteRiskFromTables(pooled),
  };
}

/** 分层 2×2: exposure=drug, outcome=指定 AE term 或慢病标签. */
export function stratifiedContingencyTables(
  cohort: readonly InternalRecord[],
  drug: string,
  outcome: string,
  outcomeKind: 'adverse_event' | 'condition' = 'adverse_event',
  stratifyBy: StratifyField[] = ['ageBand'],
): { stratum: string; table: Contingency2x2 }[] {
  const onDrug = (r: InternalRecord) => matchesMedication(r.medications, drug);
  const hasOutcome = (r: InternalRecord) =>
    outcomeKind === 'condition'
      ? matchesCondition(r.conditions, outcome)
      : matchesAdverseEvent(r.adverseEvents, outcome);

  const strata = new Map<string, Contingency2x2>();
  for (const r of cohort) {
    const parts = stratifyBy.map((f) => (f === 'sex' ? r.sex ?? '未知' : r.ageBand));
    const key = parts.join('|');
    const cell = strata.get(key) ?? { a: 0, b: 0, c: 0, d: 0 };
    const exposed = onDrug(r);
    const event = hasOutcome(r);
    if (exposed && event) cell.a++;
    else if (exposed && !event) cell.b++;
    else if (!exposed && event) cell.c++;
    else cell.d++;
    strata.set(key, cell);
  }

  return [...strata.entries()]
    .map(([stratum, table]) => ({ stratum, table }))
    .sort((x, y) => x.stratum.localeCompare(y.stratum));
}

/** Mantel–Haenszel 公共 OR 及 log(OR) 标准误 (Greenland–Robins). */
export function mantelHaenszelPooledOr(tables: Contingency2x2[]): MantelHaenszelResult {
  const valid = tables.filter((t) => contingencyTotal(t) > 0);
  if (!valid.length) {
    return { logOr: 0, or: 1, standardError: Infinity, ci95: [0, Infinity] };
  }

  let num = 0;
  let den = 0;
  for (const t of valid) {
    const n = contingencyTotal(t);
    num += (t.a * t.d) / n;
    den += (t.b * t.c) / n;
  }
  if (den === 0) {
    return { logOr: 0, or: 1, standardError: Infinity, ci95: [0, Infinity] };
  }

  const or = num / den;
  const logOr = Math.log(or);

  let varLog = 0;
  for (const t of valid) {
    const n = contingencyTotal(t);
    if (n <= 1) continue;
    const p = (t.a * t.d) / n;
    const q = (t.b * t.c) / n;
    if (p === 0 || q === 0) continue;
    const term1 = ((t.a + t.d) * p) / (n * t.a * t.d || 1);
    const term2 = ((t.b + t.c) * q) / (n * t.b * t.c || 1);
    varLog += (term1 + (or * or) * term2) / (num * num);
  }
  const standardError = Math.sqrt(Math.max(varLog, 0));
  return {
    logOr,
    or,
    standardError,
    ci95: [logOr - Z_975 * standardError, logOr + Z_975 * standardError],
  };
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function invert2x2(m: number[][]): number[][] {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (Math.abs(det) < 1e-12) throw new Error('logistic 信息矩阵奇异');
  return [
    [m[1][1] / det, -m[0][1] / det],
    [-m[1][0] / det, m[0][0] / det],
  ];
}

/** 局部 logistic(exposure→outcome),返回 β + 协方差; exposure 系数即 log OR. */
export function localLogisticRegression(
  cohort: readonly InternalRecord[],
  drug: string,
  outcome: string,
  outcomeKind: 'adverse_event' | 'condition' = 'adverse_event',
): LogisticFitResult {
  const onDrug = (r: InternalRecord) => (matchesMedication(r.medications, drug) ? 1 : 0);
  const hasOutcome = (r: InternalRecord) =>
    outcomeKind === 'condition'
      ? matchesCondition(r.conditions, outcome)
      : matchesAdverseEvent(r.adverseEvents, outcome);

  const X: number[][] = [];
  const y: number[] = [];
  for (const r of cohort) {
    X.push([1, onDrug(r)]);
    y.push(hasOutcome(r) ? 1 : 0);
  }
  if (!X.length) throw new Error('comparative-effect 队列为空');

  let beta = [0, 0];
  for (let iter = 0; iter < 40; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < X.length; i++) {
      const z = dot(beta, X[i]);
      const mu = 1 / (1 + Math.exp(-z));
      const w = mu * (1 - mu);
      const err = y[i] - mu;
      g0 += err;
      g1 += err * X[i][1];
      h00 += w;
      h01 += w * X[i][1];
      h11 += w * X[i][1] * X[i][1];
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    const d0 = (g0 * h11 - g1 * h01) / det;
    const d1 = (h00 * g1 - h01 * g0) / det;
    beta = [beta[0] + d0, beta[1] + d1];
    if (Math.abs(d0) < 1e-8 && Math.abs(d1) < 1e-8) break;
  }

  let h00 = 0;
  let h01 = 0;
  let h11 = 0;
  for (let i = 0; i < X.length; i++) {
    const z = dot(beta, X[i]);
    const mu = 1 / (1 + Math.exp(-z));
    const w = mu * (1 - mu);
    h00 += w;
    h01 += w * X[i][1];
    h11 += w * X[i][1] * X[i][1];
  }
  const hessian = [
    [h00, h01],
    [h01, h11],
  ];
  const covariance = invert2x2(hessian);
  const logOr = beta[1];
  const standardError = Math.sqrt(Math.max(covariance[1][1], 0));
  return {
    beta,
    covariance,
    logOr,
    standardError,
    ci95: [logOr - Z_975 * standardError, logOr + Z_975 * standardError],
  };
}

/**
 * Firth 惩罚 logistic 回归(Jeffreys 先验)。在完全分离 / 小样本零格下,标准 MLE
 * 发散(信息矩阵奇异),Firth 惩罚得分保证有限估计与可逆信息矩阵。
 * 惩罚得分: U*_j = Σ_i {y_i - μ_i + h_i(0.5 - μ_i)} x_ij, h_i 为帽子矩阵对角。
 */
export function firthLogisticRegression(
  cohort: readonly InternalRecord[],
  drug: string,
  outcome: string,
  outcomeKind: 'adverse_event' | 'condition' = 'adverse_event',
): LogisticFitResult {
  const onDrug = (r: InternalRecord) => (matchesMedication(r.medications, drug) ? 1 : 0);
  const hasOutcome = (r: InternalRecord) =>
    outcomeKind === 'condition'
      ? matchesCondition(r.conditions, outcome)
      : matchesAdverseEvent(r.adverseEvents, outcome);

  const X: number[][] = [];
  const y: number[] = [];
  for (const r of cohort) {
    X.push([1, onDrug(r)]);
    y.push(hasOutcome(r) ? 1 : 0);
  }
  if (!X.length) throw new Error('comparative-effect 队列为空');

  const ridge = 1e-8; // 数值兜底,保证信息矩阵严格可逆
  let beta = [0, 0];
  let info: number[][] = [
    [1, 0],
    [0, 1],
  ];
  for (let iter = 0; iter < 100; iter++) {
    const mu: number[] = [];
    const w: number[] = [];
    let i00 = 0;
    let i01 = 0;
    let i11 = 0;
    for (let i = 0; i < X.length; i++) {
      const m = 1 / (1 + Math.exp(-dot(beta, X[i])));
      const wi = m * (1 - m);
      mu.push(m);
      w.push(wi);
      i00 += wi;
      i01 += wi * X[i][1];
      i11 += wi * X[i][1] * X[i][1];
    }
    info = [
      [i00 + ridge, i01],
      [i01, i11 + ridge],
    ];
    const inv = invert2x2(info);
    // 惩罚得分:叠加帽子矩阵对角 h_i 的 Jeffreys 修正
    let s0 = 0;
    let s1 = 0;
    for (let i = 0; i < X.length; i++) {
      const xi = X[i];
      const q0 = inv[0][0] * xi[0] + inv[0][1] * xi[1];
      const q1 = inv[1][0] * xi[0] + inv[1][1] * xi[1];
      const hi = w[i] * (xi[0] * q0 + xi[1] * q1);
      const adj = y[i] - mu[i] + hi * (0.5 - mu[i]);
      s0 += adj * xi[0];
      s1 += adj * xi[1];
    }
    const d0 = inv[0][0] * s0 + inv[0][1] * s1;
    const d1 = inv[1][0] * s0 + inv[1][1] * s1;
    beta = [beta[0] + d0, beta[1] + d1];
    if (Math.abs(d0) < 1e-8 && Math.abs(d1) < 1e-8) break;
  }

  const covariance = invert2x2(info);
  const logOr = beta[1];
  const standardError = Math.sqrt(Math.max(covariance[1][1], 0));
  return {
    beta,
    covariance,
    logOr,
    standardError,
    ci95: [logOr - Z_975 * standardError, logOr + Z_975 * standardError],
  };
}

export interface SiteComparativeEffect {
  cohortSize: number;
  outcome: string;
  buckets: Array<{
    key: string;
    count: number;
    rate: number;
    b: number;
    c: number;
    d: number;
  }>;
  effectEstimate: {
    measure: "log_or";
    method: "logistic" | "firth";
    beta: number;
    standardError: number;
    covariance: number[][];
    ci95: [number, number];
    mantelHaenszel: {
      logOr: number;
      or: number;
      standardError: number;
      ci95: [number, number];
    };
  };
}

/** L2 比较研究: 分层 2×2 + M-H pooled OR + 局部 logistic β/协方差. */
export function siteComparativeEffect(
  cohort: readonly InternalRecord[],
  drug: string,
  outcome: string,
  outcomeKind: "adverse_event" | "condition" = "adverse_event",
  stratifyBy: StratifyField[] = ["ageBand"],
): SiteComparativeEffect {
  if (!drug) throw new Error('comparative-effect 需指定 drug');
  if (!outcome) throw new Error('comparative-effect 需指定 outcome');

  const strata = stratifiedContingencyTables(cohort, drug, outcome, outcomeKind, stratifyBy);
  const mh = mantelHaenszelPooledOr(strata.map((s) => s.table));

  // L2 稳健性: 标准 logistic 在完全分离/小样本零格下信息矩阵奇异或发散,
  // 回退到 Firth 惩罚回归(有限估计)。
  let regressionMethod: 'logistic' | 'firth' = 'logistic';
  let logistic: LogisticFitResult | null = null;
  try {
    const fit = localLogisticRegression(cohort, drug, outcome, outcomeKind);
    // |logOr|≥10 (OR>~22000) 是分离伪影,非真实效应 → 视为退化,走 Firth。
    if (
      Number.isFinite(fit.logOr) &&
      Number.isFinite(fit.standardError) &&
      Math.abs(fit.logOr) < 10
    ) {
      logistic = fit;
    }
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('信息矩阵奇异')) {
      throw err;
    }
  }
  if (!logistic) {
    logistic = firthLogisticRegression(cohort, drug, outcome, outcomeKind);
    regressionMethod = 'firth';
  }

  const buckets = strata.map(({ stratum, table }) => {
    const n = contingencyTotal(table) || 1;
    return {
      key: stratum,
      count: table.a,
      rate: +(table.a / n).toFixed(4),
      b: table.b,
      c: table.c,
      d: table.d,
    };
  });

  return {
    cohortSize: cohort.length,
    outcome,
    buckets,
    effectEstimate: {
      measure: 'log_or',
      method: regressionMethod,
      beta: logistic.logOr,
      standardError: logistic.standardError,
      covariance: logistic.covariance,
      ci95: logistic.ci95.map((x) => +x.toFixed(6)) as [number, number],
      mantelHaenszel: {
        logOr: +mh.logOr.toFixed(6),
        or: +mh.or.toFixed(6),
        standardError: +mh.standardError.toFixed(6),
        ci95: mh.ci95.map((x) => +x.toFixed(6)) as [number, number],
      },
    },
  };
}
