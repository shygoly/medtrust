// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 时序文件数据源（D-CN-8）：电力包认领的 schema、文件解析、按电表整理为逐小时序列。
 *
 * 只做纯计算：字节由连接器读出（路径守卫、审计、快照都在连接器侧），这里只解析与整理。
 * 整理口径（wasm 模块按 `i % 24` 取时相，故序列必须从本地 0 点开始、逐小时连续）：
 * - 同一小时内多条读数取均值（15 分钟表计 → 小时均值）；
 * - 序列从首个本地 0 点起截取，到最后一个整点止；
 * - 缺失小时占比 ≤ maxGapRatio 时按两侧线性插值，超过即整表剔除（计数随载荷走，不静默丢弃）。
 */

import { fromCSV, fromJSON } from "../records/data-conversion";
import { isPowerTimeSeriesRecord, type PowerTimeSeriesRecord } from "../records/power-timeseries";

/** 电力包认领的时序 schema（数据产品声明 `{ type:'series-file', schema }`）。 */
export const POWER_SERIES_SCHEMAS = ["power.interval-meter@1"] as const;
export type PowerSeriesSchema = (typeof POWER_SERIES_SCHEMAS)[number];

export function isPowerSeriesSchema(schema: string): schema is PowerSeriesSchema {
  return (POWER_SERIES_SCHEMAS as readonly string[]).includes(schema);
}

const HOUR_MS = 3_600_000;
const DEFAULT_MAX_GAP_RATIO = 0.05;
/** 本地时区偏移（小时）缺省 = 北京时间。 */
export const DEFAULT_UTC_OFFSET_HOURS = 8;

/**
 * 解析时序文件文本：JSON 数组（标准字段）或 CSV（表头即标准字段名）。
 * 任一行不满足标准格式即抛（fail-closed，不跳过坏行）。
 */
export function parsePowerSeriesText(text: string): PowerTimeSeriesRecord[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("时序文件为空");
  const records = trimmed.startsWith("[")
    ? fromJSON(JSON.parse(trimmed) as unknown[])
    : fromCSV(trimmed, {
        timestamp: "timestamp",
        entityId: "entityId",
        activePower: "activePower",
        reactivePower: "reactivePower",
        voltage: "voltage",
        current: "current",
      });
  records.forEach((r, i) => {
    if (!isPowerTimeSeriesRecord(r)) {
      throw new Error(`时序文件第 ${i + 1} 条记录不符合标准格式（timestamp / entityId / 数值字段）`);
    }
  });
  return records;
}

export interface HourlyMeterSeries {
  /** 原始表计标识——只在本节点内存里存在，出域前由降密环键控假名化。 */
  readonly entityId: string;
  /** 首个样本的本地 0 点（ISO）。 */
  readonly windowStart: string;
  /** 末样本之后一小时（ISO，开区间）。 */
  readonly windowEnd: string;
  /** 逐小时有功功率（kW），长度为 24 的整数倍不作要求。 */
  readonly valuesKw: readonly number[];
  /** 插值补上的小时数。 */
  readonly filledHours: number;
}

export interface HourlySeriesResult {
  readonly meters: readonly HourlyMeterSeries[];
  /** 缺失过多或有功功率全缺而剔除的表计数。 */
  readonly excludedMeters: number;
}

/**
 * 按电表分组整理为逐小时序列（表计按标识排序，保证模块输入确定）。
 *
 * @param minHours - 少于此小时数的表计剔除（各算子的最小样本要求不同，由调用方给）
 */
export function toHourlyMeterSeries(
  rows: readonly PowerTimeSeriesRecord[],
  opts: { utcOffsetHours?: number; maxGapRatio?: number; minHours: number },
): HourlySeriesResult {
  const offsetH = opts.utcOffsetHours ?? DEFAULT_UTC_OFFSET_HOURS;
  if (!Number.isInteger(offsetH) || offsetH < -12 || offsetH > 14) {
    throw new Error(`utcOffsetHours 须为 -12..14 的整数：${offsetH}`);
  }
  const maxGap = opts.maxGapRatio ?? DEFAULT_MAX_GAP_RATIO;
  const offsetMs = offsetH * HOUR_MS;

  const byMeter = new Map<string, Map<number, { sum: number; count: number }>>();
  for (const r of rows) {
    if (typeof r.activePower !== "number" || !Number.isFinite(r.activePower)) continue;
    const t = Date.parse(r.timestamp);
    const localHour = Math.floor((t + offsetMs) / HOUR_MS);
    let hours = byMeter.get(r.entityId);
    if (!hours) {
      hours = new Map();
      byMeter.set(r.entityId, hours);
    }
    const cell = hours.get(localHour) ?? { sum: 0, count: 0 };
    cell.sum += r.activePower;
    cell.count += 1;
    hours.set(localHour, cell);
  }

  const meters: HourlyMeterSeries[] = [];
  let excluded = 0;
  const allIds = new Set(rows.map((r) => r.entityId));
  for (const id of [...allIds].sort()) {
    const hours = byMeter.get(id);
    if (!hours || hours.size === 0) {
      excluded++;
      continue;
    }
    const keys = [...hours.keys()].sort((a, b) => a - b);
    const first = Math.ceil(keys[0]! / 24) * 24;
    const last = keys[keys.length - 1]!;
    if (last < first) {
      excluded++;
      continue;
    }
    const len = last - first + 1;
    const raw: (number | undefined)[] = [];
    for (let h = first; h <= last; h++) {
      const c = hours.get(h);
      raw.push(c ? c.sum / c.count : undefined);
    }
    const missing = raw.filter((v) => v === undefined).length;
    if (len < opts.minHours || missing / len > maxGap) {
      excluded++;
      continue;
    }
    const values = interpolateGaps(raw);
    meters.push({
      entityId: id,
      windowStart: new Date(first * HOUR_MS - offsetMs).toISOString(),
      windowEnd: new Date((last + 1) * HOUR_MS - offsetMs).toISOString(),
      valuesKw: values,
      filledHours: missing,
    });
  }
  return { meters, excludedMeters: excluded };
}

/** 两侧线性插值；首尾缺失沿用最近一侧的观测（末小时恒有观测）。 */
function interpolateGaps(raw: readonly (number | undefined)[]): number[] {
  const out = raw.slice() as (number | undefined)[];
  let i = 0;
  while (i < out.length) {
    if (out[i] !== undefined) {
      i++;
      continue;
    }
    const left = i - 1;
    let right = i;
    while (right < out.length && out[right] === undefined) right++;
    const b = out[right]!;
    const a = left >= 0 ? out[left]! : b;
    const span = right - left;
    for (let j = i; j < right; j++) out[j] = a + ((b - a) * (j - left)) / span;
    i = right;
  }
  return out as number[];
}
