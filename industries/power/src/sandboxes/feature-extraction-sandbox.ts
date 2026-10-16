// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.feature-extraction@1.0.0 节点侧沙箱（纯 TS；wasm 方案确定前的承接实现）。
 */

import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";

import { extractPowerFeatures } from "../analysis/time-series-features";
import type { PowerTimeSeriesRecord } from "../records/power-timeseries";

export function runFeatureExtractionFromRows(
  rows: readonly Record<string, unknown>[],
  params: Record<string, unknown> = {},
): ReturnType<typeof extractPowerFeatures>[] {
  const byEntity = new Map<string, PowerTimeSeriesRecord[]>();
  for (const row of rows) {
    const entityId = String(row.entityId ?? "");
    const timestamp = String(row.timestamp ?? "");
    if (!entityId || !timestamp) continue;
    const activePower = Number(row.activePower);
    const record: PowerTimeSeriesRecord = {
      timestamp,
      entityId,
      ...(Number.isFinite(activePower) ? { activePower } : {}),
    };
    let series = byEntity.get(entityId);
    if (!series) {
      series = [];
      byEntity.set(entityId, series);
    }
    series.push(record);
  }

  const windowStart = typeof params.windowStart === "string" ? params.windowStart : "1970-01-01T00:00:00Z";
  const windowEnd = typeof params.windowEnd === "string" ? params.windowEnd : new Date().toISOString();
  const seasonalPeriod =
    typeof params.seasonalPeriod === "number" && params.seasonalPeriod >= 2
      ? params.seasonalPeriod
      : 24;

  const out: ReturnType<typeof extractPowerFeatures>[] = [];
  for (const [entityId, records] of byEntity) {
    if (records.length < 3) continue;
    out.push(
      extractPowerFeatures(records, {
        entityId,
        windowStart,
        windowEnd,
        seasonalPeriod,
      }),
    );
  }
  return out;
}

export const featureExtractionStageSandbox: StageSandbox = {
  opRef: "power.feature-extraction@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown> };
    };
    const tables = host.tables(host.stageInput);
    const rows = tables.flatMap((t) => t.rows as Record<string, unknown>[]);
    return runFeatureExtractionFromRows(rows, stageInput.stage.params ?? {});
  },
};
