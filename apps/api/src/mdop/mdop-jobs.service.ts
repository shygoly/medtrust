import { currentSpaceId } from "../runtime/space-context/space-id.util";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  MdopFragmentEntity,
  MdopJobEntity,
  MdopStageEntity,
} from "@medtrust/database";
import {
  MdopError,
  assertJobTransition,
  assertNodeCanRun,
  assertDeclassifyNotWeaker,
  computePlanHash,
  datasetUriNode,
  deriveOutputLabel,
  fragmentHash,
  isCrossNode,
  joinAll,
  mergeAttestationPolicies,
  operatorRefString,
  parseLogicalPlan,
  parseOperatorManifest,
  parseOperatorRef,
  participantUrn,
  validateEdge,
  type PublicationConditions,
  type Fragment,
  type FlowLabel,
  type LogicalPlan,
  type NodeCapability,
  type PlanEdge,
  type PlanHashJobHeader,
  type PhysicalStage,
  type AttestationPolicy,
} from "@medtrust/mdop";
import {
  compileAggregateStage,
  expandAggregateStage,
} from "./compiler/aggregate-stage";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopAttestationService } from "./mdop-attestation.service";

/**
 * MDOP 作业提交与编译器（协议 §6 / §8.1、规格「作业提交」「编译期放置」
 * 「编译期标签、能力与合约校验」「片段切分与计划哈希」）。
 *
 * 编译是**纯函数式**的：给定逻辑计划 + 已登记算子 + 各节点能力通告 + 合约，
 * 输出确定性物理计划与 `plan_hash`。平台自己不算数据，也不在这里做任何 I/O 之外的事。
 */

/** 平台合并节点的标识（多节点依赖只能放这里）。 */
export const PLATFORM_NODE = "urn:tds:sh-med:participant:platform";

export interface SubmitJobInput {
  /**
   * 这个作业实现的是哪个分析类型（台账 key）。通用 `POST /mdop/jobs` 接受的计划里没有分析类型字段，
   * 平台无法判定它属于哪条通道，因此入口要求能归属（显式给这个字段，或计划里带已登记的 merge.* 阶段）；
   * 归属不出来即拒（D-MDOP-7，tasks 2.7）。
   */
  analysisKey?: string;
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  stages: Array<{
    id: string;
    op: string;
    inputs: Array<{ from: string }>;
    params?: Record<string, unknown>;
    at?: string;
    ttl_hours?: number;
  }>;
  ethics_ref?: string;
  dp_budget?: number;
  deadline?: string;
  not_before: string;
  not_after: string;
  contractBundle?: {
    id: string;
    version: string;
  };
  contractBindings?: Array<{
    contractId: string;
    participantId: string;
    dataProductId: string;
    role: string;
    stages: string[];
  }>;
}

export interface CompileInput {
  jobId: string;
  /** 节点 → 能力通告（来自心跳；缺省视为没有任何能力）。 */
  capabilities: Map<string, NodeCapability>;
  /** 平台节点标识（合并阶段的落点）。 */
  platformNode?: string;
  /** 作业有效期（进作业头与 plan_hash）。 */
  jobNotBefore: string;
  jobNotAfter: string;
  /**
   * 节点标识归一：数据源句柄写的是参与方 id（`ds://hospA/...`），而能力通告与 `at`
   * 用的是 URN。两边对不上会让「数据就近」形同虚设，所以编译前统一归一
   * （缺省按 `SPACE_ID` 把裸 id 补成 URN）。
   */
  nodeAlias?: (raw: string) => string;
}

@Injectable()
export class MdopJobsService {
  private readonly logger = new Logger(MdopJobsService.name);

