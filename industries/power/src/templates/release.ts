// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 三个电力模板共用的数据源句柄与出域参数。
 *
 * 数据源句柄进阶段「输入」（`ds://<node>/<product>`）：编译器据此把阶段钉在数据所在节点
 * （数据就近），连接器的 source 链环据此取产品。降密阶段的 minCell 缺省取合约发布条件
 * （编译期补齐，且不得弱于合约）；contractId 是假名 scope 与审计的锚点。
 */

import { PlanInputError } from "@medtrust/mdop";

export interface PowerReleaseOptions {
  /** 表计数下限（不得弱于合约发布条件；缺省取合约值）。 */
  readonly minCell?: number;
  /** k-匿名（对表计数），缺省 5。 */
  readonly k?: number;
  /** Laplace DP 的 ε（不超过场景预算上限）；缺省不加噪。 */
  readonly dpEpsilon?: number;
}

export function datasetUri(participantId: string, dataProductId: string): string {
  return `ds://${participantId}/${dataProductId}`;
}

export function validateReleaseOptions(release: unknown): void {
  if (release === undefined) return;
  if (typeof release !== "object" || release === null) throw new PlanInputError("release 必须是对象");
  const r = release as Record<string, unknown>;
  if (r.minCell !== undefined && !(Number.isInteger(r.minCell) && (r.minCell as number) > 0)) {
    throw new PlanInputError("release.minCell 必须为正整数");
  }
  if (r.k !== undefined && !(Number.isInteger(r.k) && (r.k as number) >= 2)) {
    throw new PlanInputError("release.k 必须为 ≥ 2 的整数");
  }
  if (r.dpEpsilon !== undefined && !(typeof r.dpEpsilon === "number" && r.dpEpsilon > 0)) {
    throw new PlanInputError("release.dpEpsilon 必须为正数");
  }
}

export function releaseParams(
  contractId: string,
  release: PowerReleaseOptions | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractId,
    ...(release?.minCell !== undefined ? { minCell: release.minCell } : {}),
    ...(release?.k !== undefined ? { k: release.k } : {}),
    ...(release?.dpEpsilon !== undefined ? { dpEpsilon: release.dpEpsilon } : {}),
    ...extra,
  };
}
