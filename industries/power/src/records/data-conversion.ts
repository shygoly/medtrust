// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力时序数据转换工具（DESIGN.md §3, specs/power-time-series-format）。
 *
 * 记录一律以单个对象字面量一次构造（PowerTimeSeriesRecord 为只读类型，
 * 不做构造后逐字段赋值）。标准字段优先级高于扩展字段。
 */

import type { PowerTimeSeriesRecord } from './power-timeseries';

export interface ColumnMapping {
  timestamp: string;
  entityId: string;
  activePower?: string;
  reactivePower?: string;
  voltage?: string;
  current?: string;
}

/** 构造阶段的可变数值字段集合（记录本身只读，构造完成后不再修改）。 */
type NumericFields = {
  activePower?: number;
  reactivePower?: number;
  voltage?: number;
  current?: number;
};

const NUMERIC_KEYS = ['activePower', 'reactivePower', 'voltage', 'current'] as const;
const STANDARD_KEYS = ['timestamp', 'entityId', ...NUMERIC_KEYS] as const;

/**
 * 以一次对象展开构造记录：扩展字段在前，标准字段覆盖其上。
 *
 * @param base - 必填标准字段
 * @param numeric - 可选数值字段（仅包含已解析出的字段）
 * @param extensions - 其余扩展字段
 * @returns 标准格式记录
 */
function buildRecord(
  base: { timestamp: string; entityId: string },
  numeric: NumericFields,
  extensions: Record<string, unknown>,
): PowerTimeSeriesRecord {
  return { ...extensions, ...numeric, ...base };
}

/**
 * 从 CSV 格式转换为标准格式。
 *
 * @param csvText - CSV 文本内容
 * @param mapping - 列映射配置
 * @returns 标准格式记录数组
 */
export function fromCSV(
  csvText: string,
  mapping: ColumnMapping
): PowerTimeSeriesRecord[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV 至少需要包含表头和一行数据');
  }

  const headers = lines[0]!.split(',').map((h) => h.trim());
  const consumedColumns = new Set<string>(Object.values(mapping));
  const records: PowerTimeSeriesRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(',').map((v) => v.trim());
    const row: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      const value = values[index];
      if (value !== undefined && value !== '') {
        row[header] = value;
      }
    });

    const numeric: NumericFields = {};
    for (const key of NUMERIC_KEYS) {
      const column = mapping[key];
      if (column && row[column] !== undefined) {
        numeric[key] = parseFloat(String(row[column]));
      }
    }

    const extensions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!consumedColumns.has(key)) {
        extensions[key] = value;
      }
    }

    records.push(
      buildRecord(
        {
          timestamp: String(row[mapping.timestamp] ?? ''),
          entityId: String(row[mapping.entityId] ?? ''),
        },
        numeric,
        extensions,
      ),
    );
  }

  return records;
}

/**
 * 从 JSON 格式转换为标准格式。
 *
 * @param jsonData - JSON 数据（对象数组）
 * @returns 标准格式记录数组
 */
export function fromJSON(jsonData: unknown[]): PowerTimeSeriesRecord[] {
  if (!Array.isArray(jsonData)) {
    throw new Error('JSON 数据必须是数组');
  }

  return jsonData.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`记录 ${index} 不是有效的对象`);
    }

    const row = item as Record<string, unknown>;

    const numeric: NumericFields = {};
    for (const key of NUMERIC_KEYS) {
      if (row[key] !== undefined) {
        const val = Number(row[key]);
        if (Number.isFinite(val)) numeric[key] = val;
      }
    }

    const extensions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!(STANDARD_KEYS as readonly string[]).includes(key)) {
        extensions[key] = value;
      }
    }

    return buildRecord(
      {
        timestamp: String(row.timestamp ?? ''),
        entityId: String(row.entityId ?? ''),
      },
      numeric,
      extensions,
    );
  });
}

/**
 * 去重：保留最后一条（最新数据）。
 */
export function deduplicateByTimestamp(
  records: PowerTimeSeriesRecord[]
): PowerTimeSeriesRecord[] {
  const map = new Map<string, PowerTimeSeriesRecord>();

  for (const record of records) {
    map.set(record.timestamp, record);
  }

  return Array.from(map.values()).sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
