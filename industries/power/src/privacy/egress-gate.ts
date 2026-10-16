// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力场景出域闸：串联 minCell + k-匿名 + 可选 DP（供收集器 / 合并后调用）。
 */

import {
  applyLaplaceDp,
  type PowerPrivacyScenario,
  type DpNumericResult,
} from "./dp";
import { assertKAnonymity, assertMinCell, DEFAULT_K, DEFAULT_MIN_CELL } from "./k-anon";

export interface PowerEgressPolicy {
  readonly scenario: PowerPrivacyScenario;
  readonly minCell?: number;
  readonly k?: number;
  /** 未设置则不加噪，仅做 minCell / k 检查 */
  readonly dpEpsilon?: number;
  readonly seed?: string;
}

export interface PowerEgressInput {
  /** 出域样本量（特征 nSamples / 用户组大小 / Top-K 长度等） */
  readonly nSamples: number;
  /** 可选：待加噪的数值向量 */
  readonly numericPayload?: readonly number[];
}

export interface PowerEgressResult {
  readonly released: true;
  readonly nSamples: number;
  readonly dp?: DpNumericResult;
}

/**
 * fail-closed 出域闸：先 minCell，再 k-匿名，再可选 DP。
 */
export function enforcePowerEgress(
  input: PowerEgressInput,
  policy: PowerEgressPolicy,
): PowerEgressResult {
  const minCell = policy.minCell ?? DEFAULT_MIN_CELL;
  const k = policy.k ?? DEFAULT_K;
  assertMinCell(input.nSamples, minCell);
  assertKAnonymity(input.nSamples, k);

  if (policy.dpEpsilon === undefined || !input.numericPayload) {
    return { released: true, nSamples: input.nSamples };
  }

  const dp = applyLaplaceDp(
    input.numericPayload,
    policy.scenario,
    policy.dpEpsilon,
    policy.seed ?? `${policy.scenario}:egress`,
  );
  return { released: true, nSamples: input.nSamples, dp };
}
