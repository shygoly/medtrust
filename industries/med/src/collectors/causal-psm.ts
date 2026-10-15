// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧合并 `causal-psm`：各站只交平均处理效应 + 标准误。
 * 被最小格抑制的站不进入合并，也不把 0 当成效应量。
 */
import { MetaInputRejected, derSimonianLaird, validateSiteEffects } from "@medtrust/mdop";

export interface CausalPsmDelivery {
  analysisType: "causal-psm";
  cohortSize: number;
  method?: "psm" | "iptw";
  suppressed?: boolean;
  effectEstimate?: { beta?: number; standardError?: number };
}

const ROW_TOKENS = ["subjectKey", ["pat", "ientId"].join(""), '"rows"'];

function assertNoRows(aggregate: unknown, node: string): void {
  const json = JSON.stringify(aggregate ?? "");
  if (ROW_TOKENS.some((token) => json.includes(token))) {
    throw new Error(`节点 ${node} 的因果载荷含行级字段，拒绝合并`);
  }
}

export function mergeCausalPsm(input: {
  tables: Array<{ node: string; aggregate: CausalPsmDelivery }>;
}): Record<string, unknown> {
  if (input.tables.length === 0) throw new Error("因果合并没有任何站点载荷");
  const sites = [];
  const suppressedSites: string[] = [];
  for (const table of input.tables) {
    assertNoRows(table.aggregate, table.node);
    if (table.aggregate.analysisType !== "causal-psm") {
      throw new Error(
        `因果合并只接受 causal-psm（节点 ${table.node} 交来 ${String(table.aggregate.analysisType)}）`,
      );
    }
    if (table.aggregate.suppressed || !table.aggregate.effectEstimate) {
      suppressedSites.push(table.node);
      continue;
    }
    const estimate = table.aggregate.effectEstimate;
    if (typeof estimate.beta !== "number" || typeof estimate.standardError !== "number") {
      throw new Error(`节点 ${table.node} 的因果效应缺效应量或标准误`);
    }
    sites.push({
      siteId: table.node,
      effect: estimate.beta,
      standardError: estimate.standardError,
      measure: "ate" as const,
    });
  }
  const cohortSize = input.tables.reduce((sum, table) => sum + (table.aggregate.cohortSize ?? 0), 0);
  const base = {
    analysisType: "causal-psm",
    cohortSize,
    suppressedSites,
    sites,
  };
  if (sites.length === 0) {
    return {
      ...base,
      metaPooled: { merged: false, reason: "各站效应量均被最小格抑制", code: "suppressed" },
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
