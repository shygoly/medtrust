/**
 * 计划模板注册表（change `pack-med-templates` / TD-12 最后一刀）。
 *
 * 基座 MUST NOT import 行业模板（否则依赖方向判据报红），行业包在**组装根**按 id 注册，
 * 控制器只按 id 解析。解析不到即 fail-closed（不静默回落任何默认模板）。
 */
import type { PlanTemplate, TemplateRegistry } from "@medtrust/space-kernel-spi";

const templates = new Map<string, PlanTemplate>();

export function registerTemplate(template: PlanTemplate): void {
  templates.set(template.id, template);
}

export function resolveTemplate(id: string): PlanTemplate | undefined {
  return templates.get(id);
}

export function registeredTemplateIds(): string[] {
  return [...templates.keys()];
}

/** 解析不到即抛（含已注册清单，便于定位「组装根忘了注册」）。 */
export function resolveTemplateOrThrow(id: string): PlanTemplate {
  const found = resolveTemplate(id);
  if (!found) {
    const known = registeredTemplateIds();
    throw new Error(
      `计划模板 ${id || "(空)"} 没有注册的实现（已注册：${known.length ? known.join(", ") : "无"}）`,
    );
  }
  return found;
}

/** SPI 约定的注册面（组装根把包声明交进来时用；基座侧实现）。 */
export const kernelTemplateRegistry: TemplateRegistry = {
  register: registerTemplate,
  resolve: (id: string) => resolveTemplate(id),
};
