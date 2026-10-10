// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/** 能力包声明契约（PACK 模板，D-SPD-10）。 */

export interface PackProvides {
  readonly dataSource?: readonly string[];
  readonly operators?: readonly string[];
  readonly egress?: string;
  readonly metering?: string;
  readonly assurance?: string;
  readonly terminology?: readonly string[];
}

export interface PackManifest {
  readonly id: string;
  readonly version: string;
  readonly domain: string;
  readonly license: string;
  /** 兼容的 SPI 语义化版本范围。 */
  readonly compatibleSpi: string;
  readonly assuranceProfileId?: string;
  readonly provides: PackProvides;
}

/** SPI 版本：内核与包按语义化版本协商（D-SPD-10）。 */
export const SPI_VERSION = "0.1.0";
