// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import type { PowerFeatures } from '../records/power-timeseries';
import {
  computePartyWeights,
  weightedMergeFeatures,
} from './load-forecast-merge';

function party(overrides: Partial<PowerFeatures>): PowerFeatures {
  return {
    entityId: 'party',
    windowStart: '2026-10-15T00:00:00.000Z',
    windowEnd: '2026-10-15T23:45:00.000Z',
    mean: 0,
    std: 0,
    max: 0,
    min: 0,
    hourOfDay: 0,
    dayOfWeek: 4,
    isWeekend: false,
    trend: 0,
    seasonality: 0,
    nSamples: 1,
    ...overrides,
  };
}

describe('负荷预测合并：多方加权聚合（任务 3.3.1）', () => {
  describe('computePartyWeights', () => {
    it('权重 = nSamples / 总 nSamples，和为 1', () => {
      const weights = computePartyWeights([
        party({ nSamples: 100 }),
        party({ nSamples: 300 }),
      ]);
      expect(weights[0]).toBeCloseTo(0.25);
      expect(weights[1]).toBeCloseTo(0.75);
      expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1);
    });

    it('空参与方列表抛错', () => {
      expect(() => computePartyWeights([])).toThrow('至少需要一方特征');
    });

    it('总样本数为零时抛错', () => {
      expect(() => computePartyWeights([party({ nSamples: 0 })])).toThrow(
        '总样本数必须为正',
      );
    });
  });

  describe('weightedMergeFeatures', () => {
    it('按样本量加权平均各特征', () => {
      const merged = weightedMergeFeatures([
        party({ mean: 10, std: 2, max: 20, min: 1, trend: 0.5, seasonality: 3, nSamples: 100 }),
        party({ mean: 30, std: 6, max: 40, min: 5, trend: 1.5, seasonality: 7, nSamples: 300 }),
      ]);
      // 权重 0.25 / 0.75
      expect(merged.mean).toBeCloseTo(25);
      expect(merged.std).toBeCloseTo(5);
      expect(merged.max).toBeCloseTo(35);
      expect(merged.min).toBeCloseTo(4);
      expect(merged.trend).toBeCloseTo(1.25);
      expect(merged.seasonality).toBeCloseTo(6);
    });

    it('总样本数与参与方数正确汇总', () => {
      const merged = weightedMergeFeatures([
        party({ nSamples: 40 }),
        party({ nSamples: 60 }),
        party({ nSamples: 100 }),
      ]);
      expect(merged.nSamples).toBe(200);
      expect(merged.partyCount).toBe(3);
      expect(merged.weights).toHaveLength(3);
    });

    it('单方输入时结果等于该方特征（权重 = 1）', () => {
      const only = party({ mean: 12.5, std: 1.5, max: 20, min: 4, trend: 0.1, seasonality: 2, nSamples: 50 });
      const merged = weightedMergeFeatures([only]);
      expect(merged.weights).toEqual([1]);
      expect(merged.mean).toBeCloseTo(12.5);
      expect(merged.std).toBeCloseTo(1.5);
      expect(merged.max).toBeCloseTo(20);
      expect(merged.min).toBeCloseTo(4);
      expect(merged.nSamples).toBe(50);
    });

    it('样本量极不平衡时仍按权重聚合，不拒绝', () => {
      const merged = weightedMergeFeatures([
        party({ mean: 100, nSamples: 1 }),
        party({ mean: 0, nSamples: 999 }),
      ]);
      expect(merged.mean).toBeCloseTo(0.1);
    });

    it('空输入抛错', () => {
      expect(() => weightedMergeFeatures([])).toThrow('至少需要一方特征');
    });
  });
});
