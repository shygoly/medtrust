// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 的第三块：计划模板（申请方入参 -> 逻辑计划草案）。
 *
 * 已接七条：`l15.disproportionality` / `l4.fl-prediction` / `paired-cohort` / `vaccine-scri` / `ve-tnd` /
 * `dedup-incidence` / `external-control`（后者 2026-10-14 随 external-control-arm tasks 6.2 接入）。
 * L4 的 `spec` 用包内结构类型 `L4FlSpecLike`（应用侧 `FlPredictionTaskSpec` 天然满足）。
 */
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

import { l15Template } from "./l15";
import { l4Template } from "./l4";
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
import { pairedCohortTemplate } from "./paired-cohort";

export * from "./l15";
export * from "./l4";
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
export * from "./paired-cohort";

/** 本包声明的计划模板（S2 `OperatorPack.declareTemplates` 的返回值）。 */
export function medTemplates(): readonly PlanTemplate[] {
  return [
    l15Template,
    l4Template,
    pairedCohortTemplate,
    vaccineScriTemplate,
    veTndTemplate,
    dedupIncidenceTemplate,
    externalControlTemplate,
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
