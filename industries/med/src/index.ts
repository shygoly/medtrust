// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PackRegistrar, SpiBundle, SpiContext } from "@medtrust/space-kernel-spi";

import { medPackManifest } from "./manifest";
export * from "./collectors";
export * from "./sandboxes";
export * from "./templates";
export * from "./records";
export * from "./connector-operators";
import {
  medAssurance,
  medDataSource,
  medEgress,
  medMetering,
  medOperators,
  medTerminology,
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

/**
 * 医疗包的**挂载点**（P1.2）。
 *
 * 医疗包 MUST NOT 反向依赖任何实现包（依赖方向 包 → SPI → 基座），
 * 因此现有实现（出域闸门、算子注册、结算计量、去标识）由应用侧经这些槽位注入；
 * 未注入的槽位一律 fail-closed 或如实标注为代理口径。
 */
export interface MedPackOverrides {
  readonly dataSource?: DataSourceAdapter;
  readonly operators?: OperatorPack;
  readonly egress?: EgressPolicyProvider;
  readonly metering?: MeteringProvider;
  readonly assurance?: AssuranceProfile;
  readonly terminology?: TerminologyDeidentifier;
}

/** 把医疗包的六根缝实现装配为一个 bundle；overrides 用于挂载既有实现。 */
export function createMedPackBundle(overrides: MedPackOverrides = {}): SpiBundle {
  return {
    packId: medPackManifest.id,
    dataSource: overrides.dataSource ?? medDataSource,
    operators: overrides.operators ?? medOperators,
    egress: overrides.egress ?? medEgress,
    metering: overrides.metering ?? medMetering,
    assurance: overrides.assurance ?? medAssurance,
    terminology: overrides.terminology ?? medTerminology,
  };
}

/** 注册并启用医疗包到给定空间（注册受部署白名单约束）。 */
export function mountMedPack(
  registrar: PackRegistrar,
  ctx: SpiContext,
  overrides: MedPackOverrides = {},
): void {
  registrar.register(medPackManifest, createMedPackBundle(overrides));
  registrar.enable(ctx, medPackManifest.id);
}
