// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import type { PowerTimeSeriesRecord } from '../records/power-timeseries';

import {
  basicStatistics,
  collectValidValues,
  extractPowerFeatures,
  linearTrend,
  seasonalAmplitude,
} from './time-series-features';

function rec(activePower: unknown): PowerTimeSeriesRecord {
  return {
    timestamp: '2026-10-15T00:00:00.000Z',
    entityId: 'u1',
    activePower: activePower as number,
  };
}

describe('时序特征工程', () => {
  describe('collectValidValues', () => {
    it('跳过 null / undefined / 非有限数', () => {
      const records = [rec(1), rec(null), rec(undefined), rec(NaN), rec(Infinity), rec(2)];
      expect(collectValidValues(records, 'activePower')).toEqual([1, 2]);
    });
  });

  describe('basicStatistics', () => {
    it('计算均值、总体标准差、最大值、最小值', () => {
      const s = basicStatistics([1, 2, 3, 4]);
      expect(s.mean).toBeCloseTo(2.5);
      expect(s.std).toBeCloseTo(Math.sqrt(1.25));
      expect(s.max).toBe(4);
      expect(s.min).toBe(1);
    });
  });

  describe('linearTrend', () => {
    it('单调递增序列斜率为 1', () => {
      expect(linearTrend([1, 2, 3])).toBeCloseTo(1);
    });
    it('常数序列斜率为 0', () => {
      expect(linearTrend([5, 5, 5, 5])).toBe(0);
    });
    it('样本少于 2 个时为 0', () => {
      expect(linearTrend([7])).toBe(0);
      expect(linearTrend([])).toBe(0);
    });
  });

  describe('seasonalAmplitude', () => {
    it('按相位均值的极差计算幅度', () => {
      expect(seasonalAmplitude([1, 10, 1, 10], 2)).toBeCloseTo(9);
    });
    it('周期小于 2 或非整数时为 0', () => {
      expect(seasonalAmplitude([1, 10, 1, 10], 1)).toBe(0);
      expect(seasonalAmplitude([1, 10, 1, 10], 2.5)).toBe(0);
    });
  });

  describe('extractPowerFeatures', () => {
    const opts = {
      entityId: 'u1',
      windowStart: '2026-10-17T00:00:00.000Z', // 周六
      windowEnd: '2026-10-17T01:00:00.000Z',
    };

    it('输出符合 PowerFeatures 并正确识别周末', () => {
      const f = extractPowerFeatures([rec(1), rec(2), rec(3)], opts);
      expect(f.entityId).toBe('u1');
      expect(f.nSamples).toBe(3);
      expect(f.dayOfWeek).toBe(6);
      expect(f.isWeekend).toBe(true);
      expect(f.hourOfDay).toBe(0);
      expect(f.mean).toBeCloseTo(2);
    });

    it('有效样本不足 3 个时抛出"有效样本不足"', () => {
      expect(() => extractPowerFeatures([rec(1), rec(null)], opts)).toThrow('有效样本不足');
    });

    it('窗口时间戳非法时抛出', () => {
      expect(() =>
        extractPowerFeatures([rec(1), rec(2), rec(3)], { ...opts, windowStart: 'bad' }),
      ).toThrow('窗口时间戳非法');
    });
  });
});
