// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.theft-merge@1.0.0 的领域逻辑（任务 5.3，spec: power-theft-detection）。
 *
 * 跨区域异常评分聚合 → Top-K 疑似列表 + 模糊化区域窃电率。
 * 只做纯计算，不做 I/O。
 */

import type { AnomalyDetectionResult, AnomalyType } from "./anomaly-detection";

export type TheftMergeStrategy = "weighted_avg" | "max" | "vote";

export interface RegionAnomalyBatch {
  /** 供电局标识（不进入最终用户列表，只计 detectedBy） */
  readonly regionId: string;
  readonly results: readonly AnomalyDetectionResult[];
}

export interface TheftMergeSpec {
  readonly anomalyThreshold: number;
  readonly topK: number;
  readonly strategy?: TheftMergeStrategy;
  /**
   * 全体表计数（窃电率分母）。节点只放行超阈值表计时，结果条数不是总户数；
   * 缺省按出现在结果里的表计数计。
   */
  readonly populationSize?: number;
}

export interface SuspiciousUser {
  readonly entityId: string;
  readonly aggregatedScore: number;
  readonly detectedBy: number;
  readonly anomalyType: AnomalyType;
}

export interface TheftMergeResult {
  readonly suspiciousUsers: readonly SuspiciousUser[];
  /** 模糊化后的窃电率（百分比整数，粒度 ≥ 1%） */
  readonly theftRate: number;
  readonly granularity: number;
  readonly totalUsers: number;
  readonly nRegions: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 单向脱敏：不保留可逆映射 */
export function hashEntityId(entityId: string): string {
  let h = 2166136261;
  for (let i = 0; i < entityId.length; i++) {
    h ^= entityId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `u_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** 评分分段（隐私：不输出精确小数） */
export function bucketScore(score: number): number {
  const s = clamp01(score);
  if (s < 0.3) return 0.2;
  if (s < 0.5) return 0.4;
  if (s < 0.7) return 0.6;
  if (s < 0.8) return 0.75;
  if (s < 0.9) return 0.85;
  return 0.95;
}

/**
 * 聚合跨区域异常检测结果。
 */
export function mergeTheftDetections(
  regions: readonly RegionAnomalyBatch[],
  spec: TheftMergeSpec,
): TheftMergeResult {
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error("至少需要一个供电局检测结果");
  }
  if (!(spec.anomalyThreshold >= 0 && spec.anomalyThreshold <= 1)) {
    throw new Error("异常阈值应在 0-1 之间");
  }
  if (!(Number.isInteger(spec.topK) && spec.topK > 0)) {
    throw new Error("topK 必须为正整数");
  }

  const strategy: TheftMergeStrategy = spec.strategy ?? "max";
  type Agg = {
    scores: number[];
    regions: Set<string>;
    types: AnomalyType[];
    weight: number;
  };
  const byUser = new Map<string, Agg>();

  for (const region of regions) {
    for (const r of region.results) {
      let agg = byUser.get(r.entityId);
      if (!agg) {
        agg = { scores: [], regions: new Set(), types: [], weight: 0 };
        byUser.set(r.entityId, agg);
      }
      agg.scores.push(r.anomalyScore);
      agg.regions.add(region.regionId);
      agg.types.push(r.anomalyType);
      agg.weight += 1;
    }
  }

  if (spec.populationSize !== undefined && !(Number.isInteger(spec.populationSize) && spec.populationSize >= byUser.size)) {
    throw new Error("populationSize 必须为整数且不小于结果中的表计数");
  }
  const totalUsers = spec.populationSize ?? byUser.size;
  const nRegions = regions.length;
  const candidates: SuspiciousUser[] = [];

  for (const [entityId, agg] of byUser) {
    let aggregatedScore: number;
    switch (strategy) {
      case "weighted_avg":
        aggregatedScore = agg.scores.reduce((s, v) => s + v, 0) / agg.scores.length;
        break;
      case "vote": {
        const votes = agg.scores.filter((s) => s >= spec.anomalyThreshold).length;
        aggregatedScore = votes / Math.max(1, nRegions);
        break;
      }
      case "max":
      default:
        aggregatedScore = Math.max(...agg.scores);
        break;
    }

    // 单区域主导：若仅 1 个区域检出且总分局 > 1，略微降权
    if (agg.regions.size === 1 && nRegions > 1) {
      aggregatedScore *= 0.85;
    }

    if (aggregatedScore < spec.anomalyThreshold) continue;

    const typeCounts = new Map<AnomalyType, number>();
    for (const t of agg.types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    let anomalyType: AnomalyType = "none";
    let best = 0;
    for (const [t, c] of typeCounts) {
      if (c > best && t !== "none" && t !== "insufficient_data") {
        best = c;
        anomalyType = t;
      }
    }

    candidates.push({
      entityId: hashEntityId(entityId),
      aggregatedScore: bucketScore(aggregatedScore),
      detectedBy: agg.regions.size,
      anomalyType,
    });
  }

  candidates.sort((a, b) => b.aggregatedScore - a.aggregatedScore);
  const suspiciousUsers = candidates.slice(0, spec.topK);

  // 窃电率：异常用户 / 总用户，模糊化到 ≥ 1% 整数百分点
  const rawRate = totalUsers === 0 ? 0 : (candidates.length / totalUsers) * 100;
  const theftRate = Math.round(rawRate); // 1% 粒度
  const granularity = 1;

  return {
    suspiciousUsers,
    theftRate,
    granularity,
    totalUsers,
    nRegions,
  };
}
