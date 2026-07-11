// 中心 meta 分析核 (rws-analytics-ladder 任务 3.1).
// DerSimonian–Laird 随机效应合并; 输入仅站点级效应量 + SE,不接触个体行.

export type EffectMeasure = "log_or" | "log_hr" | "beta" | "ate";

export interface SiteEffectEstimate {
  siteId: string;
  effect: number;
  standardError: number;
  measure?: EffectMeasure;
}

export interface ForestPlotEntry {
  siteId: string;
  effect: number;
  ci95: [number, number];
  weightPercent: number;
}

export interface HeterogeneityStats {
  q: number;
  df: number;
  tau2: number;
  i2Percent: number;
}

export interface MetaAnalysisResult {
  method: "der_simonian_laird";
  k: number;
  pooledEffect: number;
  pooledSe: number;
  ci95: [number, number];
  heterogeneity: HeterogeneityStats;
  forest: ForestPlotEntry[];
}

const Z_975 = 1.959963984540054;

export class MetaInputRejected extends Error {
  constructor(
    message: string,
    readonly code: "row_level" | "invalid_shape" | "single_site",
  ) {
    super(message);
    this.name = "MetaInputRejected";
  }
}

const ROW_LEVEL_TOKENS = ["subjectKey", "patientId", '"rows"'];

function containsRowLevelPayload(value: unknown): boolean {
  const json = JSON.stringify(value ?? "");
  return ROW_LEVEL_TOKENS.some((t) => json.includes(t));
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** 校验站点级效应量输入; 含个体行/可识别字段则拒绝. */
export function validateSiteEffects(input: unknown): SiteEffectEstimate[] {
  if (containsRowLevelPayload(input)) {
    throw new MetaInputRejected("meta 输入含行级/可识别数据,拒绝合并", "row_level");
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw new MetaInputRejected("meta 输入须为非空站点效应量数组", "invalid_shape");
  }

  return input.map((raw, idx) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MetaInputRejected(`站点效应量[${idx}] 格式无效`, "invalid_shape");
    }
    const row = raw as Record<string, unknown>;
    if (containsRowLevelPayload(row)) {
      throw new MetaInputRejected("meta 输入含行级/可识别数据,拒绝合并", "row_level");
    }
    const siteId = row.siteId;
    const effect = row.effect;
    const standardError = row.standardError;
    if (typeof siteId !== "string" || !siteId.trim()) {
      throw new MetaInputRejected(`站点效应量[${idx}] 缺少 siteId`, "invalid_shape");
    }
    if (typeof effect !== "number" || !Number.isFinite(effect)) {
      throw new MetaInputRejected(`站点效应量[${idx}] effect 无效`, "invalid_shape");
    }
    if (!isFinitePositive(standardError)) {
      throw new MetaInputRejected(`站点效应量[${idx}] standardError 须为正数`, "invalid_shape");
    }
    return {
      siteId,
      effect,
      standardError,
      measure: row.measure as EffectMeasure | undefined,
    };
  });
}

/** DerSimonian–Laird 随机效应 meta 合并 (β / log OR / log HR / ATE 等同理). */
export function derSimonianLaird(sites: SiteEffectEstimate[]): MetaAnalysisResult {
  const k = sites.length;
  if (k < 2) {
    throw new MetaInputRejected("单站无法 meta,至少需要 2 个有效站点效应量", "single_site");
  }

  const effects = sites.map((s) => s.effect);
  const variances = sites.map((s) => s.standardError ** 2);
  const feWeights = variances.map((v) => 1 / v);
  const sumFeW = feWeights.reduce((a, b) => a + b, 0);
  const thetaFe =
    effects.reduce((sum, e, i) => sum + feWeights[i] * e, 0) / sumFeW;

  const q = effects.reduce(
    (sum, e, i) => sum + feWeights[i] * (e - thetaFe) ** 2,
    0,
  );
  const df = k - 1;
  const sumFeW2 = feWeights.reduce((s, w) => s + w * w, 0);
  const c = sumFeW - sumFeW2 / sumFeW;
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;

  const reWeights = variances.map((v) => 1 / (v + tau2));
  const sumReW = reWeights.reduce((a, b) => a + b, 0);
  const pooledEffect =
    effects.reduce((sum, e, i) => sum + reWeights[i] * e, 0) / sumReW;
  const pooledVar = 1 / sumReW;
  const pooledSe = Math.sqrt(pooledVar);
  const i2Percent = q > 0 ? Math.max(0, ((q - df) / q) * 100) : 0;

  const forest: ForestPlotEntry[] = sites.map((s, i) => {
    const se = Math.sqrt(variances[i] + tau2);
    return {
      siteId: s.siteId,
      effect: s.effect,
      ci95: [s.effect - Z_975 * se, s.effect + Z_975 * se],
      weightPercent: +((100 * reWeights[i]) / sumReW).toFixed(2),
    };
  });

  return {
    method: "der_simonian_laird",
    k,
    pooledEffect,
    pooledSe,
    ci95: [pooledEffect - Z_975 * pooledSe, pooledEffect + Z_975 * pooledSe],
    heterogeneity: { q, df, tau2, i2Percent },
    forest,
  };
}

/** 站点指纹(用于存证,不含效应量明文以外的个体信息). */
export function fingerprintSiteEffects(sites: SiteEffectEstimate[]): string {
  const canonical = sites
    .map((s) => ({
      siteId: s.siteId,
      effect: +s.effect.toFixed(6),
      standardError: +s.standardError.toFixed(6),
      measure: s.measure ?? null,
    }))
    .sort((a, b) => a.siteId.localeCompare(b.siteId));
  return JSON.stringify(canonical);
}
