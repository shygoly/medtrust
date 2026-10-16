// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力场景差分隐私（任务 8.1–8.3）。
 *
 * Laplace 机制：敏感度 Δ=1 时 scale = Δ/ε。确定性种子便于单测复现（演示口径；
 * 生产噪声应由合约绑定的 TEE / DP-SGD 路径承担）。
 */

export type PowerPrivacyScenario = "load-forecast" | "demand-response" | "theft-detection";

/** 各场景 ε 上限（spec） */
export const POWER_DP_EPSILON_CEILING: Readonly<Record<PowerPrivacyScenario, number>> = {
  "load-forecast": 1.0,
  "demand-response": 0.5,
  "theft-detection": 2.0,
};

export class PowerPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PowerPrivacyError";
  }
}

/** 确定性 Laplace 噪声（与 connector fl-dp-gate 同口径）。 */
export function laplaceNoise(scale: number, seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const u = (Math.abs(h) % 9_999) / 10_000 + 0.0005;
  return -scale * Math.sign(u - 0.5) * Math.log(1 - 2 * Math.abs(u - 0.5));
}

export function assertEpsilonWithinBudget(
  scenario: PowerPrivacyScenario,
  epsilon: number,
): void {
  if (!(typeof epsilon === "number" && Number.isFinite(epsilon) && epsilon > 0)) {
    throw new PowerPrivacyError("dpEpsilon 必须为正数");
  }
  const ceiling = POWER_DP_EPSILON_CEILING[scenario];
  if (epsilon > ceiling + 1e-9) {
    throw new PowerPrivacyError(
      `${scenario} 的 dpEpsilon=${epsilon} 超出预算上限 ${ceiling}`,
    );
  }
}

export interface DpNumericResult {
  readonly values: readonly number[];
  readonly dpApplied: true;
  readonly dpEpsilon: number;
  readonly scenario: PowerPrivacyScenario;
}

/**
 * 对数值向量注入 Laplace 噪声并校验场景预算。
 *
 * @param sensitivity - 全局敏感度 Δ（默认 1）
 */
export function applyLaplaceDp(
  values: readonly number[],
  scenario: PowerPrivacyScenario,
  epsilon: number,
  seed: string,
  sensitivity = 1,
): DpNumericResult {
  assertEpsilonWithinBudget(scenario, epsilon);
  if (!(sensitivity > 0)) throw new PowerPrivacyError("sensitivity 必须为正");
  const scale = sensitivity / epsilon;
  const noisy = values.map((v, i) => {
    if (!Number.isFinite(v)) throw new PowerPrivacyError("样本包含非有限数");
    return v + laplaceNoise(scale, `${seed}:${i}`);
  });
  return {
    values: noisy,
    dpApplied: true,
    dpEpsilon: epsilon,
    scenario,
  };
}

/**
 * 对 PowerFeatures 风格的数值特征字典加噪（保留非数值键）。
 */
export function applyDpToFeatureRecord(
  features: Readonly<Record<string, number>>,
  scenario: PowerPrivacyScenario,
  epsilon: number,
  seed: string,
): { features: Record<string, number>; dpApplied: true; dpEpsilon: number } {
  const keys = Object.keys(features);
  const values = keys.map((k) => features[k]!);
  const dp = applyLaplaceDp(values, scenario, epsilon, seed);
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    out[k] = dp.values[i]!;
  });
  return { features: out, dpApplied: true, dpEpsilon: dp.dpEpsilon };
}
