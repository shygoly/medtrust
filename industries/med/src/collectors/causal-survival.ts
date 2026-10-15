// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧合并 `causal-survival`：各站交 log HR + 标准误，曲线只保留已经分箱且过阈值的箱。
 * 被抑制的风险比不进入合并。未抑制的箱若在险人数低于该曲线声明的阈值，拒绝整份载荷。
 */
import { MetaInputRejected, derSimonianLaird, validateSiteEffects } from "@medtrust/mdop";

export interface SurvivalBin {
  t: number;
  survival: number;
  atRisk: number;
  suppressed?: boolean;
}

export interface CausalSurvivalDelivery {
  analysisType: "causal-survival";
  cohortSize: number;
  suppressed?: boolean;
  effectEstimate?: { beta?: number; standardError?: number };
  kmCurve?: { binWidthDays?: number; minCell?: number; bins?: SurvivalBin[] };
}

const ROW_TOKENS = ["subjectKey", ["pat", "ientId"].join(""), '"rows"'];

function assertNoRows(aggregate: unknown, node: string): void {
  const json = JSON.stringify(aggregate ?? "");
  if (ROW_TOKENS.some((token) => json.includes(token))) {
    throw new Error(`节点 ${node} 的生存载荷含行级字段，拒绝合并`);
  }
}

function assertCurve(node: string, curve: CausalSurvivalDelivery["kmCurve"]): SurvivalBin[] {
  const bins = curve?.bins ?? [];
  const minCell = curve?.minCell ?? 5;
  const width = curve?.binWidthDays ?? 0;
  if (width < 1) throw new Error(`节点 ${node} 的生存曲线缺少分箱宽度`);
  for (const bin of bins) {
    if (bin.suppressed) {
      if (bin.atRisk !== 0) throw new Error(`节点 ${node} 的被抑制箱仍带有在险人数`);
      continue;
    }
    if (bin.atRisk < minCell) {
      throw new Error(`节点 ${node} 的生存曲线有未抑制的小在险人数箱`);
    }
  }
  return bins;
}

export function mergeCausalSurvival(input: {
  tables: Array<{ node: string; aggregate: CausalSurvivalDelivery }>;
}): Record<string, unknown> {
  if (input.tables.length === 0) throw new Error("生存合并没有任何站点载荷");
  const sites = [];
  const suppressedSites: string[] = [];
  const curves = [];
  for (const table of input.tables) {
    assertNoRows(table.aggregate, table.node);
    if (table.aggregate.analysisType !== "causal-survival") {
      throw new Error(
        `生存合并只接受 causal-survival（节点 ${table.node} 交来 ${String(table.aggregate.analysisType)}）`,
      );
    }
    const bins = assertCurve(table.node, table.aggregate.kmCurve);
    curves.push({
      siteId: table.node,
      binWidthDays: table.aggregate.kmCurve?.binWidthDays,
      bins,
    });
    if (table.aggregate.suppressed || !table.aggregate.effectEstimate) {
      suppressedSites.push(table.node);
      continue;
    }
    const estimate = table.aggregate.effectEstimate;
    if (typeof estimate.beta !== "number" || typeof estimate.standardError !== "number") {
      throw new Error(`节点 ${table.node} 的生存效应缺 log HR 或标准误`);
    }
    sites.push({
      siteId: table.node,
      effect: estimate.beta,
      standardError: estimate.standardError,
      measure: "log_hr" as const,
    });
  }
  const cohortSize = input.tables.reduce((sum, table) => sum + (table.aggregate.cohortSize ?? 0), 0);
  const base = {
    analysisType: "causal-survival",
    cohortSize,
    suppressedSites,
    curves,
    sites,
  };
  if (sites.length === 0) {
    return {
      ...base,
      metaPooled: { merged: false, reason: "各站风险比均被抑制", code: "suppressed" },
    };
  }
  if (sites.length < 2) {
    return {
      ...base,
      metaPooled: { merged: false, reason: "单站无法做随机效应合并", code: "single_site" },
    };
  }
  let validated;
  try {
    validated = validateSiteEffects(sites);
  } catch (err) {
    if (err instanceof MetaInputRejected) throw new Error(err.message);
    throw err;
  }
  const result = derSimonianLaird(validated);
  return {
    ...base,
    metaPooled: {
      merged: true,
      method: result.method,
      pooledEffect: result.pooledEffect,
      pooledSe: result.pooledSe,
      ci95: result.ci95,
      heterogeneity: result.heterogeneity,
      forest: result.forest,
    },
  };
}