  constructor(
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(MdopStageEntity, "controlplane")
    private readonly stages: Repository<MdopStageEntity>,
    @InjectRepository(MdopFragmentEntity, "controlplane")
    private readonly fragments: Repository<MdopFragmentEntity>,
    private readonly operators: MdopOperatorRegistryService,
    private readonly contracts: MdopContractService,
    /**
     * 证明登记（任务 5.2）：C2 阶段只能落在**证明有效**的可信空间节点上。
     * 可选注入——未接入时 C2 一律 fail-closed（测试与未配置部署都不会静默放行）。
     */
    @Optional() private readonly attestations?: MdopAttestationService,
  ) {}

  /**
   * 提交逻辑计划（任务 7.3）：结构、用途、申请方、合约、阶段与算子引用逐项校验；
   * **逻辑计划不得携带可执行代码**（解析器强制）。
   */
  async submit(input: SubmitJobInput): Promise<MdopJobEntity> {
    let plan: LogicalPlan;
    try {
      plan = parseLogicalPlan({
        job: {
          purpose: input.purpose,
          applicant: input.applicant,
          contracts: input.contracts,
          ...(input.ethics_ref !== undefined
            ? { ethics_ref: input.ethics_ref }
            : {}),
          ...(input.dp_budget !== undefined
            ? { dp_budget: input.dp_budget }
            : {}),
          ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
          ...(input.contractBundle
            ? {
                contract_bundle: {
                  id: input.contractBundle.id,
                  version: input.contractBundle.version,
                },
              }
            : {}),
          ...(input.contractBindings
            ? {
                contract_bindings: input.contractBindings.map((binding) => ({
                  contract_id: binding.contractId,
                  participant_id: binding.participantId,
                  data_product_id: binding.dataProductId,
                  role: binding.role,
                  stages: binding.stages,
                })),
              }
            : {}),
        },
        stages: input.stages,
      });
    } catch (err) {
      throw new BadRequestException(`逻辑计划非法：${(err as Error).message}`);
    }
    if (!plan.job.purpose?.trim())
      throw new BadRequestException("逻辑计划缺少用途编码");
    if (plan.stages.length === 0)
      throw new BadRequestException("逻辑计划没有任何阶段");
    // 合约是**执行前提**，不是可选元数据：连接器的 PEP 按合约约束数据使用与出域条件，
    // 0 份合约等于「没有任何约束可执行」。此前只在模板层（各模板各自 require contracts）拦住，
    // 通用入口 `POST /mdop/jobs` 会放行 —— 1.5 用例（缺合约必须 fail-closed）把它暴露出来。
    if (!plan.job.contracts?.length)
      throw new BadRequestException(
        "逻辑计划至少需要一份数字合约（数据使用与出域条件由合约约束，0 份合约无可执行约束）",
      );

    // 阶段 id 在**作业内必须唯一**（批次 1A / design D3：轮次 = 作业内的 stage 序列，
    // 各轮以**带轮次区分的 stage id** 表达）。
    // 阶段行的主键是 `jobId#stageId`（见 compile 里 stage 行的 id 构造），
    // 重名阶段在落库时会**静默合并**——那等于悄悄丢掉一轮、或让「样本量加权」少算一方，
    // 而且单据/凭证里两轮的哈希也会互相顶替。这里 fail-loud，不留到编译期。
    const seenStageIds = new Set<string>();
    for (const stage of plan.stages) {
      if (seenStageIds.has(stage.id))
        throw new BadRequestException(
          `逻辑计划存在重复的阶段 id：${stage.id}` +
            "（多轮请用带轮次的 id，如 " +
            stage.id +
            "_r2；阶段主键是 jobId#stageId，重名会被静默合并）",
        );
      seenStageIds.add(stage.id);
    }
    assertContractBindings(plan);

    // 阶段引用的算子必须已在注册中心（未登记 → 立即拒，不留到编译）
    for (const stage of plan.stages) {
      const ref = parseOperatorRefSafe(stage.op);
      if (!ref)
        throw new BadRequestException(
          `阶段 ${stage.id} 的算子引用非法：${stage.op}`,
        );
      const manifest = await this.operators.find(ref);
      if (!manifest)
        throw new BadRequestException(
          `阶段 ${stage.id} 引用了未注册的算子 ${stage.op}`,
        );
    }

    // 合约必须逐一存在且具备 MDOP 资格（无持有方签名 → E_CONTRACT_UNSIGNED）
    for (const contractId of plan.job.contracts) {
      await this.contracts.assertUsableForJob(contractId, plan.job.purpose);
    }

    const id = `job-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const row = this.jobs.create({
      id,
      purpose: plan.job.purpose,
      applicant: plan.job.applicant,
      contracts: plan.job.contracts,
      ethicsRef: plan.job.ethics_ref ?? null,
      dpBudget: plan.job.dp_budget ?? null,
      deadline: plan.job.deadline ?? null,
      logicalPlan: plan as unknown as Record<string, unknown>,
      ...(input.contractBundle
        ? {
            contractBundleId: input.contractBundle.id,
            contractBundleVersion: input.contractBundle.version,
            contractBundle: input.contractBundle,
          }
        : {}),
      ...(input.contractBindings
        ? {
            contractBindings: input.contractBindings,
          }
        : {}),
      status: "SUBMITTED",
      updatedAt: new Date(),
    });
    await this.jobs.save(row);
    return row;
  }

  /**
   * 编译（任务 7.4）：放置 → 标签/能力/合约校验 → 切分片段 → 片段哈希与 plan_hash。
   * 任一失败：作业进入 `REJECTED` 并记录原因（fail-closed）。
   */
  async compile(
    input: CompileInput,
  ): Promise<{ job: MdopJobEntity; fragments: Fragment[]; planHash: string }> {
    const job = await this.jobs.findOne({ where: { id: input.jobId } });
    if (!job) throw new NotFoundException("作业不存在");
    const platformNode = input.platformNode ?? PLATFORM_NODE;

    try {
      assertJobTransition(job.status as never, "COMPILED");
      const plan = job.logicalPlan as unknown as LogicalPlan;
      assertContractBindings(plan);

      // 合约再次校验（编译期是权威点）
      for (const contractId of job.contracts) {
        await this.contracts.assertUsableForJob(contractId, job.purpose);
      }

      const physical = await this.buildPhysicalPlan(
        plan,
        input.capabilities,
        platformNode,
        await this.publicationConditions(job.contracts),
        await this.attestationConditions(job.contracts),
        input.nodeAlias ?? defaultNodeAlias(),
      );
      const fragments = splitFragments(physical, platformNode);
      const fragmentHashes: Record<string, string> = {};
      for (const fragment of fragments) {
        fragmentHashes[fragment.node] = fragmentHash(fragment);
      }
      const header: PlanHashJobHeader = {
        job_id: job.id,
        purpose: job.purpose,
        applicant: job.applicant,
        contracts: job.contracts,
        ethics_ref: job.ethicsRef ?? undefined,
        dp_budget: job.dpBudget ?? undefined,
        not_before: input.jobNotBefore,
        not_after: input.jobNotAfter,
        ...(plan.job.contract_bundle
          ? { contract_bundle: plan.job.contract_bundle }
          : {}),
        ...(plan.job.contract_bindings
          ? { contract_bindings: plan.job.contract_bindings }
          : {}),
      };
      const planHash = computePlanHash({
        job: header,
        fragments: fragmentHashes,
      });

      await this.persistPlan(job.id, physical, fragments, fragmentHashes);
      await this.jobs.update(
        { id: job.id },
        {
          status: "COMPILED",
          planHash,
          jobHeader: header as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      );
      return {
        job: (await this.jobs.findOne({ where: { id: job.id } }))!,
        fragments,
        planHash,
      };
    } catch (err) {
      const reason =
        err instanceof MdopError
          ? `${err.code}: ${err.message}`
          : `E_RUNTIME: ${(err as Error).message}`;
      await this.jobs.update(
        { id: job.id },
        { status: "REJECTED", rejectReason: reason, updatedAt: new Date() },
      );
      this.logger.warn(`作业 ${job.id} 编译失败：${reason}`);
      throw err;
    }
  }

  /** 放置 + 标签/能力校验：按「数据就近、能力满足」推导每个阶段的落点与等级。 */
  private async buildPhysicalPlan(
    plan: LogicalPlan,
    capabilities: Map<string, NodeCapability>,
    platformNode: string,
    publication: PublicationConditions,
    attestation: AttestationPolicy | undefined,
    nodeAlias: (raw: string) => string,
  ): Promise<PhysicalStage[]> {
    const stageById = new Map(plan.stages.map((s) => [s.id, s]));
    const resolved = new Map<string, PhysicalStage>();
    const order = topoOrder(
      plan.stages.map((s) => ({
        id: s.id,
        inputs: s.inputs
          .map((i) => i.from)
          .filter((from) => stageById.has(from)),
      })),
    );

    for (const stageId of order) {
      const stage = stageById.get(stageId)!;
      const ref = parseOperatorRefSafe(stage.op);
      if (!ref)
        throw new MdopError(
          "E_CAPABILITY_MISMATCH",
          {},
          `算子引用非法：${stage.op}`,
        );
      const registered = await this.operators.find(ref);
      if (!registered)
        throw new MdopError(
          "E_CAPABILITY_MISMATCH",
          {},
          `算子未注册：${stage.op}`,
        );
      const manifest = parseOperatorManifest(registered.manifest);

      // 输入等级：数据源 C0；上游阶段取其输出等级
      const inputLabels: FlowLabel[] = [];
      const upstreamNodes = new Set<string>();
      for (const input of stage.inputs) {
        const datasetNode = datasetUriNode(input.from);
        if (datasetNode) {
          inputLabels.push("C0");
          upstreamNodes.add(nodeAlias(datasetNode));
          continue;
        }
        const upstream = resolved.get(input.from);
        if (!upstream)
          throw new MdopError(
            "E_LABEL_VIOLATION",
            { edge: `${input.from}->${stage.id}` },
            "上游阶段不存在或未排序",
          );
        inputLabels.push(upstream.output_label);
        upstreamNodes.add(upstream.node);
      }

      const aggregate =
        manifest.kind === "secure_aggregate"
          ? compileAggregateStage({
              stageId: stage.id,
              manifest,
              inputLabels,
              upstreamNodes: [...upstreamNodes],
              platformNode,
              params: stage.params,
            })
          : undefined;

      const node = aggregate
        ? aggregate.primaryNode
        : placeStage(
            { id: stage.id, ...(stage.at ? { at: nodeAlias(stage.at) } : {}) },
            upstreamNodes,
            platformNode,
          );

      // 数据就近：以 ds:// 为输入却放到别处 → 编译期拒，并指出越界的边
      if (!aggregate) {
        for (const input of stage.inputs) {
          const datasetNode = datasetUriNode(input.from);
          if (datasetNode && nodeAlias(datasetNode) !== node)
            throw new MdopError(
              "E_LABEL_VIOLATION",
              { edge: `${nodeAlias(datasetNode)}->${stage.id}`, node },
              "阶段被放在数据所在节点之外（跨节点读原始数据）",
            );
        }
      }

      const outputLabel = aggregate
        ? aggregate.outputLabel
        : deriveOutputLabel(manifest, inputLabels);

      // C2 阶段只能落在**证明有效**的可信空间节点上（任务 5.2）。这里判的是「谁接收 C2 信封」：
      // 合约必须声明证明策略，且目标节点的证明登记必须有效、与策略相符；缺任何一项都 fail-closed，
      // 不发 StageDispatch、不进入执行。
      if (inputLabels.includes("C2"))
        await this.assertC2Target(node, attestation);

      // 降密算子：参数 MUST NOT 弱于合约发布条件（minCell 不得更小）。
      // 阶段没显式声明 minCell 时，**取合约的发布条件**（这正是「读合约 minCell」的语义，
      // 结果与合约相等而非更弱）；显式声明则必须 >= 合约值。
      const stageParams = aggregate ? aggregate.params : { ...stage.params };
      if (manifest.category === "declassify") {
        if (
          stageParams.minCell === undefined &&
          publication.minCell !== undefined
        )
          stageParams.minCell = publication.minCell;
        assertDeclassifyNotWeaker(stageParams, publication);
      }
      const physical: PhysicalStage = {
        id: stage.id,
        node,
        op: stage.op,
        op_digest: registered.digest,
        params: stageParams,
        inputs: stage.inputs,
        input_labels: inputLabels,
        output_label: outputLabel,
        output_schema: manifest.outputs[0]?.schema ?? "mdop.unknown/1.0",
        // JCS 拒绝 undefined：可选字段缺省时**不写这个键**，而不是写 undefined
        ...(stage.ttl_hours !== undefined
          ? { ttl_hours: stage.ttl_hours }
          : {}),
      };

      // 能力匹配（运行时 / system 算子 / kind 是否本期启用）
      const placedOn = aggregate ? aggregate.parties : [node];
      for (const placed of placedOn)
        assertNodeCanRun(manifest, capabilities.get(placed), ref);
      resolved.set(stage.id, physical);
    }

    // 建边并逐条校验（C0 不出节点 / C1 协议 / C2 TEE / C3 接收方）
    const edges = buildEdges(plan, resolved);
    const recipients = await this.contractRecipients(plan, capabilities);
    for (const edge of edges)
      validateEdge(edge, {
        contract_recipients: recipients,
        capabilities,
        // C2 边要拿合约的证明策略判（缺省即拒）——不把策略传进来，等于让 C2 绕过策略校验
        ...(attestation ? { attestation_policy: attestation } : {}),
      });
    return [...resolved.values()];
  }

  /** 相关合约的接收方并集（C3 边与平台合并阶段的目标校验用）。 */
  private async contractRecipients(
    plan: LogicalPlan,
    _capabilities: Map<string, NodeCapability>,
  ): Promise<string[]> {
    const parties = new Set<string>();
    for (const contractId of plan.job.contracts) {
      const described = await this.contracts.describeForNode(contractId);
      for (const party of described.recipients) parties.add(party);
    }
    return [...parties];
  }

  /** 相关合约的发布条件并集（取最严：minCell 取最大）。 */
  private async publicationConditions(
    contractIds: string[],
  ): Promise<PublicationConditions> {
    let minCell: number | undefined;
    for (const contractId of contractIds) {
      const described = await this.contracts.describeForNode(contractId);
      const value = described.contract.publication?.minCell;
      if (
        typeof value === "number" &&
        (minCell === undefined || value > minCell)
      )
        minCell = value;
    }
    return minCell === undefined ? {} : { minCell };
  }

  /**
   * 相关合约的证明策略（多合约取**更严的一侧**，见 `mergeAttestationPolicies`）。
   * 一份都没声明即返回 `undefined` —— 该作业不得出现 C2 边。
   */
  private async attestationConditions(
    contractIds: string[],
  ): Promise<AttestationPolicy | undefined> {
    let merged: AttestationPolicy | undefined;
    for (const contractId of contractIds) {
      const described = await this.contracts.describeForNode(contractId);
      const policy = described.contract.attestation_policy;
      if (!policy) continue;
      merged = merged ? mergeAttestationPolicies(merged, policy) : policy;
    }
    return merged;
  }

  /** C2 目标判定：合约须声明 C2 资格，且该节点的证明登记有效并与策略相符。 */
  private async assertC2Target(
    node: string,
    policy: AttestationPolicy | undefined,
  ): Promise<void> {
    if (!policy)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node },
        "合约未声明证明策略，不得把 C2 制品流向任何节点",
      );
    if (!this.attestations)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node },
        "平台未接入证明登记服务，不能放置 C2 阶段",
      );
    await this.attestations.assertUsableForC2(node, policy);
  }

  private async persistPlan(
    jobId: string,
    physical: PhysicalStage[],
    fragments: Fragment[],
    fragmentHashes: Record<string, string>,
  ): Promise<void> {
    for (const stage of physical) {
      await this.stages.save(
        this.stages.create({
          id: `${jobId}#${stage.id}`,
          jobId,
          stageId: stage.id,
          node: stage.node,
          opRef: stage.op,
          opDigest: stage.op_digest,
          params: stage.params,
          inputs: stage.inputs,
          outputLabel: stage.output_label,
          outputSchema: stage.output_schema,
          ttlHours: stage.ttl_hours ?? null,
          status: "PENDING",
          attempt: 0,
          updatedAt: new Date(),
        }),
      );
    }
    for (const fragment of fragments) {
      await this.fragments.save(
        this.fragments.create({
          id: `${jobId}#${fragment.node}`,
          jobId,
          node: fragment.node,
          fragment: fragment as unknown as Record<string, unknown>,
          fragmentHash: fragmentHashes[fragment.node],
        }),
      );
    }
  }

  async get(jobId: string): Promise<{
    job: MdopJobEntity;
    stages: MdopStageEntity[];
    fragments: Array<{ node: string; fragmentHash: string }>;
  }> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException("作业不存在");
    return {
      job,
      stages: await this.stages.find({
        where: { jobId },
        order: { stageId: "ASC" },
      }),
      fragments: (await this.fragments.find({ where: { jobId } })).map((f) => ({
        node: f.node,
        fragmentHash: f.fragmentHash,
      })),
    };
  }

  /** 最近的 MDOP 作业（控制台列表用；按创建时间倒序）。 */
  async list(limit = 50): Promise<MdopJobEntity[]> {
    const rows = await this.jobs.find({ order: { createdAt: "DESC" } });
    return rows.slice(0, limit);
  }
}

