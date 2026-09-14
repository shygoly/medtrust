// RBQM 中心化监查前端类型 + 呈现映射（rbqm-central-monitoring）。
// 站点 × KRI 观测组织成矩阵供热力展示；riskTier / severity → 色彩与文案。

export type KriDirection = "higher_worse" | "lower_worse";
export type KriRiskTier = "routine" | "elevated" | "intensive";
export type QtlLevel = "warning" | "critical";

export interface QtlThreshold {
  level: QtlLevel;
  op: "gte" | "lte";
  value: number;
}

export interface KriDefinition {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  riskTier: KriRiskTier;
  direction: KriDirection;
  windowKind: string;
  thresholds: QtlThreshold[] | null;
  description: string;
  status: string;
}

export interface KriObservation {
  id: string;
  kriCode: string;
  siteId: string;
  siteName: string;
  studyId: string;
  periodStart: string;
  periodEnd: string;
  numerator: number;
  denominator: number;
  value: number;
  cohortSize: number;
  suppressed: boolean;
  submittedAt: string;
}

export interface QtlBreach {
  id: string;
  kriCode: string;
  siteId: string;
  studyId: string;
  observedValue: number;
  thresholdLevel: QtlLevel;
  thresholdValue: number;
  severity: QtlLevel;
  status: "open" | "acknowledged" | "resolved";
  detectedAt: string;
  attestationTxHash: string;
  attestationBlock: number;
}

export const RISK_TIER_LABEL: Record<KriRiskTier, string> = {
  routine: "常规",
  elevated: "加强",
  intensive: "密集",
};

export const SEVERITY_LABEL: Record<QtlLevel, string> = {
  warning: "预警",
  critical: "严重",
};

/** severity/riskTier → cs- 主题色变量。critical=red，warning=amber。 */
export function severityColor(level: QtlLevel): string {
  return level === "critical" ? "var(--cs-red)" : "var(--cs-amber)";
}

export function riskTierColor(tier: KriRiskTier): string {
  return tier === "intensive"
    ? "var(--cs-red)"
    : tier === "elevated"
      ? "var(--cs-amber)"
      : "var(--cs-dim)";
}

/**
 * 对一条观测按其 KRI 定义判定命中层级（前端用于热力着色）。
 * 与后端 evaluateBreach 同语义；suppressed 观测返回 null。
 */
export function observationLevel(
  obs: KriObservation,
  def: KriDefinition | undefined,
): QtlLevel | null {
  if (!def || obs.suppressed || !def.thresholds) return null;
  const rank: Record<QtlLevel, number> = { warning: 1, critical: 2 };
  let best: QtlLevel | null = null;
  for (const t of def.thresholds) {
    const op = t.op ?? (def.direction === "higher_worse" ? "gte" : "lte");
    const matched = op === "gte" ? obs.value >= t.value : obs.value <= t.value;
    if (matched && (!best || rank[t.level] > rank[best])) best = t.level;
  }
  return best;
}

export interface SiteRow {
  siteId: string;
  siteName: string;
  cells: Map<string, KriObservation>; // kriCode → observation
}

/** 观测数组 → 按站点分组的行（列 = KRI code，供矩阵渲染）。 */
export function buildMatrix(observations: KriObservation[]): SiteRow[] {
  const bySite = new Map<string, SiteRow>();
  for (const o of observations) {
    let row = bySite.get(o.siteId);
    if (!row) {
      row = { siteId: o.siteId, siteName: o.siteName || o.siteId, cells: new Map() };
      bySite.set(o.siteId, row);
    }
    row.cells.set(o.kriCode, o);
  }
  return [...bySite.values()].sort((a, b) => a.siteId.localeCompare(b.siteId));
}

/** 值 → 百分比字符串（KRI 皆为 0–1 比例）。 */
export function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}
