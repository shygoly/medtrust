// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type {
  AssuranceCheck,
  AssuranceProfile,
  DataSourceAdapter,
  DataSourceCoverage,
  DataSourceDescriptor,
  DataSourceValidation,
  EgressPolicyProvider,
  EgressPolicyTemplate,
  MeteringContribution,
  MeteringInput,
  MeteringMeasurement,
  MeteringProvider,
  OperatorDeclaration,
  OperatorPack,
  ProjectionSpec,
  SpiContext,
  TerminologyDeidentifier,
  TerminologyDictionary,
} from "@medtrust/space-kernel-spi";

import { POWER_PACK_ID } from "./manifest";

/**
 * 电力包的 P1 挂载骨架（D-SPD-6）。
 *
 * 只声明领域在六根缝上的取值。算子摘要在复现构建登记前返回空集（fail-closed），
 * MUST NOT 臆造 digest。用户侧曲线默认只允许聚合出域。
 */

/**
 * 与基座缺省最小计数一致（DEFAULT_MIN_CELL / MIN_CELL_FLOOR = 5）。
 * 本包不另立计数；提高计数须由电力合规册单独决定。
 */
export const POWER_MINIMUM_COUNT = 5;

/** 任务输出里禁止出现的字段：户表曲线与户籍明细不得离开计算位置。 */
export const FORBIDDEN_OUTPUT_FIELDS = [
  "meter-series",
  "household-curve",
  "registry-detail",
  "household-registry",
] as const;

export function rejectForbiddenOutput(
  outputFields: readonly string[],
): string | null {
  const blocked = new Set<string>(FORBIDDEN_OUTPUT_FIELDS);
  const hit = outputFields.find((field) => blocked.has(field));
  return hit ? "forbidden-output" : null;
}

export const powerEgress: EgressPolicyProvider = {
  resolve(_ctx: SpiContext): EgressPolicyTemplate {
    return {
      templateId: "power-default",
      minimumCount: POWER_MINIMUM_COUNT,
      allowedArtifacts: ["aggregate"],
      rules: [
        {
          id: "min-count",
          kind: "minimum-count",
          params: { minimumCount: POWER_MINIMUM_COUNT },
        },
      ],
    };
  },
};

export const powerOperatorIds = [
  "urban-anomaly-fusion",
  "renewable-curtailment-risk",
  "v2g-flexibility",
] as const;

export const powerOperators: OperatorPack = {
  packId: POWER_PACK_ID,
  declareOperators(_ctx: SpiContext): readonly OperatorDeclaration[] {
    return [];
  },
};

export const powerMetering: MeteringProvider = {
  measure(_ctx: SpiContext, _input: MeteringInput): MeteringMeasurement {
    const contributions: readonly MeteringContribution[] = [];
    return {
      engine: {
        id: "declared-contribution-proxy",
        version: "1",
        digest: "n/a",
        mode: "proxy",
      },
      contributions,
    };
  },
};

export const powerAssurance: AssuranceProfile = {
  profileId: "power-ops",
  requiredElements: [],
  assuranceLevels: ["basic", "federated", "enhanced"],
  verify(_ctx: SpiContext, _subject: unknown): AssuranceCheck {
    return { ok: false, gaps: ["assurance-profile-not-wired"] };
  },
};

export const powerTerminology: TerminologyDeidentifier = {
  dictionaries(_ctx: SpiContext): readonly TerminologyDictionary[] {
    return [
      {
        id: "iec-61970-cim",
        version: "iec-61970",
        license: "IEC 61970 CIM（标准文本许可，代码表不入库）",
        codes: [],
      },
    ];
  },
  deidentify(
    _ctx: SpiContext,
    _record: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    throw new Error("power-deidentify-not-wired");
  },
};

export const powerDataSource: DataSourceAdapter = {
  kind: "declared-series",
  describe(_ctx: SpiContext, sourceId: string): DataSourceDescriptor {
    return { id: sourceId, label: sourceId, kind: "declared-series" };
  },
  validate(
    _ctx: SpiContext,
    _sourceId: string,
    _declaration: unknown,
  ): DataSourceValidation {
    return { ok: false, errors: ["data-source-adapter-not-wired"] };
  },
  pushdownProjection(_ctx: SpiContext, spec: ProjectionSpec): ProjectionSpec {
    return spec;
  },
  coverage(_ctx: SpiContext, _sourceId: string): DataSourceCoverage {
    return {};
  },
};
