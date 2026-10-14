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
 * 节点侧**阶段沙箱**的宿主面（由基座实现、由基座构造后交给包）。
 *
 * 为什么这样切（change `pack-med-sandboxes` design D2）：节点在执行**解封明文**时有三条出域判据
 * （错误文案不带数据 / 编码白名单参数 / 分层键闭合语法），它们 MUST 留在基座。
 * 于是：包拿到的是**已被判据放行**的执行原语（编码白名单校验、分层键校验、按摘要取模块、调沙箱、
 * 按内存上限拒），以及本阶段的输入；包 MUST NOT 绕开宿主去拿数据或模块字节。
 */
export interface SandboxRunRequest {
  /** 模块自述的算法类型（写进沙箱审计），不由宿主推断。 */
  readonly analysisType: string;
  readonly input: Uint8Array;
  /** ABI 形状由宿主显式给出（模块自述不作数）。 */
  readonly abi: string;
  readonly n?: number;
  readonly k?: number;
  readonly parties?: number;
  readonly strata?: number;
  readonly outOff: number;
  readonly outBytes: number;
  /** 实现自报的内存需求；宿主在调用模块**之前**按沙箱上限判。 */
  readonly requiredBytes: number;
}

export interface SandboxHost {
  readonly spaceId: string;
  /** 本阶段的原始输入（阶段声明 + 参数 + 上游载荷）；凭证/白名单/摘要已由执行器验过。 */
  readonly stageInput: unknown;
  /** 本阶段要执行的模块摘要（SM3，不带前缀）。 */
  readonly moduleSm3: string;
  /** 按角色取行（角色绑定由阶段参数给）；找不到绑定即抛。 */
  rowsByRole(
    input: unknown,
    roles: Readonly<Record<string, unknown>>,
    label: string,
  ): Map<string, readonly unknown[]>;
  /** 编码白名单参数（判据 2）：给了就必须合法，否则抛。 */
  codeWhitelist(
    params: Readonly<Record<string, unknown>>,
    name: string,
    opName: string,
  ): string[] | undefined;
  /** 本阶段的参与方表（node + rows）：行提取原语留在基座，包只读它拿到的这份。 */
  tables(stageInput: unknown): ReadonlyArray<{ node: string; rows: readonly unknown[] }>;
  /** 固定分层顺序（判据 3 的入参侧）：给了就必须逐项合闭合语法，否则抛。 */
  strataKeys(value: unknown, source: string): string[] | undefined;
  /** 节点配置的固定分层顺序（判据 3 的入参侧，来源是节点配置而不是阶段参数）。 */
  configuredStrataKeys(source: string): string[] | undefined;
  /** 调沙箱：内存上限由宿主判、模块字节由宿主按摘要取，ABI 由调用方给。 */
  runSandbox(request: SandboxRunRequest): Promise<{ output: Uint8Array }>;
}

/**
 * 节点侧**阶段沙箱**：一种算子的整段执行（投影  ABI 调用  输出回填）都在包内，
 * 但只经 `SandboxHost` 取得已放行的输入与执行原语。按**算子引用**分派（与执行器的分派同一把钥匙）。
 */
export interface StageSandbox<O = unknown> {
  readonly opRef: string;
  runStage(host: SandboxHost): Promise<O>;
}

/** 阶段沙箱注册面：由基座实现，包只依赖此接口。解析不到时 MUST 由调用方 fail-closed。 */
export interface SandboxRegistry {
  register(sandbox: StageSandbox): void;
  resolve(opRef: string): StageSandbox | undefined;
}

/**
 * S2：算子包。可闭源（D-SPD-6），但 MUST 走 Wasm / OCI 形态与既有五道闸（D-SPD-8）。
 * 本地白名单仍由数据持有方掌握，缺省为空（fail-closed）。
 *
 * `declareCollectors` / `declareSandboxes` 为**可选**：不声明的包（或尚未接线的包）保持既有行为，
 * 基座侧解析不到即 fail-closed（见 `AggregationCollectorRegistry` / `SandboxRegistry`）。
 */
export interface OperatorPack {
  readonly packId: string;
  declareOperators(ctx: SpiContext): readonly OperatorDeclaration[];
  declareCollectors?(ctx: SpiContext): readonly AggregationCollector[];
  declareSandboxes?(ctx: SpiContext): readonly StageSandbox[];
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
