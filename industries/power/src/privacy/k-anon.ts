// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * k-匿名与小单元出域闸（任务 8.4 / 8.5）。
 */

import { PowerPrivacyError } from "./dp";

export const DEFAULT_K = 5;
export const DEFAULT_MIN_CELL = 5;

/**
 * 断言聚合组大小满足 k-匿名（k ≥ 5）。
 * @throws PowerPrivacyError 当 groupSize < k
 */
export function assertKAnonymity(groupSize: number, k: number = DEFAULT_K): void {
  if (!(Number.isInteger(k) && k >= DEFAULT_K)) {
    throw new PowerPrivacyError(`k 匿名参数须为 ≥ ${DEFAULT_K} 的整数`);
  }
  if (!(Number.isFinite(groupSize) && groupSize >= k)) {
    throw new PowerPrivacyError(
      `k-匿名不满足：groupSize=${groupSize} < k=${k}（fail-closed）`,
    );
  }
}

/**
 * 小单元检查：nSamples ≥ minCell，否则拒绝出域。
 * @throws PowerPrivacyError
 */
export function assertMinCell(
  nSamples: number,
  minCell: number = DEFAULT_MIN_CELL,
): void {
  if (!(Number.isFinite(minCell) && minCell > 0)) {
    throw new PowerPrivacyError("minCell 必须为正数");
  }
  if (!(Number.isFinite(nSamples) && nSamples >= minCell)) {
    throw new PowerPrivacyError(
      `小单元拒绝：nSamples=${nSamples} < minCell=${minCell}：拒绝出域（fail-closed）`,
    );
  }
}

/**
 * 过滤 Top-K 列表：若候选数 < minCell 则整表拒绝（不泄露「只有少数人异常」的精确计数）。
 */
export function releaseIfMinCell<T>(
  items: readonly T[],
  minCell: number = DEFAULT_MIN_CELL,
): readonly T[] {
  assertMinCell(items.length, minCell);
  return items;
}
