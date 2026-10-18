// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.load-forecast 的平台侧聚合收集器（任务 3.4 / 批次 7）。
 *
 * 合并服务传入 `{ tables: [{ node, aggregate }] }`；aggregate 为各方脱密后的 PowerFeatures。
 */

import type { AggregationCollector } from "@medtrust/space-kernel-spi";

import type { PowerFeatures } from "../records/power-timeseries";
import { weightedMergeFeatures, type MergedFeatures } from "../analysis/load-forecast-merge";
import {
  meanConfidenceInterval,
  rankFeatureImportance,
  type ConfidenceInterval,
  type FeatureImportanceEntry,
} from "../analysis/load-forecast-stats";
import { baselineForecast } from "../analysis/load-forecast-model";

export const LOAD_FORECAST_ANALYSIS_TYPE = "power.load-forecast";

export interface LoadForecastDelivery extends PowerFeatures {
  readonly analysisType?: string;
  /** 节点总负荷的日内剖面（kW，按本地小时 0–23；节点降密环聚合，可能已加噪）。 */
  readonly loadProfileKw?: readonly number[];
  readonly nMeters?: number;
}

export interface LoadForecastCollectorOutput {
  readonly analysisType: typeof LOAD_FORECAST_ANALYSIS_TYPE;
  readonly merged: MergedFeatures;
  readonly confidenceInterval: ConfidenceInterval;
  readonly featureImportance: readonly FeatureImportanceEntry[];
  /** 区域总负荷剖面（各节点剖面逐小时相加，kW）。 */
  readonly loadProfileKw: readonly number[];
  /** 季节朴素基线预测（以区域日内剖面为一个周期外推，长度 = forecastHorizon）。 */
  readonly forecastCurve: readonly number[];
  readonly forecastHorizon: number;
  readonly model: string;
  readonly totalSamples: number;
  readonly totalMeters: number;
  readonly nParties: number;
}

const PROFILE_HOURS = 24;

function asFeatures(aggregate: LoadForecastDelivery, node: string): PowerFeatures {
  if (
    typeof aggregate.mean !== "number" ||
    typeof aggregate.nSamples !== "number" ||
    typeof aggregate.entityId !== "string"
  ) {
    throw new Error(`节点 ${node} 的负荷特征载荷形状非法`);
  }
  return aggregate;
}

/** 纯函数入口（单测 / 非 SPI 调用仍可用 parties 形态）。 */
export function collectLoadForecast(input: {
  parties: readonly PowerFeatures[];
}): Pick<LoadForecastCollectorOutput, "merged" | "confidenceInterval" | "featureImportance"> {
  const merged = weightedMergeFeatures(input.parties);
  const confidenceInterval = meanConfidenceInterval(input.parties.map((p) => p.mean));
  const featureImportance = rankFeatureImportance({
    mean: merged.mean,
    std: merged.std,
    max: merged.max,
    min: merged.min,
    trend: merged.trend,
    seasonality: merged.seasonality,
  });
  return { merged, confidenceInterval, featureImportance };
}

function profileOf(aggregate: LoadForecastDelivery, node: string): readonly number[] {
  const p = aggregate.loadProfileKw;
  if (!Array.isArray(p) || p.length !== PROFILE_HOURS || !p.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error(`节点 ${node} 的负荷载荷缺 24 小时剖面 loadProfileKw`);
  }
  return p;
}

/**
 * 平台合并服务口径：`{ tables, params }`（params = 计划里合并阶段的参数，含 `spec`）。
 * 预测对象是**区域总负荷**：各节点日内剖面逐小时相加，再以 24 小时为周期外推。
 */
export function mergeLoadForecastDeliveries(input: {
  tables: Array<{ node: string; aggregate: LoadForecastDelivery }>;
  params?: { spec?: { forecastHorizon?: number; model?: string } };
}): LoadForecastCollectorOutput {
  if (input.tables.length === 0) throw new Error("负荷预测合并没有任何节点载荷");
  const parties = input.tables.map((t) => asFeatures(t.aggregate, t.node));
  const base = collectLoadForecast({ parties });
  const profiles = input.tables.map((t) => profileOf(t.aggregate, t.node));
  const loadProfileKw = Array.from({ length: PROFILE_HOURS }, (_, h) =>
    profiles.reduce((s, p) => s + p[h]!, 0),
  );
  const horizon = input.params?.spec?.forecastHorizon ?? PROFILE_HOURS;
  const forecast = baselineForecast(loadProfileKw, horizon, PROFILE_HOURS);
  return {
    analysisType: LOAD_FORECAST_ANALYSIS_TYPE,
    ...base,
    loadProfileKw,
    forecastCurve: forecast.forecastCurve,
    forecastHorizon: horizon,
    model: forecast.model,
    totalSamples: base.merged.nSamples,
    totalMeters: input.tables.reduce((s, t) => s + (t.aggregate.nMeters ?? 0), 0),
    nParties: parties.length,
  };
}

export const loadForecastAggregationCollector: AggregationCollector = {
  analysisType: LOAD_FORECAST_ANALYSIS_TYPE,
  merge: (input) =>
    mergeLoadForecastDeliveries(input as Parameters<typeof mergeLoadForecastDeliveries>[0]),
};
