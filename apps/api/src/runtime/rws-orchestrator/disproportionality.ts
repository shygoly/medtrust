// L1.5 失衡信号计算器 (rws-analytics-ladder 任务 2.2).
// 纯函数,输入仅站点级 2×2 汇总,不接触个体行、无 I/O.
// 2×2 (针对一个 drug D × event E):
//   a = D 且 E, b = D 且 非E, c = 非D 且 E, d = 非D 且 非E.
// 方法学锚点: Evans 2001 (PRR 信号), van Puijenbroek 2002 (ROR), Bate 1998/Norén (BCPNN IC).
// 最终指标/阈值待药物警戒岗确认 (OQ3-b); 阈值已参数化便于替换.

import type {
  RwsAnalysisSpec,
  RwsMergedAggregate,
  RwsPartyAggregate,
} from "./types";

export interface Contingency2x2 {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface RatioWithCi {
  value: number;
  ci95: [number, number];
}

const Z_975 = 1.959963984540054; // 正态 97.5% 分位

/** 多站点加和汇总 (联邦可加池化). L1.5 的池化是逐格相加,而非效应量 meta 合并. */
export function poolSites(tables: Contingency2x2[]): Contingency2x2 {
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

// Haldane–Anscombe: 任一格为 0 时四格各加 0.5,避免除零 / 无穷比值.
function corrected(t: Contingency2x2): Contingency2x2 {
  if (t.a === 0 || t.b === 0 || t.c === 0 || t.d === 0) {
    return { a: t.a + 0.5, b: t.b + 0.5, c: t.c + 0.5, d: t.d + 0.5 };
  }
  return t;
}

/** 比例报告比 PRR = [a/(a+b)] / [c/(c+d)],含对数正态 95%CI. */
export function prr(raw: Contingency2x2): RatioWithCi {
  const { a, b, c, d } = corrected(raw);
  const value = a / (a + b) / (c / (c + d));
  const seLog = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  const ln = Math.log(value);
  return {
    value,
    ci95: [Math.exp(ln - Z_975 * seLog), Math.exp(ln + Z_975 * seLog)],
  };
}

/** 报告比值比 ROR = ad/bc,含对数正态 95%CI. */
export function ror(raw: Contingency2x2): RatioWithCi {
  const { a, b, c, d } = corrected(raw);
  const value = (a * d) / (b * c);
  const seLog = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const ln = Math.log(value);
  return {
    value,
    ci95: [Math.exp(ln - Z_975 * seLog), Math.exp(ln + Z_975 * seLog)],
  };
}

/** Yates 连续性校正卡方 (PRR 信号判据之一). 边际为 0 时检验无定义,返回 0. */
export function chiSqYates(t: Contingency2x2): number {
  const { a, b, c, d } = t;
  const n = a + b + c + d;
  const rows = [a + b, c + d];
  const cols = [a + c, b + d];
  if (n === 0 || rows.includes(0) || cols.includes(0)) return 0;
  const cells = [
    { o: a, e: (rows[0] * cols[0]) / n },
    { o: b, e: (rows[0] * cols[1]) / n },
    { o: c, e: (rows[1] * cols[0]) / n },
    { o: d, e: (rows[1] * cols[1]) / n },
  ];
  return cells.reduce(
    (s, { o, e }) => s + Math.pow(Math.abs(o - e) - 0.5, 2) / e,
    0,
  );
}

// BCPNN 信息成分点估计及 95% 可信区间:
//   IC = log2( (a+0.5) / (E+0.5) ), E = (a+b)(a+c)/N
// 依据 Norén et al. (2006) 收缩 Gamma 后验 μ ~ Gamma(a+0.5, E+0.5)，
// 通过不完全伽马分布分位数精确求 IC025 / IC975，避免极小样本点估计假阳性。
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return (
      Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  const zz = z - 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) x += p[i] / (zz + i);
  const t = zz + g + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x)
  );
}

