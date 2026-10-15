// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

import { buildLoadForecastPlan } from "./load-forecast";

export * from "./load-forecast";

/** 本包声明的计划模板（S2 的第三块）。 */
export function powerTemplates(): readonly PlanTemplate[] {
  return [
    {
      id: "power.load-forecast",
      build: (input) => buildLoadForecastPlan(input),
    },
  ];
}

/** 把本包的计划模板注册进基座给的注册面（组装根调用）。 */
export function registerPowerTemplates(registry: TemplateRegistry): void {
  for (const template of powerTemplates()) registry.register(template);
}
