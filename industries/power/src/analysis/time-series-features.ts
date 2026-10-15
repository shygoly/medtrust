// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.feature-extraction@1.0.0 的领域逻辑（任务 3.1，spec: power-load-forecast）。
 *
 * 只做纯计算，不做 I/O。输入为单个实体（用户 / 站点）在一个时间窗口内的记录，
 * 输出符合 PowerFeatures 的特征向量。
 */

import type { PowerFeatures, PowerTimeSeriesRecord } from '../records/power-timeseries';

/** 有效样本下限（spec: 有效值 < 3 个时抛出"有效样本不足"） */
export const MIN_VALID_SAMPLES = 3;

export type PowerNumericField = 'activePower' | 'reactivePower' | 'voltage' | 'current';

export interface FeatureExtractionOptions {
  /** 实体 ID（输出字段 entityId） */
  readonly entityId: string;
  /** 时间窗口起止（ISO 8601） */
  readonly windowStart: string;
  readonly windowEnd: string;
  /** 参与特征计算的数值字段，默认 activePower */
  readonly field?: PowerNumericField;
  /** 每个周期的采样点数（例如 15 分钟采样的日周期为 96）；缺省或小于 2 时季节性为 0 */
  readonly seasonalPeriod?: number;
}

/**
 * 收集有效数值样本：跳过 null / undefined / 非有限数。
 *
 * @param records - 时序记录
 * @param field - 目标数值字段
 * @returns 按输入顺序排列的有效数值
 */
export function collectValidValues(
  records: readonly PowerTimeSeriesRecord[],
  field: PowerNumericField,
): number[] {
  const values: number[] = [];
  for (const record of records) {
    const v = record[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      values.push(v);
    }
  }
  return values;
}

/**
 * 统计特征：均值、总体标准差、最大值、最小值。
 *
 * @param values - 非空有效样本
 */
export function basicStatistics(values: readonly number[]): {
  mean: number;
  std: number;
  max: number;
  min: number;
} {
  const n = values.length;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (const v of values) {
    sq += (v - mean) ** 2;
  }
  return { mean, std: Math.sqrt(sq / n), max, min };
}

/**
 * 线性趋势斜率（最小二乘，x 为样本序号）。
 *
 * 注意：这是 STL 趋势分量的简化替代，不是完整 STL 分解（见 README 说明）。
 *
 * @param values - 有效样本（按时间顺序）
 * @returns 每个样本点的趋势斜率；样本少于 2 个时为 0
 */
export function linearTrend(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (values[i]! - meanY);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * 季节性幅度：按相位（index % period）求均值，取相位均值的极差。
 *
 * 注意：这是 STL 季节分量的简化替代，不是完整 STL 分解（见 README 说明）。
 *
 * @param values - 有效样本（按时间顺序）
 * @param period - 周期采样点数
 * @returns 幅度（与原数值同单位）；period < 2 时为 0
 */
export function seasonalAmplitude(values: readonly number[], period: number): number {
  if (!Number.isInteger(period) || period < 2) return 0;
  const sums = new Array<number>(period).fill(0);
  const counts = new Array<number>(period).fill(0);
  values.forEach((v, i) => {
    const phase = i % period;
    sums[phase] = (sums[phase] ?? 0) + v;
    counts[phase] = (counts[phase] ?? 0) + 1;
  });
  const phaseMeans: number[] = [];
  for (let p = 0; p < period; p++) {
    const c = counts[p] ?? 0;
    if (c > 0) phaseMeans.push((sums[p] ?? 0) / c);
  }
  if (phaseMeans.length === 0) return 0;
  return Math.max(...phaseMeans) - Math.min(...phaseMeans);
}

/**
 * 提取单个实体在窗口内的特征向量。
 *
 * - 缺失值（null / undefined / 非有限数）被跳过；有效样本不足 3 个时抛出"有效样本不足"。
 * - 周期性特征（hourOfDay / dayOfWeek / isWeekend）取自 windowStart，按 UTC 计算。
 *
 * @param records - 该实体在窗口内的记录
 * @param options - 实体 ID、窗口与字段配置
 * @returns PowerFeatures
 * @throws Error 当时间戳非法或有效样本不足时
 */
export function extractPowerFeatures(
  records: readonly PowerTimeSeriesRecord[],
  options: FeatureExtractionOptions,
): PowerFeatures {
  const start = new Date(options.windowStart);
  const end = new Date(options.windowEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('窗口时间戳非法');
  }

  const field = options.field ?? 'activePower';
  const values = collectValidValues(records, field);
  if (values.length < MIN_VALID_SAMPLES) {
    throw new Error('有效样本不足');
  }

  const { mean, std, max, min } = basicStatistics(values);
  const dayOfWeek = start.getUTCDay();

  return {
    entityId: options.entityId,
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    mean,
    std,
    max,
    min,
    hourOfDay: start.getUTCHours(),
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    trend: linearTrend(values),
    seasonality: seasonalAmplitude(values, options.seasonalPeriod ?? 0),
    nSamples: values.length,
  };
}
