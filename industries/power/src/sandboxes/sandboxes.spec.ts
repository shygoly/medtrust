// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { runAnomalyDetectionFromRows } from "./anomaly-sandbox";
import { runFeatureExtractionFromRows } from "./feature-extraction-sandbox";
import { powerSandboxes, registerPowerSandboxes } from "./index";
import { POWER_NODE_OPERATOR_REFS } from "../connector-operators";

describe("电力沙箱", () => {
  it("feature-extraction 从行集提取特征", () => {
    const rows = Array.from({ length: 48 }, (_, i) => ({
      entityId: "s1",
      timestamp: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
      activePower: 40 + (i % 24),
    }));
    const out = runFeatureExtractionFromRows(rows, {
      windowStart: rows[0]!.timestamp,
      windowEnd: rows[47]!.timestamp,
      seasonalPeriod: 24,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.nSamples).toBe(48);
  });

  it("anomaly-detection 从行集检出异常", () => {
    const rows = Array.from({ length: 30 * 24 }, (_, i) => ({
      entityId: "bad",
      activePower: i % 24 < 16 ? 0 : 40,
    }));
    const out = runAnomalyDetectionFromRows(rows);
    expect(out[0]!.anomalyScore).toBeGreaterThan(0.3);
  });

  it("registerPowerSandboxes 注册两个沙箱", () => {
    const registered: string[] = [];
    registerPowerSandboxes({
      register: (s) => {
        registered.push(s.opRef);
      },
      resolve: () => undefined,
    });
    expect(powerSandboxes()).toHaveLength(2);
    expect(registered).toEqual(
      expect.arrayContaining([
        "power.feature-extraction@1.0.0",
        "power.anomaly-detection@1.0.0",
      ]),
    );
  });

  it("节点算子 ref 清单完整", () => {
    expect(POWER_NODE_OPERATOR_REFS).toHaveLength(3);
  });
});