/**
 * Bundle 绑定复核：成员合约必须显式在 contracts[]，且每个绑定阶段真实存在。
 * 这条检查与节点侧 `assertBundleCoversNode` 共用同一语义，防止平台只用 contracts[0]。
 */
function assertContractBindings(plan: LogicalPlan): void {
  const bindings = plan.job.contract_bindings;
  if (!bindings || bindings.length === 0) return;
  const contracts = new Set(plan.job.contracts);
  const stages = new Set(plan.stages.map((stage) => stage.id));
  const boundContracts = new Set<string>();
  for (const binding of bindings) {
    if (!contracts.has(binding.contract_id))
      throw new BadRequestException(
        `ContractBundle 绑定引用了未列入 contracts 的成员合约 ${binding.contract_id}`,
      );
    if (boundContracts.has(binding.contract_id))
      throw new BadRequestException(
        `成员合约 ${binding.contract_id} 被重复绑定到多个数据源`,
      );
    boundContracts.add(binding.contract_id);
    for (const stageId of binding.stages) {
      if (!stages.has(stageId))
        throw new BadRequestException(
          `ContractBundle 绑定引用了不存在的阶段 ${stageId}`,
        );
    }
  }
  if (
    plan.job.contract_bundle &&
    boundContracts.size !== plan.job.contracts.length
  ) {
    const unbound = plan.job.contracts.filter(
      (contract) => !boundContracts.has(contract),
    );
    if (unbound.length > 0)
      throw new BadRequestException(
        `ContractBundle 还有未绑定数据源的成员合约：${unbound.join(", ")}`,
      );
  }
}

