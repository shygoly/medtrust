// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.load-forecast 的平台侧聚合收集器（任务 3.4）。
 *
 * 吃各参与方脱密后的 PowerFeatures，经 weightedMergeFeatures 按样本量加权，
 * 再产出置信区间与特征重要性。只做纯计算，不做 I/O。
 * 预测模型（LSTM / Transformer，任务 3.3.2 / 3.3.3）不在本文件内。
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

export const LOAD_FORECAST_ANALYSIS_TYPE = "power.load-forecast";

export interface LoadForecastCollectorInput {
  /** 各参与方脱密后的特征（非空） */
  readonly parties: readonly PowerFeatures[];
}

export interface LoadForecastCollectorOutput {
  readonly merged: MergedFeatures;
  /** 以各方 mean 为样本的均值置信区间 */
  readonly confidenceInterval: ConfidenceInterval;
  /** 聚合特征的重要性排序（代理指标） */
  readonly featureImportance: readonly FeatureImportanceEntry[];
}

/**
 * 合并多方负荷特征并计算统计输出。
 *
 * @param input - 各方特征
 * @returns 聚合结果、置信区间与特征重要性
 * @throws Error 当参与方为空或总样本数不为正时
 */
export function collectLoadForecast(
  input: LoadForecastCollectorInput,
): LoadForecastCollectorOutput {
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

/**
 * 注册进基座的平台侧收集器声明（SPI AggregationCollector）。
 * 组装根通过 declareCollectors / registry.register 挂载，不在本文件内直接注册。
 */
export const loadForecastAggregationCollector: AggregationCollector<
  LoadForecastCollectorInput,
  LoadForecastCollectorOutput
> = {
  analysisType: LOAD_FORECAST_ANALYSIS_TYPE,
  merge: (input) => collectLoadForecast(input),
};
