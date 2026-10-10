// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type {
  MeteringContribution,
  MeteringInput,
  MeteringMeasurement,
  MeteringProvider,
  SpiContext,
} from "@medtrust/space-kernel-spi";

/**
 * 开放兜底计量口径（P3.1 / D-SPD-7）。
 *
 * 无算法口径（闭源插件）时使用：以输入里的**聚合量**作为贡献度代理，
 * 并在结果里**如实标注** mode = proxy —— MUST NOT 冒充算法口径。
 * 输入只许是聚合统计量，MUST NOT 携带行级原始数据（KERNEL.md §4）。
 */

interface ProxyShape {
  subjectId?: unknown;
  participantId?: unknown;
  quantity?: unknown;
  count?: unknown;
  unit?: unknown;
}

export function extractProxyContributions(
  outputs: readonly unknown[],
): MeteringContribution[] {
  const out: MeteringContribution[] = [];
  for (const item of outputs) {
    if (!item || typeof item !== "object") continue;
    const o = item as ProxyShape;
    const subjectId =
      typeof o.subjectId === "string"
        ? o.subjectId
        : typeof o.participantId === "string"
          ? o.participantId
          : undefined;
    const rawQuantity =
      typeof o.quantity === "number" ? o.quantity : typeof o.count === "number" ? o.count : undefined;
    if (!subjectId) continue;
    if (typeof rawQuantity !== "number" || !Number.isFinite(rawQuantity) || rawQuantity < 0) continue;
    out.push({
      subjectId,
      quantity: rawQuantity,
      unit: typeof o.unit === "string" ? o.unit : "count",
    });
  }
  return out;
}

export class ProxyMeteringProvider implements MeteringProvider {
  constructor(
    private readonly engineId: string = "proxy-count",
    private readonly engineVersion: string = "1",
  ) {}

  measure(_ctx: SpiContext, input: MeteringInput): MeteringMeasurement {
    return {
      engine: {
        id: this.engineId,
        version: this.engineVersion,
        digest: "n/a",
        mode: "proxy",
      },
      contributions: extractProxyContributions(input.outputs),
    };
  }
}

/** 兜底口径的贡献度合计（分账公式的分母）。 */
export function contributionTotal(measurement: MeteringMeasurement): number {
  return measurement.contributions.reduce((sum, c) => sum + c.quantity, 0);
}
