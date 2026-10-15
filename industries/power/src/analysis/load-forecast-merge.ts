// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.load-forecast-merge@1.0.0 的聚合部分（任务 3.3.1，spec: power-load-forecast）。
 *
 * 按样本量加权平均各方特征：权重 = 各方 nSamples / 总 nSamples，加权特征 = Σ(特征 × 权重)。
 * 只做纯计算，不做 I/O；预测模型（LSTM / Transformer）不在本文件内。
 */

import type { PowerFeatures } from '../records/power-timeseries';

export type FeatureNumericKey =
  | 'mean'
  | 'std'
  | 'max'
  | 'min'
  | 'trend'
  | 'seasonality';

export const WEIGHTED_FEATURE_KEYS: readonly FeatureNumericKey[] = [
  'mean',
  'std',
  'max',
  'min',
  'trend',
  'seasonality',
];

export interface MergedFeatures {
  /** 各特征按样本量加权后的结果 */
  readonly mean: number;
  readonly std: number;
  readonly max: number;
  readonly min: number;
  readonly trend: number;
  readonly seasonality: number;
  /** 总样本数（各方之和） */
  readonly nSamples: number;
  /** 参与聚合的方数 */
  readonly partyCount: number;
  /** 与 parties 同序的权重，和为 1 */
  readonly weights: readonly number[];
}

/**
 * 计算各方权重：nSamples / 总 nSamples。
 *
 * @param parties - 各方特征（非空）
 * @returns 与输入同序的权重数组，和为 1
 * @throws Error 当参与方为空或总样本数不为正时
 */
export function computePartyWeights(parties: readonly PowerFeatures[]): number[] {
  if (parties.length === 0) throw new Error('至少需要一方特征');
  const total = parties.reduce((sum, p) => sum + p.nSamples, 0);
  if (!(total > 0)) throw new Error('总样本数必须为正');
  return parties.map((p) => p.nSamples / total);
}

/**
 * 按样本量加权聚合多方特征。
 *
 * - 单方输入时权重为 1，结果等于该方特征（边界情况，spec 要求）。
 * - 样本量不平衡时按权重聚合，不拒绝。
 * - 各方的 windowStart / windowEnd 不一致时仍聚合，由调用方保证窗口对齐。
 *
 * @param parties - 各方特征
 * @returns 加权后的聚合特征
 * @throws Error 当参与方为空或总样本数不为正时
 */
export function weightedMergeFeatures(parties: readonly PowerFeatures[]): MergedFeatures {
  const weights = computePartyWeights(parties);

  const weighted = (key: FeatureNumericKey): number =>
    parties.reduce((sum, p, i) => sum + p[key] * weights[i]!, 0);

  return {
    mean: weighted('mean'),
    std: weighted('std'),
    max: weighted('max'),
    min: weighted('min'),
    trend: weighted('trend'),
    seasonality: weighted('seasonality'),
    nSamples: parties.reduce((sum, p) => sum + p.nSamples, 0),
    partyCount: parties.length,
    weights,
  };
}
