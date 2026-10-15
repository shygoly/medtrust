// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力时序数据质量检查工具（DESIGN.md §3, specs/power-time-series-format）。
 */

import type { PowerTimeSeriesRecord } from './power-timeseries';

export interface DataQualityReport {
  /** 总记录数 */
  totalRecords: number;
  /** 时间戳单调性检查 */
  isMonotonic: boolean;
  /** 缺失值比例（0-1） */
  missingRatio: number;
  /** 异常值数量 */
  outlierCount: number;
  /** 重复记录数量 */
  duplicateCount: number;
  /** 采样频率（毫秒） */
  samplingInterval?: number;
  /** 质量等级 */
  quality: 'good' | 'acceptable' | 'poor';
}

/**
 * 检查时间戳单调性。
 */
export function checkMonotonicity(records: PowerTimeSeriesRecord[]): boolean {
  if (records.length < 2) return true;

  for (let i = 1; i < records.length; i++) {
    const prev = new Date(records[i - 1]!.timestamp).getTime();
    const curr = new Date(records[i]!.timestamp).getTime();
    if (curr <= prev) return false;
  }

  return true;
}

/**
 * 计算缺失值比例（0-1）。
 *
 * 只统计数据集中至少有一条记录提供的数值字段：标准格式中可选字段
 * 若整体未采集（如无功、电流），不应被计为缺失。
 */
export function calculateMissingRatio(records: PowerTimeSeriesRecord[]): number {
  if (records.length === 0) return 0;

  const fields = ['activePower', 'reactivePower', 'voltage', 'current'] as const;
  const presentFields = fields.filter((field) =>
    records.some((record) => record[field] !== undefined && record[field] !== null)
  );
  if (presentFields.length === 0) return 0;

  let missingCount = 0;
  for (const record of records) {
    for (const field of presentFields) {
      if (record[field] === undefined || record[field] === null) {
        missingCount++;
      }
    }
  }

  return missingCount / (records.length * presentFields.length);
}

/**
 * 检测异常值（使用 IQR 方法）。
 */
export function detectOutliers(
  records: PowerTimeSeriesRecord[],
  field: 'activePower' | 'reactivePower' | 'voltage' | 'current'
): number {
  const values = records
    .map((r) => r[field])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (values.length < 4) return 0;

  const q1 = values[Math.floor(values.length * 0.25)]!;
  const q3 = values[Math.floor(values.length * 0.75)]!;
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return values.filter((v) => v < lowerBound || v > upperBound).length;
}

/**
 * 检测重复记录（相同时间戳）。
 */
export function detectDuplicates(records: PowerTimeSeriesRecord[]): number {
  const timestamps = new Set<string>();
  let duplicates = 0;

  for (const record of records) {
    if (timestamps.has(record.timestamp)) {
      duplicates++;
    } else {
      timestamps.add(record.timestamp);
    }
  }

  return duplicates;
}

/**
 * 估计采样频率（毫秒）。
 */
export function estimateSamplingInterval(records: PowerTimeSeriesRecord[]): number | undefined {
  if (records.length < 2) return undefined;

  const intervals: number[] = [];
  for (let i = 1; i < Math.min(records.length, 100); i++) {
    const prev = new Date(records[i - 1]!.timestamp).getTime();
    const curr = new Date(records[i]!.timestamp).getTime();
    intervals.push(curr - prev);
  }

  // 返回中位数
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)];
}

/**
 * 执行完整的数据质量检查。
 */
export function checkDataQuality(records: PowerTimeSeriesRecord[]): DataQualityReport {
  const isMonotonic = checkMonotonicity(records);
  const missingRatio = calculateMissingRatio(records);
  const outlierCount = detectOutliers(records, 'activePower');
  const duplicateCount = detectDuplicates(records);
  const samplingInterval = estimateSamplingInterval(records);

  let quality: 'good' | 'acceptable' | 'poor';
  if (!isMonotonic || missingRatio > 0.8) {
    quality = 'poor';
  } else if (missingRatio > 0.3 || duplicateCount > records.length * 0.1) {
    quality = 'acceptable';
  } else {
    quality = 'good';
  }

  return {
    totalRecords: records.length,
    isMonotonic,
    missingRatio,
    outlierCount,
    duplicateCount,
    samplingInterval,
    quality,
  };
}
