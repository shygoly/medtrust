// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * S2 的第三块：计划模板（申请方入参 -> 逻辑计划草案）。
 *
 * 本变更竖切先接 `paired-cohort`；`vaccine-scri` / `ve-tnd` / `dedup-incidence` / `l15` 按同一形态接入，
 * `l4.fl-prediction` 留待 FL 迁移收尾（它依赖 `FlPredictionTaskSpec`，与本变更解耦）。
 */
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

import { pairedCohortTemplate } from "./paired-cohort";

export * from "./paired-cohort";

/** 本包声明的计划模板（S2 `OperatorPack.declareTemplates` 的返回值）。 */
export function medTemplates(): readonly PlanTemplate[] {
  return [pairedCohortTemplate];
}

/** 注册进基座给的注册面（组装根调用）。 */
export function registerMedTemplates(registry: TemplateRegistry): void {
  for (const template of medTemplates()) registry.register(template);
}