/** 正则化下不完全伽马函数 P(alpha, x) = γ(alpha, x) / Γ(alpha), alpha > 0, x >= 0. */
function gammaLowerP(alpha: number, x: number): number {
  if (x <= 0) return 0;
  const lnGammaA = logGamma(alpha);
  const front = Math.exp(alpha * Math.log(x) - x - lnGammaA);
  if (x < alpha + 1) {
    let term = 1 / alpha;
    let sum = term;
    for (let k = 1; k <= 300; k++) {
      term *= x / (alpha + k);
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * 1e-14) break;
    }
    return Math.min(1, front * sum);
  }
  // Lentz 连分式算上不完全伽马 Q(alpha, x) = 1 - P(alpha, x)
  const tiny = 1e-30;
  let b = x + 1 - alpha;
  let c = 1 / tiny;
  let d = Math.abs(b) < tiny ? 1 / tiny : 1 / b;
  let h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - alpha);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) <= 1e-14) break;
  }
  return Math.max(0, 1 - front * h);
}

/** Gamma(alpha, scale=1) 分位数 q，满足 P(alpha, q) = prob。 */
function gammaUnitQuantile(prob: number, alpha: number): number {
  if (prob <= 0) return 0;
  if (prob >= 1) return Infinity;
  // Wilson–Hilferty 初值
  const z = prob < 0.5 ? -Z_975 : Z_975;
  const inv9a = 1 / (9 * alpha);
  const cubic = 1 - inv9a + z * Math.sqrt(inv9a);
  let guess = cubic > 0 ? alpha * cubic * cubic * cubic : alpha * 0.1;
  if (!(guess > 0) || !Number.isFinite(guess)) guess = alpha;

  let lo = Math.max(1e-12, guess * 0.25);
  let hi = Math.max(lo * 4, guess * 2.5);
  while (gammaLowerP(alpha, lo) > prob && lo > 1e-18) lo *= 0.25;
  while (gammaLowerP(alpha, hi) < prob) hi *= 2;

  for (let iter = 0; iter < 80; iter++) {
    const mid = 0.5 * (lo + hi);
    const cdf = gammaLowerP(alpha, mid);
    if (cdf < prob) lo = mid;
    else hi = mid;
    if (hi - lo <= mid * 1e-11) return 0.5 * (lo + hi);
  }
  return 0.5 * (lo + hi);
}

export function informationComponent(t: Contingency2x2): number {
  const { a, b, c, d } = t;
  const n = a + b + c + d;
  if (n === 0) return 0;
  const expected = ((a + b) * (a + c)) / n;
  return Math.log2((a + 0.5) / (expected + 0.5));
}

export function informationComponentBounds(t: Contingency2x2): {
  ic: number;
  ic025: number;
  ic975: number;
} {
  const { a, b, c, d } = t;
  const n = a + b + c + d;
  if (n === 0) return { ic: 0, ic025: 0, ic975: 0 };
  const expected = ((a + b) * (a + c)) / n;
  const alpha = a + 0.5;
  const beta = expected + 0.5;
  const ic = Math.log2(alpha / beta);
  const q025 = gammaUnitQuantile(0.025, alpha);
  const q975 = gammaUnitQuantile(0.975, alpha);
  return {
    ic,
    ic025: Math.log2(q025 / beta),
    ic975: Math.log2(q975 / beta),
  };
}

export interface EvansThresholds {
  minPrr: number;
  minChiSq: number;
  minCases: number;
}

// Evans 2001: 信号 = PRR≥2 且 χ²(Yates)≥4 且 病例数 a≥3. 阈值参数化 (OQ3-b 可替换).
export const EVANS: EvansThresholds = { minPrr: 2, minChiSq: 4, minCases: 3 };

export interface DisproportionalityResult {
  cases: number;
  prr: number;
  prrCi95: [number, number];
  ror: number;
  rorCi95: [number, number];
  chiSqYates: number;
  ic: number;
  ic025: number;
  ic975: number;
  signal: boolean;
  signalBcpnn: boolean;
}

/** 对一个 (drug×event) 的池化 2×2 计算全部失衡指标 + Evans 与 BCPNN 双信号判定. */
export function computeDisproportionality(
  t: Contingency2x2,
  thresholds: EvansThresholds = EVANS,
): DisproportionalityResult {
  const p = prr(t);
  const r = ror(t);
  const chi = chiSqYates(t);
  const { ic, ic025, ic975 } = informationComponentBounds(t);
  const signal =
    p.value >= thresholds.minPrr &&
    chi >= thresholds.minChiSq &&
    t.a >= thresholds.minCases;
  const signalBcpnn = ic025 > 0 && t.a >= 1;
  return {
    cases: t.a,
    prr: p.value,
    prrCi95: p.ci95,
    ror: r.value,
    rorCi95: r.ci95,
    chiSqYates: chi,
    ic,
    ic025,
    ic975,
    signal,
    signalBcpnn,
  };
}