/** 阶段落点：数据就近 > 单节点跟随 > 平台合并（多节点依赖）。 */
export function placeStage(
  stage: { id: string; at?: string },
  upstreamNodes: Set<string>,
  platformNode: string,
): string {
  if (stage.at) return stage.at;
  if (upstreamNodes.size === 1) return [...upstreamNodes][0];
  if (upstreamNodes.size === 0) return platformNode; // 无输入（如平台侧模板）
  return platformNode; // 多节点依赖：只能放平台合并
}

/** 由逻辑计划 + 已解析的物理阶段构造全部边（含跨节点与同节点边）。 */
export function buildEdges(
  plan: LogicalPlan,
  resolved: Map<string, PhysicalStage>,
): PlanEdge[] {
  const edges: PlanEdge[] = [];
  for (const stage of plan.stages) {
    const target = resolved.get(stage.id);
    if (!target) continue;
    for (const input of stage.inputs) {
      const upstream = resolved.get(input.from);
      if (!upstream) continue;
      const aggregate = target.params.aggregate as
        { parties?: string[] } | undefined;
      edges.push({
        from_stage: upstream.id,
        to_stage: target.id,
        label: upstream.output_label,
        from_node: upstream.node,
        // 聚合贡献留在产出它的节点上，不把 C1 画成跨到平台或其他参与方的边
        to_node: aggregate?.parties ? upstream.node : target.node,
      });
    }
  }
  return edges;
}

