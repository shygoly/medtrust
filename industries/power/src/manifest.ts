// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { PackManifest } from "@medtrust/space-kernel-spi";

export const POWER_PACK_ID = "power";

/**
 * 电力包的包声明（PACK 契约模板，D-SPD-10）。
 * 许可与文件头一致。未定许可（TBD）不能注册。
 * 词典只登记标识与许可方，不内嵌许可制代码表。
 */
export const powerPackManifest: PackManifest = {
  id: POWER_PACK_ID,
  version: "0.1.0",
  domain: "energy",
  license: "LicenseRef-MedTrust-Research-1.0",
  compatibleSpi: "^0.1.0",
  assuranceProfileId: "power-ops",
  provides: {
    dataSource: [
      "interval-meter",
      "grid-measurement",
      "weather-observation",
      "market-clearing",
      "capability-credential",
    ],
    operators: [
      "urban-anomaly-fusion",
      "renewable-curtailment-risk",
      "v2g-flexibility",
    ],
    egress: "power-default",
    metering: "declared-contribution-proxy",
    assurance: "power-ops",
    terminology: ["iec-61970-cim"],
  },
};

/** 算子类型：wasm 为节点侧隐私计算算子；system 为平台侧合并/优化算子。 */
export type PowerOperatorKind = "wasm" | "system";

export interface PowerOperatorSpec {
  readonly id: string;
  readonly version: string;
  readonly kind: PowerOperatorKind;
  readonly description: string;
}

/**
 * MDOP 标准场景的算子清单（负荷预测 / 需求响应 / 窃电检测）。
 * 与上面的 powerPackManifest.provides.operators（河南电力空间的三个算子）并存。
 */
export const POWER_OPERATORS: readonly PowerOperatorSpec[] = [
  { id: "power.feature-extraction", version: "1.0.0", kind: "system", description: "时序特征工程" },
  { id: "power.load-forecast-merge", version: "1.0.0", kind: "system", description: "负荷预测合并" },
  { id: "power.dr-potential", version: "1.0.0", kind: "system", description: "需求响应潜力评估" },
  { id: "power.dr-optimize", version: "1.0.0", kind: "system", description: "需求响应优化" },
  { id: "power.anomaly-detection", version: "1.0.0", kind: "system", description: "异常用电检测" },
  { id: "power.theft-merge", version: "1.0.0", kind: "system", description: "跨区域窃电模式合并" },
];
