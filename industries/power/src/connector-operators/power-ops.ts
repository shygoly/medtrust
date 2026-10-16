// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 连接器侧电力算子声明（任务 6.1 的包内半截）。
 * 实际 Nest wiring 在 apps/connector/src/wiring/wire-power.ts。
 */

export const POWER_NODE_OPERATOR_REFS = [
  "power.feature-extraction@1.0.0",
  "power.dr-potential@1.0.0",
  "power.anomaly-detection@1.0.0",
] as const;

export type PowerNodeOperatorRef = (typeof POWER_NODE_OPERATOR_REFS)[number];
