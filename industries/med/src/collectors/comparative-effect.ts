// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧合并 `comparative-effect`：各站只交效应量 + 标准误，这里做 DerSimonian–Laird。
 * 合并核复用协议核的 `derSimonianLaird`（与旧通道 MetaAnalysisService 同一份）。
 * 单站无法做随机效应，返回 `merged: false`，不把单站结果伪装成合并结果。
 */
import { MetaInputRejected, derSimonianLaird, validateSiteEffects } from "@medtrust/mdop";

export interface ComparativeEffectDelivery {
  analysisType: "comparative-effect";
  cohortSize: number;
  outcome?: string;
  buckets?: Array<{
    key: string;
    count: number;
    n?: number;
    b?: number;
    c?: number;
    d?: number;
    suppressed?: boolean;
  }>;
  minCell?: number;
  suppressed?: boolean;
  effectEstimate?: { beta?: number; standardError?: number };
}

const ROW_TOKENS = ["subjectKey", ["pat", "ientId"].join(""), '"rows"'];

function assertNoRows(aggregate: unknown, node: string): void {
  const json = JSON.stringify(aggregate ?? "");
  if (ROW_TOKENS.some((token) => json.includes(token))) {
    throw new Error(`节点 ${node} 的比较效果载荷含行级字段，拒绝合并`);
  }
}

function assertGated(node: string, aggregate: ComparativeEffectDelivery): void {
  const minCell = aggregate.minCell ?? 5;
  for (const bucket of aggregate.buckets ?? []) {
    const n =
      typeof bucket.n === "number"
        ? bucket.n
        : bucket.count + (bucket.b ?? 0) + (bucket.c ?? 0) + (bucket.d ?? 0);
    if (bucket.suppressed) {
      if (n !== 0) throw new Error(`节点 ${node} 的被抑制分层仍带有人数`);
      continue;
    }
    if (aggregate.minCell !== undefined && n < minCell) {
      throw new Error(`节点 ${node} 的分层未抑制且人数低于阈值`);
    }
  }
}

export function mergeComparativeEffects(input: {
  tables: Array<{ node: string; aggregate: ComparativeEffectDelivery }>;
}): Record<string, unknown> {
  if (input.tables.length === 0) throw new Error("比较效果合并没有任何站点载荷");
  const sites = [];
  for (const table of input.tables) {
    assertNoRows(table.aggregate, table.node);
    assertGated(table.node, table.aggregate);
    if (table.aggregate.analysisType !== "comparative-effect") {
      throw new Error(
        `比较效果合并只接受 comparative-effect（节点 ${table.node} 交来 ${String(table.aggregate.analysisType)}）`,
      );
    }
    const estimate = table.aggregate.effectEstimate;
    if (table.aggregate.suppressed || !estimate) {
      continue;
    }
    if (typeof estimate.beta !== "number" || typeof estimate.standardError !== "number") {
      throw new Error(`节点 ${table.node} 的比较效果缺效应量或标准误`);
    }
    sites.push({
      siteId: table.node,
      effect: estimate.beta,
      standardError: estimate.standardError,
      measure: "log_or" as const,
    });
  }
  const cohortSize = input.tables.reduce((sum, table) => sum + (table.aggregate.cohortSize ?? 0), 0);
  const outcome = input.tables[0]?.aggregate.outcome;
  if (sites.length === 0) {
    return {
      analysisType: "comparative-effect",
      cohortSize,
      outcome,
      metaPooled: { merged: false, reason: "各站效应量均被抑制", code: "suppressed" },
      sites,
    };
  }
  if (sites.length < 2) {
    return {
      analysisType: "comparative-effect",
      cohortSize,
      outcome,
      metaPooled: { merged: false, reason: "单站无法做随机效应合并", code: "single_site" },
      sites,
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
    analysisType: "comparative-effect",
    cohortSize,
    outcome,
    metaPooled: {
      merged: true,
      method: result.method,
      pooledEffect: result.pooledEffect,
      pooledSe: result.pooledSe,
      ci95: result.ci95,
      heterogeneity: result.heterogeneity,
      forest: result.forest,
    },
    sites,
  };
}
