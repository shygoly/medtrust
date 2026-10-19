// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PackManifest } from "@medtrust/space-kernel-spi";

export const MED_PACK_ID = "med";

/**
 * 医疗包的包声明（PACK 契约模板，D-SPD-10）。
 * 许可与文件头一致。未定许可（TBD）不能注册。
 */
export const medPackManifest: PackManifest = {
  id: MED_PACK_ID,
  version: "0.1.0",
  domain: "healthcare",
  license: "LicenseRef-MedTrust-Research-1.0",
  compatibleSpi: "^0.1.0",
  assuranceProfileId: "med-evidence-regulatory",
  provides: {
    dataSource: ["omop-cdm"],
    operators: [
      "disproportionality",
      "paired-cohort",
      "vaccine-scri",
      "external-control",
      "external-control-registration",
    ],
    egress: "med-default",
    metering: "cohort-size-proxy",
    assurance: "med-evidence-regulatory",
    terminology: ["icd", "snomed", "loinc", "atc"],
  },
};
