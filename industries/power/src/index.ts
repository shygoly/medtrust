// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PackRegistrar, SpiBundle, SpiContext } from "@medtrust/space-kernel-spi";

import { powerPackManifest } from "./manifest";
import {
  powerAssurance,
  powerDataSource,
  powerEgress,
  powerMetering,
  powerOperators,
  powerTerminology,
} from "./seams";
import type {
  AssuranceProfile,
  DataSourceAdapter,
  EgressPolicyProvider,
  MeteringProvider,
  OperatorPack,
  TerminologyDeidentifier,
} from "@medtrust/space-kernel-spi";

export * from "./manifest";
export * from "./seams";
export * from "./scenarios";
export * from "./exchange";

export interface PowerPackOverrides {
  readonly dataSource?: DataSourceAdapter;
  readonly operators?: OperatorPack;
  readonly egress?: EgressPolicyProvider;
  readonly metering?: MeteringProvider;
  readonly assurance?: AssuranceProfile;
  readonly terminology?: TerminologyDeidentifier;
}

export function createPowerPackBundle(overrides: PowerPackOverrides = {}): SpiBundle {
  return {
    packId: powerPackManifest.id,
    dataSource: overrides.dataSource ?? powerDataSource,
    operators: overrides.operators ?? powerOperators,
    egress: overrides.egress ?? powerEgress,
    metering: overrides.metering ?? powerMetering,
    assurance: overrides.assurance ?? powerAssurance,
    terminology: overrides.terminology ?? powerTerminology,
  };
}

export function mountPowerPack(
  registrar: PackRegistrar,
  ctx: SpiContext,
  overrides: PowerPackOverrides = {},
): void {
  registrar.register(powerPackManifest, createPowerPackBundle(overrides));
  registrar.enable(ctx, powerPackManifest.id);
}