function mergeTemporalModes(
  modes: Array<RwsPartyAggregate["temporalMode"] | undefined>,
): RwsPartyAggregate["temporalMode"] | undefined {
  const present = modes.filter(
    (m): m is NonNullable<RwsPartyAggregate["temporalMode"]> => Boolean(m),
  );
  if (present.length === 0) return undefined;
  const unique = new Set(present);
  if (unique.size === 1) return present[0];
  return "mixed";
}

/** 按 event key 加和各站未抑制 2×2，聚合抑制状态，再重算 PRR/ROR/Evans/BCPNN 信号（FLOW-RWS-01）。 */
export function mergeDisproportionalityAggregates(
  analysis: RwsAnalysisSpec,
  aggregates: RwsPartyAggregate[],
): RwsMergedAggregate {
  const cohortSize = aggregates.reduce((s, a) => s + a.cohortSize, 0);
  const temporalMode = mergeTemporalModes(
    aggregates.map((a) => a.temporalMode),
  );
  const byKey = new Map<
    string,
    { table: Contingency2x2; suppressedSites: number; effectiveSites: number }
  >();
  for (const agg of aggregates) {
    for (const bucket of agg.buckets) {
      const cur = byKey.get(bucket.key) ?? {
        table: { a: 0, b: 0, c: 0, d: 0 },
        suppressedSites: 0,
        effectiveSites: 0,
      };
      if (bucket.suppressed) {
        // 站点已因小单元格整格清零（隐私门禁不可还原），不混入有效分母并累加抑制院数。
        cur.suppressedSites += 1;
      } else {
        cur.effectiveSites += 1;
        cur.table.a += bucket.count;
        cur.table.b += bucket.b ?? 0;
        cur.table.c += bucket.c ?? 0;
        cur.table.d += bucket.d ?? 0;
      }
      byKey.set(bucket.key, cur);
    }
  }
  const buckets = [...byKey.entries()]
    .map(([key, entry]) => {
      const { table, suppressedSites, effectiveSites } = entry;
      const totalSites = suppressedSites + effectiveSites;
      const effectiveCohortSize = table.a + table.b + table.c + table.d;
      const allSuppressed = suppressedSites > 0 && effectiveSites === 0;
      const partialSuppression = suppressedSites > 0 && effectiveSites > 0;
      const siteMeta = {
        ...(suppressedSites > 0
          ? {
              suppressedSites,
              effectiveSites,
              totalSites,
              effectiveCohortSize,
            }
          : {}),
        ...(partialSuppression ? { partialSuppression: true } : {}),
      };
      if (allSuppressed) {
        return {
          key,
          count: 0,
          rate: 0,
          b: 0,
          c: 0,
          d: 0,
          suppressed: true,
          signal: false,
          signalBcpnn: false,
          ...siteMeta,
        };
      }
      const n = effectiveCohortSize || 1;
      const stats = computeDisproportionality(table);
      return {
        key,
        count: table.a,
        rate: +(table.a / n).toFixed(4),
        b: table.b,
        c: table.c,
        d: table.d,
        prr: +stats.prr.toFixed(6),
        prrCi95: stats.prrCi95,
        ror: +stats.ror.toFixed(6),
        rorCi95: stats.rorCi95,
        chiSqYates: +stats.chiSqYates.toFixed(6),
        ic: +stats.ic.toFixed(6),
        ic025: +stats.ic025.toFixed(6),
        ic975: +stats.ic975.toFixed(6),
        signal: stats.signal,
        signalBcpnn: stats.signalBcpnn,
        ...(suppressedSites > 0 ? { suppressed: false } : {}),
        ...siteMeta,
      };
    })
    .sort((a, b) => b.count - a.count);
  return {
    analysisType: aggregates[0]?.analysisType ?? analysis.type,
    cohortSize,
    ...(temporalMode ? { temporalMode } : {}),
    buckets,
  };
}
