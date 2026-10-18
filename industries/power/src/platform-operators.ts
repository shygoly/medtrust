// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力包的平台侧合并算子清单（system / merge）。
 *
 * 基座不认识行业算子：这三份清单由组装根交给基座的平台算子注册面，基座只校验
 * 「system + merge」（D-MDOP-5）后登记；实际合并逻辑是 collectors/ 下按 analysisType 注册的收集器。
 */

export interface PlatformOperatorRegistry {
  register(manifest: unknown): void;
}

function mergeManifest(id: string, input: string, output: string): Record<string, unknown> {
  const component = id.replace(/\./g, "-");
  return {
    apiVersion: "mdop/v0.2",
    kind: "system",
    id,
    version: "1.0.0",
    category: "merge",
    digest: `component:${component}@1`,
    publisher: "urn:tds:platform",
    inputs: [{ name: input, schema: "mdop.table/1.0", accept_labels: ["C3"] }],
    outputs: [{ name: output, schema: "mdop.table/1.0", label_rule: "inherit" }],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    component: `${component}@1.0.0`,
  };
}

export const POWER_PLATFORM_OPERATORS: readonly Record<string, unknown>[] = [
  mergeManifest("power.load-forecast-merge", "features", "forecast"),
  mergeManifest("power.dr-optimize", "potentials", "plan"),
  mergeManifest("power.theft-merge", "anomalies", "report"),
];

export function registerPowerPlatformOperators(registry: PlatformOperatorRegistry): void {
  for (const manifest of POWER_PLATFORM_OPERATORS) registry.register(manifest);
}
