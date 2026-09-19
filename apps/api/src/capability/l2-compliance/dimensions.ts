import { RiskDimensions, DimensionSource } from "./engine.types";

// 数据敏感度序（仅用于冲突判定，不驱动裁决——裁决升级只看 participantCount / HGR，见 dimensionRisk）
const SENSITIVITY_RANK: Record<string, number> = {
  low: 0,
  deidentified: 0,
  medium: 1,
  high: 2,
  sensitive: 2,
};

// 数据产品分级标签 → 数据敏感度（事实推导，design D3）：NDI 级别 3/4 → high、2 → medium、其余 low。
export function deriveDataSensitivity(level?: string): string | undefined {
  if (level == null || level === "") return undefined;
  const n = Number(level);
  if (!Number.isFinite(n)) return undefined;
  if (n >= 3) return "high";
  if (n === 2) return "medium";
  return "low";
}

// 各维度对"风险高低"的贡献（用于冲突判定：自报贡献 < 推导贡献 = 疑似低报）。
function contribution(key: keyof RiskDimensions, value: unknown): number {
  if (key === "participantCount") return typeof value === "number" ? value : 0;
  if (key === "dataSensitivity") return SENSITIVITY_RANK[String(value)] ?? 0;
  if (key === "humanGeneticResources" || key === "crossBorder")
    return value ? 1 : 0;
  return 0;
}

export interface MergedDimensions {
  dimensions: RiskDimensions;
  sources: Partial<Record<keyof RiskDimensions, DimensionSource>>;
  conflicts: string[];
}

/**
 * 事实优先合并（design D3）：有推导值就用推导值（标 derived），否则用自报值（标 declared）；
 * 自报值比推导值风险更低时记入冲突（疑似低报，以推导为准）。
 */
export function mergeDimensions(
  declared: RiskDimensions,
  derived: Partial<RiskDimensions>,
): MergedDimensions {
  const dimensions: RiskDimensions = { ...declared };
  const sources: Partial<Record<keyof RiskDimensions, DimensionSource>> = {};
  const conflicts: string[] = [];
  for (const k of Object.keys(declared) as (keyof RiskDimensions)[]) {
    if (declared[k] !== undefined) sources[k] = "declared";
  }
  for (const k of Object.keys(derived) as (keyof RiskDimensions)[]) {
    const dv = derived[k];
    if (dv === undefined) continue;
    const declaredVal = declared[k];
    (dimensions as Record<string, unknown>)[k] = dv;
    sources[k] = "derived";
    if (
      declaredVal !== undefined &&
      contribution(k, declaredVal) < contribution(k, dv)
    ) {
      conflicts.push(
        `${k}: 自报 ${JSON.stringify(declaredVal)} 低于推导 ${JSON.stringify(dv)}（疑似低报，以推导为准）`,
      );
    }
  }
  return { dimensions, sources, conflicts };
}

// 键稳定排序后序列化 → 规则摘要可复现（同内容不同键序得同一 SM3）。
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
