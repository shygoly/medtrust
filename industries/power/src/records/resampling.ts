// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力时序数据重采样工具（DESIGN.md §3, specs/power-time-series-format）。
 *
 * 记录类型为只读，因此所有输出记录都以一次对象字面量构造，不做逐字段赋值。
 */

import type { PowerTimeSeriesRecord } from './power-timeseries';

/** 两端都有值时线性插值，否则返回 undefined（不伪造缺失值）。 */
function lerpOptional(
  a: number | undefined,
  b: number | undefined,
  ratio: number
): number | undefined {
  return a !== undefined && b !== undefined ? a + ratio * (b - a) : undefined;
}

/** 数值数组的算术平均；空数组返回 undefined。 */
function meanOf(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 取窗口内某数值字段的全部有效值。 */
function collectNumbers(
  records: readonly PowerTimeSeriesRecord[],
  pick: (r: PowerTimeSeriesRecord) => number | undefined
): number[] {
  return records
    .map(pick)
    .filter((v): v is number => typeof v === 'number');
}

/**
 * 线性插值（上采样）。
 *
 * @param records - 原始记录（按时间排序）
 * @param targetInterval - 目标采样间隔（毫秒）
 * @returns 重采样后的记录
 */
export function upsample(
  records: PowerTimeSeriesRecord[],
  targetInterval: number
): PowerTimeSeriesRecord[] {
  if (records.length < 2) return records;

  const result: PowerTimeSeriesRecord[] = [];

  for (let i = 0; i < records.length - 1; i++) {
    const curr = records[i]!;
    const next = records[i + 1]!;

    result.push(curr);

    const t1 = new Date(curr.timestamp).getTime();
    const t2 = new Date(next.timestamp).getTime();
    const actualInterval = t2 - t1;

    if (actualInterval <= targetInterval) continue;

    // 需要插值的点数
    const numPoints = Math.floor(actualInterval / targetInterval);

    for (let j = 1; j < numPoints; j++) {
      const ratio = (j * targetInterval) / actualInterval;
      const interpolatedTime = new Date(t1 + j * targetInterval);

      const activePower = lerpOptional(curr.activePower, next.activePower, ratio);
      const reactivePower = lerpOptional(curr.reactivePower, next.reactivePower, ratio);
      const voltage = lerpOptional(curr.voltage, next.voltage, ratio);
      const current = lerpOptional(curr.current, next.current, ratio);

      result.push({
        timestamp: interpolatedTime.toISOString(),
        entityId: curr.entityId,
        ...(activePower !== undefined ? { activePower } : {}),
        ...(reactivePower !== undefined ? { reactivePower } : {}),
        ...(voltage !== undefined ? { voltage } : {}),
        ...(current !== undefined ? { current } : {}),
      });
    }
  }

  // 添加最后一条记录
  result.push(records[records.length - 1]!);

  return result;
}

/**
 * 均值聚合（下采样）。
 *
 * @param records - 原始记录（按时间排序）
 * @param targetInterval - 目标采样间隔（毫秒）
 * @returns 重采样后的记录
 */
export function downsample(
  records: PowerTimeSeriesRecord[],
  targetInterval: number
): PowerTimeSeriesRecord[] {
  if (records.length === 0) return [];

  const result: PowerTimeSeriesRecord[] = [];
  const startTime = new Date(records[0]!.timestamp).getTime();

  let windowStart = 0;

  while (windowStart < records.length) {
    const windowTime = startTime + Math.floor(windowStart / records.length * records.length) * targetInterval;

    // 收集当前窗口内的记录
    const windowRecords: PowerTimeSeriesRecord[] = [];
    let i = windowStart;

    while (i < records.length) {
      const recordTime = new Date(records[i]!.timestamp).getTime();
      if (recordTime >= windowTime + targetInterval) break;
      windowRecords.push(records[i]!);
      i++;
    }

    if (windowRecords.length === 0) break;

    // 计算窗口内的均值
    const activePower = meanOf(collectNumbers(windowRecords, (r) => r.activePower));
    const reactivePower = meanOf(collectNumbers(windowRecords, (r) => r.reactivePower));
    const voltage = meanOf(collectNumbers(windowRecords, (r) => r.voltage));
    const current = meanOf(collectNumbers(windowRecords, (r) => r.current));

    result.push({
      timestamp: new Date(windowTime).toISOString(),
      entityId: records[0]!.entityId,
      ...(activePower !== undefined ? { activePower } : {}),
      ...(reactivePower !== undefined ? { reactivePower } : {}),
      ...(voltage !== undefined ? { voltage } : {}),
      ...(current !== undefined ? { current } : {}),
    });
    windowStart = i;
  }

  return result;
}

/**
 * 自动重采样（检测频率并选择上采样或下采样）。
 *
 * @param records - 原始记录
 * @param targetInterval - 目标采样间隔（毫秒）
 * @returns 重采样后的记录
 */
export function resample(
  records: PowerTimeSeriesRecord[],
  targetInterval: number
): PowerTimeSeriesRecord[] {
  if (records.length < 2) return records;

  // 估计当前采样间隔
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(records.length, 10); i++) {
    const prev = new Date(records[i - 1]!.timestamp).getTime();
    const curr = new Date(records[i]!.timestamp).getTime();
    intervals.push(curr - prev);
  }

  const medianInterval = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]!;

  if (medianInterval > targetInterval) {
    // 当前采样率低，需要上采样
    return upsample(records, targetInterval);
  } else if (medianInterval < targetInterval) {
    // 当前采样率高，需要下采样
    return downsample(records, targetInterval);
  } else {
    // 采样率已匹配
    return records;
  }
}
