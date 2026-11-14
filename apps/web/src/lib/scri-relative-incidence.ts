/**
 * SCRI 相对发生率（镜像 API `result-interpreter/c3-facts.scriRelativeIncidence`）。
 * 风险期事件 x、对照期事件 n−x；π 的 Clopper-Pearson → RI = π/(1−π)·Lc/Lr。
 */

export function scriRelativeIncidence(input: {
  riskEvents: number;
  controlEvents: number;
  riskDays: number;
  controlDays: number;
}): { ri: number; lower: number; upper: number } | null {
  const x = input.riskEvents;
  const n = input.riskEvents + input.controlEvents;
  if (n === 0 || input.controlEvents === 0 || input.riskDays <= 0 || input.controlDays <= 0) {
    return null;
  }
  const scale = input.controlDays / input.riskDays;
  const toRi = (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return Number.POSITIVE_INFINITY;
    return (p / (1 - p)) * scale;
  };
  const pLow =
    x === 0 ? 0 : bisect((p) => (1 - binomCdf(x - 1, n, p) - 0.025 < 0 ? 1 : -1));
  const pHigh = x === n ? 1 : bisect((p) => (binomCdf(x, n, p) - 0.025 > 0 ? 1 : -1));
  return {
    ri: toRi(x / n),
    lower: toRi(pLow),
    upper: pHigh >= 1 ? Number.POSITIVE_INFINITY : toRi(pHigh),
  };
}

/** 闭区间窗口 [a,b] → 天数。 */
export function windowDaySpan(window: unknown): number | null {
  if (!Array.isArray(window) || window.length < 2) return null;
  const a = window[0];
  const b = window[1];
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return Math.abs(b - a) + 1;
}

export function scriWindowLabel([a, b]: [number, number]): string {
  return a < 0 && b < 0 ? `接种前第 ${-a}–${-b} 天` : `接种后第 ${a}–${b} 天`;
}

const AGE_LABEL: Record<string, string> = {
  "<40": "40 岁以下",
  "40+": "40 岁及以上",
};
const SEX_LABEL: Record<string, string> = {
  M: "男性",
  F: "女性",
  male: "男性",
  female: "女性",
};

export function scriStratumLabel(key: string): string {
  const [age, sex] = key.split("|");
  if (age == null) return key;
  return `${AGE_LABEL[age] ?? age}${sex != null ? SEX_LABEL[sex] ?? sex : ""}`;
}

function binomCdf(x: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  let logC = 0;
  let sum = 0;
  for (let k = 0; k <= x; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    sum += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return Math.min(1, sum);
}

function bisect(f: (p: number) => number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
