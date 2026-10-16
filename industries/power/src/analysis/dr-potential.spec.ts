// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import {
  HOURS_PER_DAY,
  MIN_HISTORY_DAYS,
  assessDrPotential,
  buildBaselineCurve,
} from "./dr-potential";

function buildHistory(opts?: {
  days?: number;
  base?: number;
  amplitude?: number;
  flatMax?: boolean;
}): number[] {
  const days = opts?.days ?? MIN_HISTORY_DAYS;
  const base = opts?.base ?? 100;
  const amplitude = opts?.amplitude ?? 30;
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      if (opts?.flatMax) {
        out.push(base + amplitude);
      } else {
        out.push(base + amplitude * Math.sin((2 * Math.PI * h) / HOURS_PER_DAY));
      }
    }
  }
  return out;
}

describe("buildBaselineCurve", () => {
  it("拒绝不足 7 天的历史", () => {
    expect(() => buildBaselineCurve(buildHistory({ days: 6 }))).toThrow("历史负荷至少需要 7 天");
  });

  it("输出 24 点非负基准", () => {
    const curve = buildBaselineCurve(buildHistory());
    expect(curve).toHaveLength(24);
    expect(curve.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
});

describe("assessDrPotential", () => {
  it("评估峰时可削减与谷时可转移潜力", () => {
    const result = assessDrPotential({
      entityId: "user-1",
      historyKw: buildHistory(),
      userType: "industrial",
    });
    expect(result.entityId).toBe("user-1");
    expect(result.baselineCurve).toHaveLength(24);
    expect(result.peakReduction.length).toBe(24);
    expect(result.valleyShift.length).toBe(24);
    expect(result.peakReduction.some((t) => t[1] > 0)).toBe(true);
    expect(result.valleyShift.some((t) => t[1] > 0)).toBe(true);
  });

  it("遵守设备额定与舒适度约束", () => {
    const loose = assessDrPotential({
      entityId: "u",
      historyKw: buildHistory(),
      userType: "commercial",
    });
    const tight = assessDrPotential({
      entityId: "u",
      historyKw: buildHistory(),
      userType: "commercial",
      devices: [{ id: "hvac", ratedKw: 5, curtailable: true, shiftable: true }],
      comfort: { ratedCapacityKw: 5, lightingMin: 0.5, tempMin: 22, tempMax: 24 },
    });
    const loosePeak = loose.peakReduction.reduce((s, t) => s + t[1], 0);
    const tightPeak = tight.peakReduction.reduce((s, t) => s + t[1], 0);
    expect(tightPeak).toBeLessThan(loosePeak);
  });

  it("满负荷时 peakReduction 全为 0", () => {
    const result = assessDrPotential({
      entityId: "full",
      historyKw: buildHistory({ flatMax: true }),
      userType: "residential",
    });
    expect(result.peakReduction.every((t) => t[1] === 0)).toBe(true);
  });

  it("零潜力：照明满额时输出空潜力数组", () => {
    const result = assessDrPotential({
      entityId: "zero",
      historyKw: buildHistory(),
      userType: "residential",
      comfort: { lightingMin: 1, ratedCapacityKw: 0 },
    });
    expect(result.peakReduction).toEqual([]);
    expect(result.valleyShift).toEqual([]);
  });

  it("拒绝非法用户类型", () => {
    expect(() =>
      assessDrPotential({
        entityId: "x",
        historyKw: buildHistory(),
        userType: "farm" as "industrial",
      }),
    ).toThrow("用户类型");
  });
});
