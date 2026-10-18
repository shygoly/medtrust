// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type {
  AggregationCollector,
  AggregationCollectorRegistry,
} from "@medtrust/space-kernel-spi";

import { demandResponseAggregationCollector } from "./demand-response-collector";
import { loadForecastAggregationCollector } from "./load-forecast-collector";
import { theftDetectionAggregationCollector } from "./theft-detection-collector";

export * from "./load-forecast-collector";
export * from "./theft-detection-collector";
export * from "./demand-response-collector";

/** 本包声明的平台侧聚合收集器（S2 的平台侧一半）。 */
export function powerAggregationCollectors(): readonly AggregationCollector[] {
  return [
    loadForecastAggregationCollector as AggregationCollector,
    demandResponseAggregationCollector as AggregationCollector,
    theftDetectionAggregationCollector as AggregationCollector,
  ];
}

/** 把本包的收集器注册进基座给的注册面（组装根调用）。 */
export function registerPowerCollectors(registry: AggregationCollectorRegistry): void {
  for (const collector of powerAggregationCollectors()) registry.register(collector);
}
