// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 算子包的**节点侧**一半：阶段沙箱（一种算子一次整段执行）。
 *
 * 目前接了 `ve-tnd` 一条（change `pack-med-sandboxes` 的竖切）；其余三条
 * （`pairing` / `scri` / `dedup-incidence`）按同一形态接入，仍在基座侧暂留。
 */
import type { SandboxRegistry, StageSandbox } from "@medtrust/space-kernel-spi";

import { veTndStageSandbox } from "./ve-tnd";

export * from "./ve-tnd-sandbox";
export * from "./ve-tnd";

/** 本包声明的节点侧阶段沙箱（S2 `OperatorPack.declareSandboxes` 的返回值）。 */
export function medSandboxes(): readonly StageSandbox[] {
  return [veTndStageSandbox];
}

/** 注册进基座给的注册面（组装根调用）。 */
export function registerMedSandboxes(registry: SandboxRegistry): void {
  for (const sandbox of medSandboxes()) registry.register(sandbox);
}
