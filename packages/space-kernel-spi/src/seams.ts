// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * space-kernel-spi —— 可信空间基座的六根扩展缝（S1-S6）。
 *
 * 约束（D-SPD-1 / D-SPD-6）：
 *   本包 MUST 保持零依赖、零领域语义。出现任何行业词即视为假解耦，
 *   scripts/check-kernel-purity.mjs 会报红。
 *
 * 空间维度（D-SPD-2 / D-SPD-10）：
 *   所有跨缝调用 MUST 携带空间上下文 SpiContext，使「一个部署承载多个空间」
 *   在接口层即成立；内核 MUST NOT 使用进程级单例替代它。
 *
 * 开源边界（D-SPD-5 / D-SPD-6）：
 *   出域策略 S3、合规 profile S5、去标识代码 S6 MUST 开源或至少可审；
 *   域内算子 S2 与计量/估值 S4 可以闭源，但 MUST 满足闭源准入公理。
 */

/** 每次 SPI 调用都携带空间上下文，由内核注入。 */
export interface SpiContext {
  readonly spaceId: string;
  /** 可选：本次调用的追踪标识（与存证 / 审计对齐）。 */
  readonly traceId?: string;
}

/* ------------------------------------------------------------------ S1 数据源适配 */

export interface DataSourceDescriptor {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
}

export interface ProjectionSpec {
  /** 允许回传的最小列投影；MUST 下推到数据源执行。 */
  readonly columns: readonly string[];
  readonly rowFilter?: string;
}

export interface DataSourceCoverage {
  readonly rows?: number;
  readonly tables?: number;
  readonly observedAt?: string;
}

export interface DataSourceValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * S1：数据源适配。控制面只见 label；凭据与句柄只在数据持有方侧（D-CN-6）。
 * 投影与行过滤 MUST 下推，只回传最小投影载荷；校验 fail-closed。
 */
export interface DataSourceAdapter {
  readonly kind: string;
  describe(ctx: SpiContext, sourceId: string): DataSourceDescriptor | Promise<DataSourceDescriptor>;
  validate(ctx: SpiContext, sourceId: string, declaration: unknown): DataSourceValidation | Promise<DataSourceValidation>;
  pushdownProjection(ctx: SpiContext, spec: ProjectionSpec): ProjectionSpec;
  coverage(ctx: SpiContext, sourceId: string): DataSourceCoverage | Promise<DataSourceCoverage>;
}

/* ------------------------------------------------------------------ S2 算子包 */

export type OperatorKind = "wasm" | "oci" | "system";

export interface OperatorPort {
  readonly name: string;
  readonly schema: string;
  readonly acceptLabels: readonly string[];
  readonly labelRule?: string;
}

export interface OperatorDeclaration {
  readonly id: string;
  readonly version: string;
  readonly kind: OperatorKind;
  readonly category: string;
  /** wasm 为模块摘要；oci 为镜像 digest。MUST 来自复现构建或受信注册（D-CN-5）。 */
  readonly digest: string;
  readonly environments: readonly string[];
  readonly inputs: readonly OperatorPort[];
  readonly outputs: readonly OperatorPort[];
}

/**
 * 平台侧聚合收集器声明（S2 的**平台侧**一半）。
 *
 * 为什么在 S2 而不是新开一根缝：SPI 是**机检的六根（S1–S6）**（KERNEL.md §3、
 * `scripts/conformance/check-pack.mjs` 按缝名对拍），新开第七根会把改动面扩散到治理文档与一致性套件；
 * 而「分析算子」本来就同时有节点侧实现（`declareOperators`）与平台侧合并口径（本接口），同属算子包。
 *
 * 形状上 MUST 保持**零领域语义**：输入输出是调用方自己的类型（默认 `unknown`），SPI 只说「怎么声明/怎么被解析」。
 */
export interface AggregationCollector<I = unknown, O = unknown> {
  /** 该收集器认领的分析类型（与节点侧算子的分析类型同一命名空间）。 */
  readonly analysisType: string;
  /** 平台侧合并：吃各节点投递的载荷，产出平台 C3（口径由包自己保证与节点侧对拍）。 */
  merge(input: I, ctx: SpiContext): O;
}

/**
 * 聚合收集器注册面：**由基座实现**，包只依赖此接口（与 `registry.ts` 的包注册面同一约定）。
 * 解析不到时 MUST 由调用方 fail-closed（MUST NOT 回退默认收集器）。
 */
