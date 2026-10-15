// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 算子包的**平台侧**一半：聚合收集器（合并口径）。
 *
 * 为什么放这里：基座 MUST NOT 认识具体分析类型（见 change `pack-med-collectors`，TD-12）；
 * 收集器实现与它们的调用方原来都在基座目录里，直接搬会变成依赖方向违规，故经 SPI 注册面反转。
 * 这两个实现**逐字节**来自 `apps/api/src/mdop/operators/collect-*.ts`（搬运不改口径）。
 */
import type {
  AggregationCollector,
  AggregationCollectorRegistry,
} from "@medtrust/space-kernel-spi";

import { collectPairedCohort } from "./paired-cohort";
import { mergeAeSignal } from "./ae-signal";
import { mergeCohortCount } from "./cohort-count";
import { collectDedupIncidence } from "./dedup-incidence";
import { collectVeTnd } from "./ve-tnd";
import { collectVaccineScri } from "./vaccine-scri";

export * from "./paired-cohort";
export * from "./vaccine-scri";
export * from "./ve-tnd";
export * from "./ae-signal";
export * from "./cohort-count";
export * from "./dedup-incidence";

/** 本包声明的平台侧聚合收集器（S2 `OperatorPack.declareCollectors` 的返回值）。 */
export function medAggregationCollectors(): readonly AggregationCollector[] {
  return [
    {
      analysisType: "paired-cohort",
      merge: (input) =>
        collectPairedCohort(
          input as Parameters<typeof collectPairedCohort>[0],
        ) as unknown,
    },
    {
      analysisType: "categorical-count",
      merge: (input) =>
        mergeAeSignal(input as Parameters<typeof mergeAeSignal>[0]) as unknown,
    },
    {
      analysisType: "distinct-count",
      merge: (input) =>
        mergeCohortCount(input as Parameters<typeof mergeCohortCount>[0]) as unknown,
    },
    {
      analysisType: "dedup-incidence",
      merge: (input) =>
        collectDedupIncidence(
          input as Parameters<typeof collectDedupIncidence>[0],
        ) as unknown,
    },
    {
      analysisType: "vaccine-tnd",
      merge: (input) =>
        collectVeTnd(input as Parameters<typeof collectVeTnd>[0]) as unknown,
    },
    {
      analysisType: "vaccine-scri",
      merge: (input) =>
        collectVaccineScri(
          input as Parameters<typeof collectVaccineScri>[0],
        ) as unknown,
    },
  ];
}

/**
 * 把本包的收集器注册进基座给的注册面（组装根调用：`apps/api/src/app.module.ts`）。
 * 声明期不需要空间上下文（收集器是纯函数），真正的空间上下文由基座在 `merge(input, ctx)` 时传入。
 */
export function registerMedCollectors(
  registry: AggregationCollectorRegistry,
): void {
  for (const collector of medAggregationCollectors()) registry.register(collector);
}
