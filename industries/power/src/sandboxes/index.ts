// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { SandboxRegistry, StageSandbox } from "@medtrust/space-kernel-spi";

import { anomalyDetectionStageSandbox } from "./anomaly-sandbox";
import { featureExtractionStageSandbox } from "./feature-extraction-sandbox";

export * from "./anomaly-sandbox";
export * from "./feature-extraction-sandbox";

export function powerSandboxes(): readonly StageSandbox[] {
  return [featureExtractionStageSandbox, anomalyDetectionStageSandbox];
}

export function registerPowerSandboxes(registry: SandboxRegistry): void {
  for (const sandbox of powerSandboxes()) registry.register(sandbox);
}
