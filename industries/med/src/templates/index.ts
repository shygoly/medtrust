// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 的第三块：计划模板（申请方入参 -> 逻辑计划草案）。
 *
 * 已接八条：`l15.disproportionality` / `l4.fl-prediction` / `lora-fedavg` / `paired-cohort` / `vaccine-scri` / `ve-tnd` /
 * `dedup-incidence` / `external-control`。
 * L4 与 LoRA 的 `spec` 用包内结构类型（应用侧 DTO 天然满足）。
 */
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

import { l15Template } from "./l15";
import { l4Template } from "./l4";
import { loraFedAvgTemplate } from "./lora-fedavg";
import {
  dedupIncidenceTemplate,
  vaccineScriTemplate,
  veTndTemplate,
} from "./medical-plans";
import { aeSignalTemplate } from "./ae-signal";
import { conditionPrevalenceTemplate } from "./condition-prevalence";
import { cohortCountTemplate } from "./cohort-count";
import { algorithmValidationTemplate } from "./algorithm-validation";
import { causalPsmTemplate } from "./causal-psm";
import { causalSurvivalTemplate } from "./causal-survival";
import { comparativeEffectTemplate } from "./comparative-effect";
import { externalControlTemplate } from "./external-control";
import { externalControlRegistrationTemplate } from "./external-control-registration";
import { pairedCohortTemplate } from "./paired-cohort";

export * from "./l15";
export * from "./l4";
export * from "./lora-fedavg";
export * from "./medical-plans";
export * from "./ae-signal";
export * from "./category-dictionaries";
export * from "./cohort-count";
export * from "./algorithm-validation";
export * from "./causal-psm";
export * from "./causal-survival";
export * from "./comparative-effect";
export * from "./condition-prevalence";
export * from "./external-control";
export * from "./external-control-registration";
export * from "./paired-cohort";

/** 本包声明的计划模板（S2 `OperatorPack.declareTemplates` 的返回值）。 */
export function medTemplates(): readonly PlanTemplate[] {
  return [
    l15Template,
    l4Template,
    loraFedAvgTemplate,
    pairedCohortTemplate,
    vaccineScriTemplate,
    veTndTemplate,
    dedupIncidenceTemplate,
    externalControlTemplate,
    externalControlRegistrationTemplate,
    cohortCountTemplate,
    comparativeEffectTemplate,
    causalPsmTemplate,
    causalSurvivalTemplate,
    algorithmValidationTemplate,
    aeSignalTemplate,
    conditionPrevalenceTemplate,
  ];
}

/** 注册进基座给的注册面（组装根调用）。 */
export function registerMedTemplates(registry: TemplateRegistry): void {
  for (const template of medTemplates()) registry.register(template);
}
