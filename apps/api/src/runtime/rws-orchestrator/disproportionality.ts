// L1.5 失衡信号计算器 (rws-analytics-ladder 任务 2.2).
// 纯函数,输入仅站点级 2×2 汇总,不接触个体行、无 I/O.
// 2×2 (针对一个 drug D × event E):
//   a = D 且 E, b = D 且 非E, c = 非D 且 E, d = 非D 且 非E.
// 方法学锚点: Evans 2001 (PRR 信号), van Puijenbroek 2002 (ROR), Bate 1998/Norén (BCPNN IC).
// 最终指标/阈值待药物警戒岗确认 (OQ3-b); 阈值已参数化便于替换.

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
    (acc, t) => ({ a: acc.a + t.a, b: acc.b + t.b, c: acc.c + t.c, d: acc.d + t.d }),
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
  return { value, ci95: [Math.exp(ln - Z_975 * seLog), Math.exp(ln + Z_975 * seLog)] };
}

/** 报告比值比 ROR = ad/bc,含对数正态 95%CI. */
export function ror(raw: Contingency2x2): RatioWithCi {
  const { a, b, c, d } = corrected(raw);
  const value = (a * d) / (b * c);
  const seLog = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const ln = Math.log(value);
  return { value, ci95: [Math.exp(ln - Z_975 * seLog), Math.exp(ln + Z_975 * seLog)] };
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
  return cells.reduce((s, { o, e }) => s + Math.pow(Math.abs(o - e) - 0.5, 2) / e, 0);
}

// BCPNN 信息成分点估计: IC = log2( (a+0.5) / (E+0.5) ), E = (a+b)(a+c)/N.
// +0.5 收缩避免 a=0 时 -Inf. IC025 (可信下界) 为 OQ3-b 精化项,不在本任务.
export function informationComponent(t: Contingency2x2): number {
  const { a, b, c, d } = t;
  const n = a + b + c + d;
  if (n === 0) return 0;
  const expected = ((a + b) * (a + c)) / n;
  return Math.log2((a + 0.5) / (expected + 0.5));
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
  signal: boolean;
}

/** 对一个 (drug×event) 的池化 2×2 计算全部失衡指标 + Evans 信号判定. */
export function computeDisproportionality(
  t: Contingency2x2,
  thresholds: EvansThresholds = EVANS,
): DisproportionalityResult {
  const p = prr(t);
  const r = ror(t);
  const chi = chiSqYates(t);
  const ic = informationComponent(t);
  const signal =
    p.value >= thresholds.minPrr && chi >= thresholds.minChiSq && t.a >= thresholds.minCases;
  return {
    cases: t.a,
    prr: p.value,
    prrCi95: p.ci95,
    ror: r.value,
    rorCi95: r.ci95,
    chiSqYates: chi,
    ic,
    signal,
  };
}
