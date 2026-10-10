// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PackManifest } from "@medtrust/space-kernel-spi";

export const MED_PACK_ID = "med";

/**
 * 医疗包的包声明（PACK 契约模板，D-SPD-10）。
 * license 为 TBD：开源拆分前须定许可（D-SPD-19）。
 */
export const medPackManifest: PackManifest = {
  id: MED_PACK_ID,
  version: "0.1.0",
  domain: "healthcare",
  license: "TBD",
  compatibleSpi: "^0.1.0",
  assuranceProfileId: "med-evidence-regulatory",
  provides: {
    dataSource: ["omop-cdm"],
    operators: ["disproportionality", "paired-cohort", "vaccine-scri"],
    egress: "med-default",
    metering: "cohort-size-proxy",
    assurance: "med-evidence-regulatory",
    terminology: ["icd", "snomed", "loinc", "atc"],
  },
};
