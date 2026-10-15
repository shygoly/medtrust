// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 算子包的节点侧一半：阶段沙箱。四条已全部接入（ve-tnd / pairing / scri / dedup-incidence）。
 */
import type { SandboxRegistry, StageSandbox } from "@medtrust/space-kernel-spi";

import { algorithmValidationStageSandbox } from "./algorithm-validation";
import { causalPsmStageSandbox } from "./causal-psm";
import { causalSurvivalStageSandbox } from "./causal-survival";
import { comparativeEffectStageSandbox } from "./comparative-effect";
import { dedupIncidenceStageSandbox } from "./dedup-incidence";
import { pairedCohortStageSandbox } from "./pairing";
import { vaccineScriStageSandbox } from "./scri";
import { veTndStageSandbox } from "./ve-tnd";

export * from "./algorithm-validation";
export * from "./causal-psm";
export * from "./causal-survival";
export * from "./comparative-effect";
export * from "./dedup-incidence";
export * from "./dedup-incidence-sandbox";
export * from "./pairing";
export * from "./pairing-sandbox";
export * from "./scri";
export * from "./scri-sandbox";
export * from "./ve-tnd";
export * from "./ve-tnd-sandbox";

/** 本包声明的节点侧阶段沙箱（S2 `OperatorPack.declareSandboxes` 的返回值）。 */
export function medSandboxes(): readonly StageSandbox[] {
  return [
    pairedCohortStageSandbox,
    vaccineScriStageSandbox,
    veTndStageSandbox,
    dedupIncidenceStageSandbox,
    comparativeEffectStageSandbox,
    causalPsmStageSandbox,
    causalSurvivalStageSandbox,
    algorithmValidationStageSandbox,
  ];
}

/** 注册进基座给的注册面（组装根调用）。 */
export function registerMedSandboxes(registry: SandboxRegistry): void {
  for (const sandbox of medSandboxes()) registry.register(sandbox);
}
