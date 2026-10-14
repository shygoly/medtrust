// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type {
  StageSandbox,
  AggregationCollector,
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
import { medAggregationCollectors } from "./collectors";
import { medSandboxes } from "./sandboxes";

import { MED_PACK_ID } from "./manifest";

/**
 * 医疗包的 P1 挂载骨架（D-SPD-6）。
 *
 * 本文件只**声明**医疗领域在六根缝上的取值与实现位点，MUST NOT 改变既有行为：
 * 主线代码（出域闸门、算子注册、结算计量、去标识）尚未改为经 SPI 调用。
 * 凡标注「待挂载」处，真值仍在既有实现里；接线时 MUST 以既有实现为准并跑既有测试。
 */

/** 出域默认最小计数：与既有合约 outputPolicy 缺省一致（D-DC-2）。 */
export const MED_MINIMUM_COUNT = 5;

export const medEgress: EgressPolicyProvider = {
  resolve(_ctx: SpiContext): EgressPolicyTemplate {
    return {
      templateId: "med-default",
      minimumCount: MED_MINIMUM_COUNT,
      allowedArtifacts: ["aggregate", "model-delta"],
      rules: [
        {
          id: "min-count",
          kind: "minimum-count",
          params: { minimumCount: MED_MINIMUM_COUNT },
        },
      ],
    };
  },
};

export const medOperatorIds = [
  "disproportionality",
  "paired-cohort",
  "vaccine-scri",
] as const;

export const medOperators: OperatorPack = {
  packId: MED_PACK_ID,
  /** 平台侧聚合（S2 的平台侧一半）：声明即可被组装根注册；缺省不声明 = 基座不认该类型（fail-closed）。 */
  declareCollectors(_ctx: SpiContext): readonly AggregationCollector[] {
    return medAggregationCollectors();
  },
  /** 节点侧阶段沙箱（S2 的节点侧一半）：声明即可被组装根注册。 */
  declareSandboxes(_ctx: SpiContext): readonly StageSandbox[] {
    return medSandboxes();
  },
  declareOperators(_ctx: SpiContext): readonly OperatorDeclaration[] {
    // 待挂载：摘要 MUST 取自 packages/wasm-algorithms 的复现构建清单（D-CN-5）。
    // 接线前不臆造 digest，故先返回空集（fail-closed）。
    return [];
  },
};

export const medMetering: MeteringProvider = {
  measure(_ctx: SpiContext, _input: MeteringInput): MeteringMeasurement {
    // 待挂载：现口径为队列规模代理（D-VS-1），真值由编排器产出、consumer 不可自报。
    // 接线前如实标注为 proxy，禁止静默假装已用算法口径（D-SPD-7）。
    const contributions: readonly MeteringContribution[] = [];
    return {
      engine: { id: "cohort-size-proxy", version: "1", digest: "n/a", mode: "proxy" },
      contributions,
    };
  },
};

export const medAssurance: AssuranceProfile = {
  profileId: "med-evidence-regulatory",
  requiredElements: [], // 待挂载：EVIDENCE.md 的必填研究要素
  assuranceLevels: ["basic", "federated", "enhanced"],
  verify(_ctx: SpiContext, _subject: unknown): AssuranceCheck {
    // 未接线前 fail-closed，MUST NOT 默认放行。
    return { ok: false, gaps: ["assurance-profile-not-wired"] };
  },
};

export const medTerminology: TerminologyDeidentifier = {
  dictionaries(_ctx: SpiContext): readonly TerminologyDictionary[] {
    return [
      { id: "icd", version: "10", license: "WHO ICD-10", codes: [] },
      { id: "snomed", version: "2024", license: "SNOMED CT affiliate license", codes: [] },
      { id: "loinc", version: "2.77", license: "LOINC license", codes: [] },
      { id: "atc", version: "2024", license: "WHO ATC", codes: [] },
    ];
  },
  deidentify(_ctx: SpiContext, record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    // 待挂载：既有 apps/connector/src/domain/deidentifier.ts（INV-DEID-01）。
    // 去标识代码 MUST 开源或可审（D-SPD-5）；接线时 MUST NOT 换成闭源实现。
    return record;
  },
};

export const medDataSource: DataSourceAdapter = {
  kind: "omop-cdm",
  describe(_ctx: SpiContext, sourceId: string): DataSourceDescriptor {
    return { id: sourceId, label: sourceId, kind: "omop-cdm" };
  },
  validate(_ctx: SpiContext, _sourceId: string, _declaration: unknown): DataSourceValidation {
    return { ok: false, errors: ["data-source-adapter-not-wired"] };
  },
  pushdownProjection(_ctx: SpiContext, spec: ProjectionSpec): ProjectionSpec {
    return spec;
  },
  coverage(_ctx: SpiContext, _sourceId: string): DataSourceCoverage {
    return {};
  },
};
