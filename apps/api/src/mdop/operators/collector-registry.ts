/**
 * 平台侧聚合收集器注册表（change `pack-med-collectors` / TD-12）。
 *
 * 为什么要有它：基座 MUST NOT 认识具体分析类型，也不能 import 行业包（否则守护的依赖方向判据报红）。
 * 行业包（如 `@medtrust/domain-med`）在**组装根**把实现注册进来，基座只按 `analysisType` 解析。
 *
 * 契约（见 change design D4 与 `specs/kernel-spi`）：解析不到时，调用方 MUST fail-closed；
 * 本模块提供 `resolve`（返回 undefined，供「有就用自己的口径、没有就按基座口径」的分派）与
 * `resolveOrThrow`（要不到就报错，供只应走行业口径的调用点）。
 */
import type {
  AggregationCollector,
  AggregationCollectorRegistry,
} from "@medtrust/space-kernel-spi";

const collectors = new Map<string, AggregationCollector>();

/** 注册一个收集器；同类型重复注册时后者生效（与 SPI 包注册面的约定一致）。 */
export function registerCollector(collector: AggregationCollector): void {
  collectors.set(collector.analysisType, collector);
}

/** 已注册的分析类型（用于错误信息与自检；顺序按注册先后）。 */
export function registeredCollectorTypes(): string[] {
  return [...collectors.keys()];
}

/** 按分析类型解析；未注册返回 undefined（调用方决定是否 fail-closed）。 */
export function resolveCollector(
  analysisType: string,
): AggregationCollector | undefined {
  return collectors.get(analysisType);
}

/** 解析不到即抛（含已注册清单，便于定位「组装根忘了注册」这类问题）。 */
export function resolveCollectorOrThrow(
  analysisType: string,
): AggregationCollector {
  const found = resolveCollector(analysisType);
  if (!found) {
    const known = registeredCollectorTypes();
    throw new Error(
      `平台合并：分析类型 ${analysisType || "(空)"} 没有注册的聚合收集器` +
        `（已注册：${known.length ? known.join(", ") : "无"}）` +
        "；按契约 fail-closed，不回退到默认口径、不产出空结果",
    );
  }
  return found;
}

/** SPI 约定的注册面（组装根把包声明交进来时用；基座侧实现）。 */
export const kernelCollectorRegistry: AggregationCollectorRegistry = {
  register: registerCollector,
  resolve: (analysisType: string) => resolveCollector(analysisType),
};
