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
// MDOP 标准场景的 SPI 挂载骨架（任务组 1）；实现由后续任务组补充。
export * from "./templates";
export * from "./sandboxes";
export * from "./collectors";
export * from "./connector-operators";
export * from "./analysis";
// 任务组 2：电力时序数据标准格式
export * from "./records/power-timeseries";
export * from "./records/data-quality";
export * from "./records/data-conversion";
export * from "./records/resampling";

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

/**
 * 把本包挂入基座：注册清单与 SPI 包，并启用。
 * 注意：这是包级挂载，不是模板注册；模板/收集器注册见 registerPowerTemplates / registerPowerCollectors。
 */
export function registerPowerTemplates(
  registrar: PackRegistrar,
  ctx: SpiContext,
  overrides: PowerPackOverrides = {},
): void {
  registrar.register(powerPackManifest, createPowerPackBundle(overrides));
  registrar.enable(ctx, powerPackManifest.id);
}