export interface AggregationCollectorRegistry {
  register(collector: AggregationCollector): void;
  resolve(analysisType: string): AggregationCollector | undefined;
}

/**
 * S2：算子包。可闭源（D-SPD-6），但 MUST 走 Wasm / OCI 形态与既有五道闸（D-SPD-8）。
 * 本地白名单仍由数据持有方掌握，缺省为空（fail-closed）。
 *
 * `declareCollectors` 为**可选**：不声明平台侧聚合的包（或尚未接线的包）保持既有行为，
 * 基座侧解析不到即 fail-closed（见 `AggregationCollectorRegistry`）。
 */
export interface OperatorPack {
  readonly packId: string;
  declareOperators(ctx: SpiContext): readonly OperatorDeclaration[];
  declareCollectors?(ctx: SpiContext): readonly AggregationCollector[];
}

/* ------------------------------------------------------------------ S3 出域策略 */

export type EgressRuleKind =
  | "minimum-count"
  | "time-coarsening"
  | "space-coarsening"
  | "k-anonymity"
  | "differential-privacy";

export interface EgressRule {
  readonly id: string;
  readonly kind: EgressRuleKind;
  readonly params: Readonly<Record<string, number | string | boolean>>;
}

/**
 * S3：出域策略模板。MUST 开源或可审（D-SPD-5 / D-SPD-6）：
 * 该缝决定数据是否放行，闭源实现等于无法验证其不泄漏。
 * 行业无关表述：阈值用 minimumCount，不内建任何行业语义（对照 D-SPD-6）。
 */
export interface EgressPolicyTemplate {
  readonly templateId: string;
  readonly minimumCount: number;
  readonly allowedArtifacts: readonly string[];
  readonly rules: readonly EgressRule[];
}

export interface EgressPolicyProvider {
  resolve(ctx: SpiContext): EgressPolicyTemplate;
}

/* ------------------------------------------------------------------ S4 计量口径 */

export interface MeteringEngineRef {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  /** authoritative = 算法口径；proxy = 开放兜底口径（D-SPD-7）。 */
  readonly mode: "authoritative" | "proxy";
}

export interface MeteringContribution {
  readonly subjectId: string;
  readonly quantity: number;
  readonly unit: string;
}

export interface MeteringInput {
  readonly taskId: string;
  /** 只许是聚合统计量或元数据，MUST NOT 携带行级原始数据（D-SPD-5 / D-SPD-7）。 */
  readonly outputs: readonly unknown[];
}

export interface MeteringMeasurement {
  readonly engine: MeteringEngineRef;
  readonly contributions: readonly MeteringContribution[];
}

/**
 * S4：计量口径 / 估值接入面。可闭源（D-SPD-6），但 MUST 记录引擎 id / version /
 * digest 并可与开放兜底口径对拍（D-SPD-7）；无闭源实现时走兜底并如实标注为 proxy。
 */
export interface MeteringProvider {
  measure(ctx: SpiContext, input: MeteringInput): MeteringMeasurement | Promise<MeteringMeasurement>;
}

/* ------------------------------------------------------------------ S5 合规配置 */

export interface AssuranceCheck {
  readonly ok: boolean;
  readonly gaps: readonly string[];
}

/**
 * S5：合规与效度配置。MUST 开源或可审（D-SPD-5）：监管与客户必须能审。
 * 规则数据行业化，机制通用；缺省 fail-closed。
 */
export interface AssuranceProfile {
  readonly profileId: string;
  readonly requiredElements: readonly string[];
  readonly assuranceLevels: readonly string[];
  verify(ctx: SpiContext, subject: unknown): AssuranceCheck;
}

/* ------------------------------------------------------------------ S6 术语与去标识 */

export interface TerminologyDictionary {
  readonly id: string;
  readonly version: string;
  /** 词典许可标识；许可制词典 MUST 标注来源（D-SPD-19）。 */
  readonly license: string;
  readonly codes: readonly string[];
}

/**
 * S6：术语与去标识。去标识代码 MUST 开源或可审（D-SPD-5）——
 * 处理原始标识符的环节必须能被证明真的脱敏；词典属数据，可为许可制。
 */
export interface TerminologyDeidentifier {
  dictionaries(ctx: SpiContext): readonly TerminologyDictionary[];
  deidentify(ctx: SpiContext, record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
}
