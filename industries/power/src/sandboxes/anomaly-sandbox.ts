// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.anomaly-detection@1.0.0 节点侧沙箱（任务 5.2）。
 *
 * 当前为纯 TS 执行路径（与 feature-extraction 同口径）：读宿主表行 → 调领域逻辑。
 * wasm 运行时就绪后可替换为同契约的 wasm 实现。
 */

import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";

import {
  detectAnomaly,
  type AnomalyDetectionInput,
  type AnomalyDetectionResult,
} from "../analysis/anomaly-detection";

export function runAnomalyDetectionFromRows(
  rows: readonly Record<string, unknown>[],
  params: Record<string, unknown> = {},
): AnomalyDetectionResult[] {
  const byEntity = new Map<string, number[]>();
  for (const row of rows) {
    const entityId = String(row.entityId ?? "");
    const power = Number(row.activePower ?? row.powerKw);
    if (!entityId || !Number.isFinite(power)) continue;
    let series = byEntity.get(entityId);
    if (!series) {
      series = [];
      byEntity.set(entityId, series);
    }
    series.push(power);
  }

  const peerMean =
    typeof params.peerMeanKw === "number" && Number.isFinite(params.peerMeanKw)
      ? params.peerMeanKw
      : undefined;
  const threshold =
    typeof params.anomalyThreshold === "number" ? params.anomalyThreshold : undefined;

  const results: AnomalyDetectionResult[] = [];
  for (const [entityId, powerKw] of byEntity) {
    const input: AnomalyDetectionInput = {
      entityId,
      powerKw,
      ...(peerMean !== undefined ? { peerMeanKw: peerMean } : {}),
      ...(threshold !== undefined ? { anomalyThreshold: threshold } : {}),
    };
    results.push(detectAnomaly(input));
  }
  return results;
}

export const anomalyDetectionStageSandbox: StageSandbox = {
  opRef: "power.anomaly-detection@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown> };
    };
    const tables = host.tables(host.stageInput);
    const rows = tables.flatMap((t) => t.rows as Record<string, unknown>[]);
    return runAnomalyDetectionFromRows(rows, stageInput.stage.params ?? {});
  },
};
