// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 负荷预测场景端到端测试（任务 3.7）。
 *
 * 链路：两方时序数据 → 按方特征提取 → 按样本量加权聚合 → 基线预测 → 置信区间。
 * 不走沙箱（3.2 已 DEFERRED），直接调用 analysis/ 下的纯函数。
 */

import { PlanInputError } from "@medtrust/mdop";

import {
  extractPowerFeatures,
  weightedMergeFeatures,
  meanConfidenceInterval,
} from "../../analysis";
import { baselineForecast } from "../../analysis/load-forecast-model";
import type { PowerTimeSeriesRecord } from "../../records/power-timeseries";
import { buildLoadForecastPlan } from "../load-forecast";

const DAYS = 30;
const HOURS_PER_DAY = 24;
const PERIOD = HOURS_PER_DAY;
const START_MS = Date.parse("2026-10-01T00:00:00Z");
const WINDOW_START = "2026-10-01T00:00:00Z";
const WINDOW_END = new Date(START_MS + DAYS * 24 * 3600_000).toISOString();

/**
 * 生成确定性的小时级数据：日周期正弦 + 线性趋势 + 方级偏移。
 * 趋势使季节朴素残差为非零常数，从而 RMSE > 0。
 */
function buildPartySeries(entityId: string, offset: number): PowerTimeSeriesRecord[] {
  const records: PowerTimeSeriesRecord[] = [];
  for (let h = 0; h < DAYS * HOURS_PER_DAY; h++) {
    const hourOfDay = h % HOURS_PER_DAY;
    records.push({
      timestamp: new Date(START_MS + h * 3600_000).toISOString(),
      entityId,
      activePower: 100 + offset + 20 * Math.sin((2 * Math.PI * hourOfDay) / HOURS_PER_DAY) + (0.1 * h) / HOURS_PER_DAY,
    });
  }
  return records;
}

/** 按小时对齐的多方加权序列：每个时刻取各方值按权重求和。 */
function combineSeries(
  series: readonly (readonly number[])[],
  weights: readonly number[],
): number[] {
  const length = series[0]!.length;
  const combined: number[] = [];
  for (let h = 0; h < length; h++) {
    combined.push(series.reduce((sum, s, i) => sum + s[h]! * weights[i]!, 0));
  }
  return combined;
}

describe("负荷预测端到端链路（3.7）", () => {
  const partyA = buildPartySeries("grid-a", 0);
  const partyB = buildPartySeries("grid-b", 10);

  it("两方特征提取后，各方样本数为 720 且窗口信息透传", () => {
    const featA = extractPowerFeatures(partyA, {
      entityId: "grid-a",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seasonalPeriod: PERIOD,
    });
    const featB = extractPowerFeatures(partyB, {
      entityId: "grid-b",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seasonalPeriod: PERIOD,
    });

    expect(featA.nSamples).toBe(DAYS * HOURS_PER_DAY);
    expect(featB.nSamples).toBe(DAYS * HOURS_PER_DAY);
    expect(featA.windowStart).toBe(WINDOW_START);
    expect(featA.windowEnd).toBe(WINDOW_END);
    expect(featB.mean).toBeGreaterThan(featA.mean);
  });

  it("等样本量两方加权聚合后权重相等、总样本数为两方之和", () => {
    const featA = extractPowerFeatures(partyA, {
      entityId: "grid-a",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seasonalPeriod: PERIOD,
    });
    const featB = extractPowerFeatures(partyB, {
      entityId: "grid-b",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seasonalPeriod: PERIOD,
    });

    const merged = weightedMergeFeatures([featA, featB]);

    expect(merged.partyCount).toBe(2);
    expect(merged.nSamples).toBe(2 * DAYS * HOURS_PER_DAY);
    expect(merged.weights[0]).toBeCloseTo(0.5, 10);
    expect(merged.weights[1]).toBeCloseTo(0.5, 10);
    expect(merged.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
    expect(merged.mean).toBeCloseTo((featA.mean + featB.mean) / 2, 10);
  });

  it("基线预测输出 24 步曲线，MAPE 在合理范围、RMSE 为正", () => {
    const series = [partyA, partyB].map((recs) =>
      recs.map((r) => r.activePower as number),
    );
    const weights = [0.5, 0.5];
    const history = combineSeries(series, weights);

    const result = baselineForecast(history, HOURS_PER_DAY, PERIOD);

    expect(result.model).toBe("baseline");
    expect(result.forecastCurve).toHaveLength(HOURS_PER_DAY);
    expect(result.mape).toBeGreaterThan(0);
    expect(result.mape).toBeLessThan(100);
    expect(result.rmse).toBeGreaterThan(0);
  });

  it("预测曲线的置信区间包含其均值", () => {
    const series = [partyA, partyB].map((recs) =>
      recs.map((r) => r.activePower as number),
    );
    const history = combineSeries(series, [0.5, 0.5]);
    const { forecastCurve } = baselineForecast(history, HOURS_PER_DAY, PERIOD);

    const ci = meanConfidenceInterval(forecastCurve);
    const mean = forecastCurve.reduce((s, v) => s + v, 0) / forecastCurve.length;

    expect(ci.lower).toBeLessThanOrEqual(mean);
    expect(ci.upper).toBeGreaterThanOrEqual(mean);
    expect(ci.upper).toBeGreaterThan(ci.lower);
  });

  it("计划模板生成的链路覆盖两方阶段与平台合并，且平台合并透传 spec", () => {
    const plan = buildLoadForecastPlan({
      purpose: "区域负荷预测",
      applicant: { org: "grid-co", project: "load-2026" },
      contracts: ["contract-001"],
      participants: [
        { participantId: "grid-a", dataProductId: "dp-a", role: "grid" },
        { participantId: "grid-b", dataProductId: "dp-b", role: "grid" },
      ],
      spec: { forecastHorizon: HOURS_PER_DAY, features: ["mean", "std"], model: "lstm" },
      notBefore: "2026-10-01T00:00:00Z",
      notAfter: "2026-12-31T00:00:00Z",
    });

    const merge = plan.stages.find((s) => s.op === "power.load-forecast-merge@1.0.0");
    expect(merge).toBeDefined();
    expect(merge!.params).toEqual({
      spec: { forecastHorizon: HOURS_PER_DAY, features: ["mean", "std"], model: "lstm" },
    });
    expect(plan.stages.filter((s) => s.op === "power.feature-extraction@1.0.0")).toHaveLength(2);
  });

  it("入参校验失败时在链路入口即抛 PlanInputError，不进入计算", () => {
    expect(() =>
      buildLoadForecastPlan({
        purpose: "x",
        applicant: { org: "o", project: "p" },
        contracts: ["c"],
        participants: [{ participantId: "a", dataProductId: "dp", role: "grid" }],
        spec: { forecastHorizon: 24, features: ["mean"], model: "lstm" },
        notBefore: "2026-10-01T00:00:00Z",
        notAfter: "2026-12-31T00:00:00Z",
      }),
    ).toThrow(PlanInputError);
  });
});
