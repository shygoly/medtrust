// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

import { buildDemandResponsePlan } from "./demand-response";
import { buildLoadForecastPlan } from "./load-forecast";
import { buildTheftDetectionPlan } from "./theft-detection";

export * from "./load-forecast";
export * from "./demand-response";
export * from "./theft-detection";

/** 本包声明的计划模板（S2 的第三块）。 */
export function powerTemplates(): readonly PlanTemplate[] {
  return [
    {
      id: "power.load-forecast",
      build: (input) => buildLoadForecastPlan(input),
    },
    {
      id: "power.demand-response",
      build: (input) => buildDemandResponsePlan(input),
    },
    {
      id: "power.theft-detection",
      build: (input) => buildTheftDetectionPlan(input),
    },
  ];
}

/** 把本包的计划模板注册进基座给的注册面（组装根调用）。 */
export function registerPowerTemplates(registry: TemplateRegistry): void {
  for (const template of powerTemplates()) registry.register(template);
}