/** 片段切分：按节点分组，片段里带**全部边界边**。 */
export function splitFragments(
  stages: PhysicalStage[],
  _platformNode: string,
): Fragment[] {
  const byNode = new Map<string, PhysicalStage[]>();
  for (const stage of stages) {
    const copies = expandAggregateStage(stage, stages);
    const placed = copies ?? [stage];
    for (const copy of placed) {
      const list = byNode.get(copy.node) ?? [];
      list.push(copy);
      byNode.set(copy.node, list);
    }
  }
  const allEdges: PlanEdge[] = [];
  const stageNode = new Map(stages.map((s) => [s.id, s.node]));
  for (const stage of stages) {
    for (const input of stage.inputs) {
      const fromNode = stageNode.get(input.from);
      if (!fromNode) continue;
      const upstream = stages.find((s) => s.id === input.from)!;
      const aggregate = stage.params.aggregate as
        { parties?: string[] } | undefined;
      allEdges.push({
        from_stage: input.from,
        to_stage: stage.id,
        label: upstream.output_label,
        from_node: fromNode,
        to_node: aggregate?.parties ? fromNode : stage.node,
      });
    }
  }
  return [...byNode.entries()].map(([node, nodeStages]) => ({
    node,
    stages: nodeStages,
    // 本方片段包含与它相关的全部边界边（对端在别的节点上也要能独立重算）
    edges: allEdges.filter((e) => e.from_node === node || e.to_node === node),
  }));
}

