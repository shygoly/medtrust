// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 的第三块：计划模板（申请方入参 -> 逻辑计划草案）。
 *
 * 已接五条：`l15.disproportionality` / `paired-cohort` / `vaccine-scri` / `ve-tnd` / `dedup-incidence`。
 * `l4.fl-prediction` 显式留待 FL 迁移收尾（它依赖 `FlPredictionTaskSpec`，与本变更解耦）。
 */
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

import { l15Template } from "./l15";
import {
  dedupIncidenceTemplate,
  vaccineScriTemplate,
  veTndTemplate,
} from "./medical-plans";
import { pairedCohortTemplate } from "./paired-cohort";

export * from "./l15";
export * from "./medical-plans";
export * from "./paired-cohort";

/** 本包声明的计划模板（S2 `OperatorPack.declareTemplates` 的返回值）。 */
export function medTemplates(): readonly PlanTemplate[] {
  return [
    l15Template,
    pairedCohortTemplate,
    vaccineScriTemplate,
    veTndTemplate,
    dedupIncidenceTemplate,
  ];
}

/** 注册进基座给的注册面（组装根调用）。 */
export function registerMedTemplates(registry: TemplateRegistry): void {
  for (const template of medTemplates()) registry.register(template);
}
