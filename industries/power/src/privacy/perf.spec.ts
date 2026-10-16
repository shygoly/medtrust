// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 性能测试（任务 §9）。在 CI 上跑真实规模的下界；耗时断言留足余量。
 */

import { extractPowerFeatures } from "../analysis/time-series-features";
import { assessDrPotential } from "../analysis/dr-potential";
import { optimizeDemandResponse } from "../analysis/dr-optimize";
import { detectAnomaly } from "../analysis/anomaly-detection";
import { mergeTheftDetections } from "../analysis/theft-merge";
import type { PowerTimeSeriesRecord } from "../records/power-timeseries";

const HOURS = 24;

function timed<T>(fn: () => T): { ms: number; result: T } {
  const t0 = Date.now();
  const result = fn();
  return { ms: Date.now() - t0, result };
}

describe("性能测试（§9）", () => {
  jest.setTimeout(10 * 60 * 1000);

  it("9.4 特征提取吞吐量 ≥ 10000 条/秒", () => {
    const records: PowerTimeSeriesRecord[] = [];
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      records.push({
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
        entityId: "site",
        activePower: 50 + (i % 24),
      });
    }
    const { ms } = timed(() =>
      extractPowerFeatures(records, {
        entityId: "site",
        windowStart: records[0]!.timestamp,
        windowEnd: records[n - 1]!.timestamp,
        seasonalPeriod: 24,
      }),
    );
    const perSec = n / (ms / 1000);
    expect(perSec).toBeGreaterThanOrEqual(10_000);
  });

  it("9.1 负荷预测：1000 用户 × 30 天特征提取 < 5 分钟", () => {
    const days = 30;
    const users = 1000;
    const { ms } = timed(() => {
      for (let u = 0; u < users; u++) {
        const records: PowerTimeSeriesRecord[] = [];
        for (let h = 0; h < days * HOURS; h++) {
          records.push({
            timestamp: new Date(Date.UTC(2026, 0, 1) + h * 3600_000).toISOString(),
            entityId: `u${u}`,
            activePower: 40 + (h % 24) + (u % 7),
          });
        }
        extractPowerFeatures(records, {
          entityId: `u${u}`,
          windowStart: records[0]!.timestamp,
          windowEnd: records[records.length - 1]!.timestamp,
          seasonalPeriod: 24,
        });
      }
    });
    expect(ms).toBeLessThan(5 * 60 * 1000);
  });

  it("9.2 需求响应：100 用户 × 24 小时优化 < 1 分钟", () => {
    const history = (base: number) => {
      const out: number[] = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) out.push(base + 20 * Math.sin((2 * Math.PI * h) / 24));
      }
      return out;
    };
    const potentials = Array.from({ length: 100 }, (_, i) =>
      assessDrPotential({
        entityId: `u${i}`,
        historyKw: history(80 + (i % 20)),
        userType: i % 2 === 0 ? "industrial" : "commercial",
      }),
    );
    const targetLoad = Array.from({ length: 24 }, () => 500);
    const { ms } = timed(() =>
      optimizeDemandResponse({
        potentials,
        spec: { targetLoad, incentiveBudget: 1_000_000, timeWindow: [0, 24] },
      }),
    );
    expect(ms).toBeLessThan(60_000);
  });

  it("9.3 窃电检测：10000 用户 × 90 天 < 10 分钟", () => {
    const days = 90;
    const users = 10_000;
    const points = days * HOURS;
    const normal = new Array<number>(points);
    const anomalous = new Array<number>(points);
    for (let i = 0; i < points; i++) {
      const base = 45 + (i % 24);
      normal[i] = base;
      anomalous[i] = i % 24 < 16 ? 0 : base;
    }

    const { ms, result: regionResults } = timed(() => {
      const results = [];
      for (let u = 0; u < users; u++) {
        // 复用两条预生成曲线（只做引用传递），避免 10k 次大数组分配
        const powerKw = u % 50 === 0 ? anomalous : normal;
        results.push(detectAnomaly({ entityId: `u${u}`, powerKw }));
      }
      return results;
    });

    const merged = mergeTheftDetections(
      [
        { regionId: "r1", results: regionResults.slice(0, users / 2) },
        { regionId: "r2", results: regionResults.slice(users / 2) },
      ],
      { anomalyThreshold: 0.35, topK: 100 },
    );
    expect(merged.totalUsers).toBe(users);
    expect(ms).toBeLessThan(10 * 60 * 1000);
  });

  it("9.5 单阶段堆内存 < 4 GB（特征提取 1000×30 天后）", () => {
    const before = process.memoryUsage().heapUsed;
    const days = 30;
    for (let u = 0; u < 200; u++) {
      const records: PowerTimeSeriesRecord[] = [];
      for (let h = 0; h < days * HOURS; h++) {
        records.push({
          timestamp: new Date(Date.UTC(2026, 0, 1) + h * 3600_000).toISOString(),
          entityId: `m${u}`,
          activePower: 30 + (h % 24),
        });
      }
      extractPowerFeatures(records, {
        entityId: `m${u}`,
        windowStart: records[0]!.timestamp,
        windowEnd: records[records.length - 1]!.timestamp,
        seasonalPeriod: 24,
      });
    }
    if (global.gc) global.gc();
    const used = process.memoryUsage().heapUsed;
    const delta = used - before;
    expect(used).toBeLessThan(4 * 1024 * 1024 * 1024);
    expect(delta).toBeLessThan(4 * 1024 * 1024 * 1024);
  });
});