/** 拓扑序（依赖在前）。环或缺失依赖由上层校验报错。 */
export function topoOrder(
  nodes: Array<{ id: string; inputs: string[] }>,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string, stack: Set<string>): void => {
    if (visited.has(id)) return;
    if (stack.has(id))
      throw new MdopError("E_LABEL_VIOLATION", { edge: id }, "计划存在环");
    stack.add(id);
    for (const dep of byId.get(id)?.inputs ?? [])
      if (byId.has(dep)) visit(dep, stack);
    stack.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const node of nodes) visit(node.id, new Set());
  return ordered;
}

function parseOperatorRefSafe(op: string) {
  try {
    return parseOperatorRef(op);
  } catch {
    return undefined;
  }
}

/** 作业级标签汇总（编译后用于校验「平台只见 C3」）。 */
export function jobOutputLabels(fragments: Fragment[]): FlowLabel[] {
  return fragments.flatMap((f) => f.stages.map((s) => s.output_label));
}

export { isCrossNode, joinAll, operatorRefString };

/**
 * 缺省的节点归一：`urn:` 开头原样返回；裸参与方 id 补成
 * `urn:tds:<SPACE_ID>:participant:<id>`（与能力通告、合约接收方同一套标识）。
 */
export function defaultNodeAlias(space = currentSpaceId()) {
  return (raw: string): string =>
    raw.startsWith("urn:") ? raw : participantUrn(space, raw);
}
