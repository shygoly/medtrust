// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PackManifest } from "@medtrust/space-kernel-spi";

export const POWER_PACK_ID = "power";

/**
 * 电力包的包声明（PACK 契约模板，D-SPD-10）。
 * 许可与文件头一致。未定许可（TBD）不能注册。
 * 词典只登记标识与许可方，不内嵌许可制代码表。
 */
export const powerPackManifest: PackManifest = {
  id: POWER_PACK_ID,
  version: "0.1.0",
  domain: "energy",
  license: "LicenseRef-MedTrust-Research-1.0",
  compatibleSpi: "^0.1.0",
  assuranceProfileId: "power-ops",
  provides: {
    dataSource: [
      "interval-meter",
      "grid-measurement",
      "weather-observation",
      "market-clearing",
      "capability-credential",
    ],
    operators: [
      "urban-anomaly-fusion",
      "renewable-curtailment-risk",
      "v2g-flexibility",
    ],
    egress: "power-default",
    metering: "declared-contribution-proxy",
    assurance: "power-ops",
    terminology: ["iec-61970-cim"],
  },
};
