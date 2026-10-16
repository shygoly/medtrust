// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import {
  POWER_DP_EPSILON_CEILING,
  PowerPrivacyError,
  applyDpToFeatureRecord,
  applyLaplaceDp,
  assertEpsilonWithinBudget,
} from "./dp";
import {
  DEFAULT_K,
  DEFAULT_MIN_CELL,
  assertKAnonymity,
  assertMinCell,
  releaseIfMinCell,
} from "./k-anon";

describe("差分隐私（§8.1–8.3）", () => {
  it("负荷预测 ε 预算上限为 1.0", () => {
    expect(POWER_DP_EPSILON_CEILING["load-forecast"]).toBe(1.0);
    expect(() => assertEpsilonWithinBudget("load-forecast", 0.8)).not.toThrow();
    expect(() => assertEpsilonWithinBudget("load-forecast", 1.0)).not.toThrow();
    expect(() => assertEpsilonWithinBudget("load-forecast", 1.01)).toThrow(PowerPrivacyError);
  });

  it("需求响应 ε 预算上限为 0.5", () => {
    expect(POWER_DP_EPSILON_CEILING["demand-response"]).toBe(0.5);
    expect(() => assertEpsilonWithinBudget("demand-response", 0.5)).not.toThrow();
    expect(() => assertEpsilonWithinBudget("demand-response", 0.51)).toThrow(/超出预算上限 0.5/);
  });

  it("窃电检测 ε 预算上限为 2.0", () => {
    expect(POWER_DP_EPSILON_CEILING["theft-detection"]).toBe(2.0);
    expect(() => assertEpsilonWithinBudget("theft-detection", 1.9)).not.toThrow();
    expect(() => assertEpsilonWithinBudget("theft-detection", 2.01)).toThrow(/超出预算上限 2/);
  });

  it("负荷预测特征加噪后标记 dpApplied 且 ε < 1.0", () => {
    const raw = { mean: 100, std: 10, max: 140, min: 60 };
    const dp = applyDpToFeatureRecord(raw, "load-forecast", 0.7, "lf-test");
    expect(dp.dpApplied).toBe(true);
    expect(dp.dpEpsilon).toBe(0.7);
    expect(dp.dpEpsilon).toBeLessThan(1.0);
    // 噪声改变至少一个特征（确定性种子下可复现）
    expect(Object.values(dp.features).some((v, i) => v !== Object.values(raw)[i])).toBe(true);
  });

  it("需求响应潜力向量加噪 ε < 0.5", () => {
    const capacities = Array.from({ length: 24 }, (_, h) => 10 + h);
    const dp = applyLaplaceDp(capacities, "demand-response", 0.4, "dr-test");
    expect(dp.dpApplied).toBe(true);
    expect(dp.dpEpsilon).toBeLessThan(0.5);
    expect(dp.values).toHaveLength(24);
  });

  it("窃电异常评分加噪 ε < 2.0", () => {
    const scores = [0.1, 0.8, 0.9, 0.2];
    const dp = applyLaplaceDp(scores, "theft-detection", 1.5, "theft-test", 1);
    expect(dp.dpEpsilon).toBeLessThan(2.0);
    expect(dp.values).toHaveLength(4);
  });

  it("同种子可复现", () => {
    const a = applyLaplaceDp([1, 2, 3], "load-forecast", 0.5, "same");
    const b = applyLaplaceDp([1, 2, 3], "load-forecast", 0.5, "same");
    expect(a.values).toEqual(b.values);
  });
});

describe("k-匿名（§8.4）", () => {
  it("groupSize ≥ 5 通过", () => {
    expect(() => assertKAnonymity(5, DEFAULT_K)).not.toThrow();
    expect(() => assertKAnonymity(10, 5)).not.toThrow();
  });

  it("groupSize < 5 拒绝", () => {
    expect(() => assertKAnonymity(4, 5)).toThrow(/k-匿名不满足/);
    expect(() => assertKAnonymity(0, 5)).toThrow(PowerPrivacyError);
  });

  it("三场景输出均以 k≥5 为门槛", () => {
    for (const size of [5, 8, 100]) {
      expect(() => assertKAnonymity(size)).not.toThrow();
    }
    expect(() => assertKAnonymity(3)).toThrow();
  });
});

describe("小单元检查 minCell（§8.5）", () => {
  it("nSamples ≥ minCell 通过", () => {
    expect(() => assertMinCell(5, DEFAULT_MIN_CELL)).not.toThrow();
    expect(() => assertMinCell(100, 5)).not.toThrow();
  });

  it("nSamples < minCell 拒绝出域", () => {
    expect(() => assertMinCell(4, 5)).toThrow(/小单元拒绝/);
    expect(() => assertMinCell(0, 5)).toThrow(/拒绝出域/);
  });

  it("releaseIfMinCell 在不足时 fail-closed", () => {
    expect(() => releaseIfMinCell([1, 2, 3], 5)).toThrow(PowerPrivacyError);
    expect(releaseIfMinCell([1, 2, 3, 4, 5], 5)).toHaveLength(5);
  });
});
