// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 示例电力时序数据。
 */

import type { PowerTimeSeriesRecord } from '../power-timeseries';

/**
 * 最小示例数据（10 条记录）。
 */
export const minimalExample: PowerTimeSeriesRecord[] = [
  {
    timestamp: '2026-10-15T00:00:00.000Z',
    entityId: 'user-001',
    activePower: 5.2,
    voltage: 220,
  },
  {
    timestamp: '2026-10-15T00:15:00.000Z',
    entityId: 'user-001',
    activePower: 5.8,
    voltage: 221,
  },
  {
    timestamp: '2026-10-15T00:30:00.000Z',
    entityId: 'user-001',
    activePower: 4.9,
    voltage: 220,
  },
  {
    timestamp: '2026-10-15T00:45:00.000Z',
    entityId: 'user-001',
    activePower: 5.1,
    voltage: 219,
  },
  {
    timestamp: '2026-10-15T01:00:00.000Z',
    entityId: 'user-001',
    activePower: 6.2,
    voltage: 222,
  },
  {
    timestamp: '2026-10-15T01:15:00.000Z',
    entityId: 'user-001',
    activePower: 7.5,
    voltage: 223,
  },
  {
    timestamp: '2026-10-15T01:30:00.000Z',
    entityId: 'user-001',
    activePower: 8.1,
    voltage: 224,
  },
  {
    timestamp: '2026-10-15T01:45:00.000Z',
    entityId: 'user-001',
    activePower: 7.8,
    voltage: 223,
  },
  {
    timestamp: '2026-10-15T02:00:00.000Z',
    entityId: 'user-001',
    activePower: 6.9,
    voltage: 221,
  },
  {
    timestamp: '2026-10-15T02:15:00.000Z',
    entityId: 'user-001',
    activePower: 6.3,
    voltage: 220,
  },
];

/**
 * 异常数据示例（缺失值、异常值、边界情况）。
 */
export const anomalyExample: PowerTimeSeriesRecord[] = [
  {
    timestamp: '2026-10-15T00:00:00.000Z',
    entityId: 'user-002',
    activePower: 5.0,
    voltage: 220,
  },
  {
    timestamp: '2026-10-15T00:15:00.000Z',
    entityId: 'user-002',
    // 缺失 activePower
    voltage: 221,
  },
  {
    timestamp: '2026-10-15T00:30:00.000Z',
    entityId: 'user-002',
    activePower: 0, // 零功率（可能窃电）
    voltage: 220,
  },
  {
    timestamp: '2026-10-15T00:45:00.000Z',
    entityId: 'user-002',
    activePower: -2.5, // 负功率（倒流）
    voltage: 219,
  },
  {
    timestamp: '2026-10-15T01:00:00.000Z',
    entityId: 'user-002',
    activePower: 50.0, // 异常高功率
    voltage: 222,
  },
  {
    timestamp: '2026-10-15T01:00:00.000Z', // 重复时间戳
    entityId: 'user-002',
    activePower: 5.5,
    voltage: 221,
  },
  {
    timestamp: '2026-10-15T00:45:00.000Z', // 时间戳非单调
    entityId: 'user-002',
    activePower: 5.2,
    voltage: 220,
  },
];
