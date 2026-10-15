// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧汇总 `algorithm-validation`：各站交 AUC + Hanley 标准误，校准箱和决策曲线原样附上。
 * 被抑制的 AUC 不进入随机效应合并。未抑制却低于声明阈值的箱或决策点，拒绝整份载荷。
 */
import { MetaInputRejected, derSimonianLaird, validateSiteEffects } from "@medtrust/mdop";

export interface AlgorithmValidationDelivery {
  analysisType: "algorithm-validation";
  cohortSize: number;
  minCell?: number;
  suppressed?: boolean;
  effectEstimate?: { beta?: number; standardError?: number };
  calibration?: Array<{ bin: number; n: number; events?: number; suppressed?: boolean }>;
  decisionCurve?: Array<{ threshold: number; netBenefit?: number; suppressed?: boolean }>;
}

const ROW_TOKENS = ["subjectKey", ["pat", "ientId"].join(""), '"rows"'];

function assertNoRows(aggregate: unknown, node: string): void {
  const json = JSON.stringify(aggregate ?? "");
  if (ROW_TOKENS.some((token) => json.includes(token))) {
    throw new Error(`节点 ${node} 的校验载荷含行级字段，拒绝合并`);
  }
}

function assertGated(node: string, aggregate: AlgorithmValidationDelivery): void {
  const minCell = aggregate.minCell ?? 5;
  for (const bin of aggregate.calibration ?? []) {
    if (bin.suppressed) {
      if (bin.n !== 0) throw new Error(`节点 ${node} 的被抑制校准箱仍带有人数`);
      continue;
    }
    if (bin.n < minCell) throw new Error(`节点 ${node} 的校准箱未抑制且人数低于阈值`);
  }
  for (const point of aggregate.decisionCurve ?? []) {
    if (!point.suppressed && aggregate.cohortSize < minCell) {
      throw new Error(`节点 ${node} 的决策曲线未抑制且样本量低于阈值`);
    }
  }
}

export function mergeAlgorithmValidation(input: {
  tables: Array<{ node: string; aggregate: AlgorithmValidationDelivery }>;
}): Record<string, unknown> {
  if (input.tables.length === 0) throw new Error("校验汇总没有任何站点载荷");
  const sites = [];
  const suppressedSites: string[] = [];
  const calibration = [];
  const decisionCurves = [];
  for (const table of input.tables) {
    assertNoRows(table.aggregate, table.node);
    if (table.aggregate.analysisType !== "algorithm-validation") {
      throw new Error(
        `校验汇总只接受 algorithm-validation（节点 ${table.node} 交来 ${String(table.aggregate.analysisType)}）`,
      );
    }
    assertGated(table.node, table.aggregate);
    calibration.push({ siteId: table.node, bins: table.aggregate.calibration ?? [] });
    decisionCurves.push({ siteId: table.node, points: table.aggregate.decisionCurve ?? [] });
    if (table.aggregate.suppressed || !table.aggregate.effectEstimate) {
      suppressedSites.push(table.node);
      continue;
    }
    const estimate = table.aggregate.effectEstimate;
    if (typeof estimate.beta !== "number" || typeof estimate.standardError !== "number") {
      throw new Error(`节点 ${table.node} 的校验缺 AUC 或标准误`);
    }
    sites.push({
      siteId: table.node,
      effect: estimate.beta,
      standardError: estimate.standardError,
      measure: "beta" as const,
    });
  }
  const cohortSize = input.tables.reduce((sum, table) => sum + (table.aggregate.cohortSize ?? 0), 0);
  const base = {
    analysisType: "algorithm-validation",
    cohortSize,
    suppressedSites,
    calibration,
    decisionCurves,
    sites,
  };
  if (sites.length === 0) {
    return { ...base, metaPooled: { merged: false, reason: "各站 AUC 均被抑制", code: "suppressed" } };
  }
  if (sites.length < 2) {
    return { ...base, metaPooled: { merged: false, reason: "单站无法做随机效应合并", code: "single_site" } };
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
