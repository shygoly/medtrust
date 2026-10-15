// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.load-forecast-merge@1.0.0 的统计输出部分（任务 3.3.4 / 3.3.5，spec: power-load-forecast）。
 *
 * - 置信区间：正态近似，[均值 - z·σ/√n, 均值 + z·σ/√n]。
 * - 特征重要性：按各特征在聚合结果中的相对幅度排序（简化代理，不是模型内部重要性）。
 * 只做纯计算，不做 I/O。
 */

/** 95% 双侧正态分位数 */
export const DEFAULT_Z = 1.96;

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
}

/**
 * 计算均值的置信区间（正态近似）。
 *
 * @param values - 样本（非空，全部为有限数）
 * @param z - 分位数，默认 1.96（95%）
 * @returns 置信区间 [lower, upper]
 * @throws Error 当样本为空或含非有限数时
 */
export function meanConfidenceInterval(
  values: readonly number[],
  z: number = DEFAULT_Z,
): ConfidenceInterval {
  if (values.length === 0) throw new Error('置信区间需要至少一个样本');
  if (!values.every((v) => Number.isFinite(v))) throw new Error('样本包含非有限数');

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const halfWidth = (z * Math.sqrt(variance)) / Math.sqrt(n);
  return { lower: mean - halfWidth, upper: mean + halfWidth };
}

export interface FeatureImportanceEntry {
  readonly feature: string;
  /** 归一化后的重要性，所有条目之和为 1（全为 0 时均为 0） */
  readonly importance: number;
}

/**
 * 特征重要性：按各特征绝对值的占比排序（降序）。
 *
 * 注意：这是聚合特征幅度的代理指标，不是预测模型的内部重要性。
 *
 * @param features - 特征名 → 数值
 * @returns 按重要性降序排列的条目
 */
export function rankFeatureImportance(
  features: Readonly<Record<string, number>>,
): FeatureImportanceEntry[] {
  const entries = Object.entries(features).map(([feature, value]) => ({
    feature,
    magnitude: Number.isFinite(value) ? Math.abs(value) : 0,
  }));
  const total = entries.reduce((s, e) => s + e.magnitude, 0);
  return entries
    .map((e) => ({ feature: e.feature, importance: total === 0 ? 0 : e.magnitude / total }))
    .sort((a, b) => b.importance - a.importance);
}
