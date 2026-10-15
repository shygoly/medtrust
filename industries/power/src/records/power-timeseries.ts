// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力时序数据标准格式（DESIGN.md §3）。
 *
 * 只定义形状与类型守卫，不做 I/O。entityId 可以是脱敏后的标识，
 * 本模块不负责脱敏。
 */

export interface PowerTimeSeriesRecord {
  /** ISO 8601 时间戳 */
  readonly timestamp: string;
  /** 用户或站点标识（可脱敏） */
  readonly entityId: string;
  /** 有功功率（kW） */
  readonly activePower?: number;
  /** 无功功率（kVar） */
  readonly reactivePower?: number;
  /** 电压（V） */
  readonly voltage?: number;
  /** 电流（A） */
  readonly current?: number;
  /** 扩展字段（天气、生产状态等） */
  readonly [key: string]: unknown;
}

export interface PowerFeatures {
  readonly entityId: string;
  /** 时间窗口起止（ISO 8601） */
  readonly windowStart: string;
  readonly windowEnd: string;
  /** 统计特征 */
  readonly mean: number;
  readonly std: number;
  readonly max: number;
  readonly min: number;
  /** 周期性特征 */
  readonly hourOfDay: number;
  readonly dayOfWeek: number;
  readonly isWeekend: boolean;
  /** 趋势特征 */
  readonly trend: number;
  readonly seasonality: number;
  /** 样本数（用于安全聚合加权） */
  readonly nSamples: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export function isPowerTimeSeriesRecord(value: unknown): value is PowerTimeSeriesRecord {
  if (!isObject(value)) return false;
  if (!isIsoTimestamp(value.timestamp)) return false;
  if (typeof value.entityId !== "string" || value.entityId.length === 0) return false;
  return (
    isOptionalFiniteNumber(value.activePower) &&
    isOptionalFiniteNumber(value.reactivePower) &&
    isOptionalFiniteNumber(value.voltage) &&
    isOptionalFiniteNumber(value.current)
  );
}

export function isPowerFeatures(value: unknown): value is PowerFeatures {
  if (!isObject(value)) return false;
  if (typeof value.entityId !== "string" || value.entityId.length === 0) return false;
  if (!isIsoTimestamp(value.windowStart) || !isIsoTimestamp(value.windowEnd)) return false;
  const numericKeys = [
    "mean",
    "std",
    "max",
    "min",
    "hourOfDay",
    "dayOfWeek",
    "trend",
    "seasonality",
    "nSamples",
  ] as const;
  for (const key of numericKeys) {
    const v = value[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return typeof value.isWeekend === "boolean";
}
