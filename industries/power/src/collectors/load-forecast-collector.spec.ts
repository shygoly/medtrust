// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import type { PowerFeatures } from "../records/power-timeseries";
import {
  LOAD_FORECAST_ANALYSIS_TYPE,
  collectLoadForecast,
  loadForecastAggregationCollector,
} from "./load-forecast-collector";

function party(overrides: Partial<PowerFeatures>): PowerFeatures {
  return {
    entityId: "party",
    windowStart: "2026-10-15T00:00:00.000Z",
    windowEnd: "2026-10-16T00:00:00.000Z",
    mean: 5,
    std: 1,
    max: 9,
    min: 1,
    hourOfDay: 0,
    dayOfWeek: 4,
    isWeekend: false,
    trend: 0.1,
    seasonality: 2,
    nSamples: 10,
    ...overrides,
  };
}

describe("负荷预测平台侧收集器", () => {
  it("按样本量加权合并各方并汇总总样本数", () => {
    const out = collectLoadForecast({
      parties: [party({ mean: 4, nSamples: 10 }), party({ mean: 8, nSamples: 30 })],
    });
    expect(out.merged.nSamples).toBe(40);
    expect(out.merged.partyCount).toBe(2);
    expect(out.merged.mean).toBeCloseTo(7, 10);
  });

  it("输出置信区间且包含均值", () => {
    const out = collectLoadForecast({
      parties: [party({ mean: 4 }), party({ mean: 6 }), party({ mean: 8 })],
    });
    expect(out.confidenceInterval.lower).toBeLessThan(6);
    expect(out.confidenceInterval.upper).toBeGreaterThan(6);
  });

  it("特征重要性之和为 1 且按降序排列", () => {
    const out = collectLoadForecast({ parties: [party({})] });
    const sum = out.featureImportance.reduce((s, e) => s + e.importance, 0);
    expect(sum).toBeCloseTo(1, 10);
    for (let i = 1; i < out.featureImportance.length; i++) {
      expect(out.featureImportance[i - 1]!.importance).toBeGreaterThanOrEqual(
        out.featureImportance[i]!.importance,
      );
    }
  });

  it("空参与方时抛错（fail-closed）", () => {
    expect(() => collectLoadForecast({ parties: [] })).toThrow();
  });

  it("注册声明使用 power.load-forecast 分析类型并可调用 merge", () => {
    expect(loadForecastAggregationCollector.analysisType).toBe(LOAD_FORECAST_ANALYSIS_TYPE);
    const out = loadForecastAggregationCollector.merge({ parties: [party({})] }, {} as never);
    expect(out.merged.nSamples).toBe(10);
  });
});
