import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { BadRequestException, Body, ConflictException, Controller, Get, Logger, Param, Post, UseFilters, UseGuards } from "@nestjs/common";
import { MdopErrorFilter } from "./mdop-error.filter";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CpConnectorRegistry } from "@medtrust/database";
import { participantUrn, type NodeCapability } from "@medtrust/mdop";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  MdopJobsService,
  PLATFORM_NODE,
  type SubmitJobInput,
} from "./mdop-jobs.service";
import { SYSTEM_OPERATORS } from "./operator-registry.service";
import { L15_TEMPLATE_ID } from "./plan-templates";
import {
  ORCHESTRATION_OP_TO_KEY,
  OrchestrationChannelError,
  assertEntryAllowed,
  keyForTemplate,
  resolveEntryKey,
} from "../runtime/orchestration/orchestration.channels";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopWitnessStatusService } from "./mdop-witness-status.service";
import { MdopAttestationService } from "./mdop-attestation.service";
import {
  PAIRED_COHORT_TEMPLATE_ID,
  VACCINE_SCRI_TEMPLATE_ID,
  VE_TND_TEMPLATE_ID,
  DEDUP_INCIDENCE_TEMPLATE_ID,
  L4_TEMPLATE_ID,
  buildL15Plan,
  buildL4Plan,
  buildVaccineScriPlan,
  buildVeTndPlan,
  buildDedupIncidencePlan,
  type VaccineScriTemplateInput,
  type VeTndTemplateInput,
  type DedupIncidenceTemplateInput,
  type L15TemplateInput,
  type L4TemplateInput,
} from "./plan-templates";
import { MdopError, PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";

import { buildPlanWithInputMapping } from "./template-registry";

/**
 * MDOP 作业入口（任务 7.3/7.4）。
 *
 * 提交逻辑计划 → 编译（放置/标签/能力/合约 + 片段切分 + plan_hash）。
 * 编译所需的「各节点能力」取自连接器心跳里的能力通告（任务 6.5）。
 */
@ApiTags("mdop")
@ApiBearerAuth()
@Controller("mdop")
@UseGuards(JwtAuthGuard)
@UseFilters(MdopErrorFilter)
export class MdopController {
  private readonly logger = new Logger(MdopController.name);

  constructor(
    private readonly jobs: MdopJobsService,
    /** 编译成功后自动发出片段要约（§7.5：平台 SHALL 向每个相关节点发 PlanFragmentOffer）。 */
    private readonly tickets: MdopTicketService,
    private readonly scheduler: MdopSchedulerService,
    /** 终态销毁编排（§7.8）：补发缺失的 PurgeOrder，收齐回执才进 PURGED。 */
    private readonly purge: MdopPurgeService,
    /** 回执链头锚定与连续性核验（§10.3）。 */
    private readonly receiptChain: MdopReceiptChainService,
    /** 平台侧合并结果（C3 交付物）：结果页展示用（任务 7.3）。 */
    private readonly merge: MdopMergeService,
    /** 会话见证 + 持有方核验结论（任务 7.4）：控制台要能看见「谁在什么代码下处理过、验没验」。 */
    private readonly witnessStatus: MdopWitnessStatusService,
    /** 证明登记（任务 5.1）：校验方推送**作业之前**的证明背书（D-TEE-6）。 */
    private readonly attestations: MdopAttestationService,
    @InjectRepository(CpConnectorRegistry, "controlplane")
    private readonly registry: Repository<CpConnectorRegistry>,
  ) {}

  /**
   * D-MDOP-7：MDOP 入口同样由台账把关——模板必须能映射回台账 key，且该 key 的授权通道是 mdop。
   * 未到切换日只记录；某个类型被切到 mdop 后，它的旧模板/旧入口会在对应的那一侧被拒。
   */
  private assertEntryKeyAllowed(key: string): void {
    try {
      const decision = assertEntryAllowed(key, "mdop");
      if (!decision.enforced) {
        this.logger.warn(
          "[orchestration] " +
            key +
            " 请求 MDOP 入口，台账授权通道为 " +
            decision.channel +
            "（未到切换日，迁移期放行）",
        );
      }
    } catch (e) {
      if (e instanceof OrchestrationChannelError)
        throw new ConflictException(e.message);
      throw e;
    }
  }

  /** 模板入口：先映射回台账 key，再走同一套判定。 */
  private assertTemplateAllowed(templateId: string): void {
    this.assertEntryKeyAllowed(keyForTemplate(templateId));
  }

  @Post("jobs")
  async submit(@Body() body: SubmitJobInput) {
    // tasks 2.7（D-MDOP-7）：通用入口接受任意计划，而计划里没有"分析类型"字段——台账对这条入口本来
    // 是失效的。这里要求能归属：显式 analysisKey，或计划里带一个已登记的 merge.* 阶段；归属不出来即拒
    // （不猜、不默认成某个通道）。
    const key = resolveEntryKey({
      analysisKey: body.analysisKey,
      ops: (body.stages ?? []).map((s) => s.op),
    });
    if (!key) {
      throw new ConflictException(
        "[E_CHANNEL_UNKNOWN] 通用作业无法归属到台账里的分析类型：请显式给 analysisKey，" +
          "或让计划带上一个已登记的 merge.* 阶段（当前已登记：" +
          Object.keys(ORCHESTRATION_OP_TO_KEY).join(" / ") +
          "）",
      );
    }
    this.assertEntryKeyAllowed(key);
    const job = await this.jobs.submit(body);
    return { jobId: job.id, status: job.status };
  }

  /**
   * **证明背书登记**（任务 5.1 / D-TEE-6，部署侧接口）。
   *
   * 编译期放置 C2 要求目标节点有一份**未过期**的证明登记；会话见证要到执行期才有，因此
   * 作业之前的这一份由**部署白名单内的校验方**（KMS / 证明服务）签名推送。平台用**部署配置的
   * KMS 公钥**验签（`MDOP_KMS_PUBKEY`，MUST NOT 取自请求体），再走既有登记判定。
   * 本接口与其它 mdop 管理接口同守卫（operator JWT）——它属于**部署动作**，不是参与方消息。
   */
  @Post("attestations")
  @ApiOperation({
    summary: "校验方推送节点证明背书（作业之前的登记；平台不自己验 quote）",
  })
  async registerAttestation(@Body() body: unknown) {
    const row = await this.attestations.acceptEndorsement(body);
    return {
      registered: true,
      node: row.node,
      kind: row.kind,
      expiresAt: row.expiresAt,
      verifiedBy: row.verifiedBy,
    };
  }

  /**
   * L1.5 失衡检测模板提交（任务 9.1）：网页向导只填「药物/队列/医院/合约」，
   * 由模板展开成逻辑计划（含数据就近的数据源句柄），再走同一套编译。
   */
  @Post("jobs/l15")
  async submitL15(@Body() body: L15TemplateInput) {
    this.assertTemplateAllowed(L15_TEMPLATE_ID);
    const plan = buildL15Plan(body);
    const job = await this.jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      ...(plan.ethics_ref ? { ethics_ref: plan.ethics_ref } : {}),
      not_before: plan.not_before,
      not_after: plan.not_after,
    });
    return {
      jobId: job.id,
      status: job.status,
      template: L15_TEMPLATE_ID,
      stages: plan.stages.length,
    };
  }

  /**
   * L4 联邦预测模板提交（批次 1A / mdop-fl-migration）：
   * 各院 `source.dataset` → `rws.l4-train` → `declassify.small_cell`，平台 `merge.fedavg`。
   * 本期只支持 `logistic_regression + fedavg`（无 sidecar、纯院内，便于逐字段对拍）。
   */
  @Post("jobs/fl-prediction")
  async submitFlPrediction(@Body() body: L4TemplateInput) {
    this.assertTemplateAllowed(L4_TEMPLATE_ID);
    const plan = buildL4Plan(body);
    const job = await this.jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      ...(plan.ethics_ref ? { ethics_ref: plan.ethics_ref } : {}),
      not_before: plan.not_before,
      not_after: plan.not_after,
    });
    return {
      jobId: job.id,
      status: job.status,
      template: L4_TEMPLATE_ID,
      stages: plan.stages.length,
    };
  }

  /**
   * 跨院队列交集（C2 首个场景，D-TEE-4 首选 A）：申请方只需给「参与各院 + 数据切片 +
   * 选定的可信空间节点 + 分层口径」，模板展开成阶段链。
   *
   * 与 L1.5 那个模板的区别：这条作业里有 **C2 边**（各院封存 → 节点），
   * 因此编译期会走 `assertC2Target`（合约证明策略 + 该节点的证明登记），
   * 缺任何一项都在**编译期**拒绝——不会出现「作业跑起来才发现节点没证明」。
   */
  @Post("jobs/paired-cohort")
  async submitPairedCohort(@Body() body: unknown) {
    this.assertTemplateAllowed(PAIRED_COHORT_TEMPLATE_ID);
    // 入参校验在包内（PlanInputError），HTTP 400 的映射在 template-registry（design D2）。
    const plan = buildPlanWithInputMapping(
      PAIRED_COHORT_TEMPLATE_ID,
      body,
      currentSpaceId(),
    );
    const job = await this.jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      ...(plan.ethics_ref ? { ethics_ref: plan.ethics_ref } : {}),
      not_before: plan.not_before,
      not_after: plan.not_after,
    });
    return {
      jobId: job.id,
      status: job.status,
      template: PAIRED_COHORT_TEMPLATE_ID,
      stages: plan.stages.length,
    };
  }

  /**
   * 疫苗接种后不良事件主动监测（SCRI）模板提交：疾控的接种记录与医院的就诊结局
   * 须在可信空间节点内按人对齐、按日期差计数——协同计算做不到（需要逐人时间线）。
   */
  @Post("jobs/vaccine-scri")
  async submitVaccineScri(@Body() body: VaccineScriTemplateInput) {
    this.assertTemplateAllowed(VACCINE_SCRI_TEMPLATE_ID);
    const plan = buildVaccineScriPlan(body);
    const job = await this.jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      ...(plan.ethics_ref ? { ethics_ref: plan.ethics_ref } : {}),
      not_before: plan.not_before,
      not_after: plan.not_after,
    });
    return {
      jobId: job.id,
      status: job.status,
      template: VACCINE_SCRI_TEMPLATE_ID,
      stages: plan.stages.length,
    };
  }

  /**
   * 疫苗真实世界保护效果（检测阴性设计 TND）模板提交：疾控的接种记录与医院的检测记录
   * 须在节点内按人对齐，才能判定「检测日 − 末剂接种日 ≥ 免疫建立期」并做分层 2×2 计数。
   */
  @Post("jobs/ve-tnd")
  async submitVeTnd(@Body() body: VeTndTemplateInput) {
    this.assertTemplateAllowed(VE_TND_TEMPLATE_ID);
    const plan = buildVeTndPlan(body);
    const job = await this.jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      ...(plan.ethics_ref ? { ethics_ref: plan.ethics_ref } : {}),
      not_before: plan.not_before,
      not_after: plan.not_after,
    });
    return {
      jobId: job.id,
      status: job.status,
      template: VE_TND_TEMPLATE_ID,
      stages: plan.stages.length,
    };
  }

  /**
   * 跨院去重的发病率与罕见病登记模板提交：多院队列须在节点内按人去重
   * （人头并集 / 观察期并集 / 事件去重 / 罕见病按人计数），只出过闸聚合。
   */
  @Post("jobs/dedup-incidence")
  async submitDedupIncidence(@Body() body: DedupIncidenceTemplateInput) {
    this.assertTemplateAllowed(DEDUP_INCIDENCE_TEMPLATE_ID);
    const plan = buildDedupIncidencePlan(body);
    const job = await this.jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      ...(plan.ethics_ref ? { ethics_ref: plan.ethics_ref } : {}),
      not_before: plan.not_before,
      not_after: plan.not_after,
    });
    return {
      jobId: job.id,
      status: job.status,
      template: DEDUP_INCIDENCE_TEMPLATE_ID,
      stages: plan.stages.length,
    };
  }

  @Post("jobs/:id/compile")
  async compile(@Param("id") id: string) {
    const { job: current } = await this.jobs.get(id);
    const jobNotBefore = jobNotBeforeOf(current);
    const jobNotAfter =
      current.deadline ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
    let planHash = current.planHash ?? "";
    let fragments: Array<{ node: string; stages: number; edges: number }> = [];
    if (current.status === "SUBMITTED") {
      const capabilities = await this.capabilities();
      const compiled = await this.jobs.compile({
        jobId: id,
        capabilities,
        jobNotBefore,
        jobNotAfter,
      });
      planHash = compiled.planHash;
      fragments = compiled.fragments.map((f) => ({
        node: f.node,
        stages: f.stages.length,
        edges: f.edges.length,
      }));
    } else if (
      !["COMPILED", "NEGOTIATING", "TICKETED", "RUNNING"].includes(
        current.status,
      )
    ) {
      throw new MdopError(
        "E_RUNTIME",
        {},
        `作业状态 ${current.status} 不允许编译`,
      );
    }

    // 编译成功后**自动发起凭证要约**：否则作业永远停在 COMPILED，
    // 「平台向每个相关节点发 PlanFragmentOffer」这一步没有触发点。
    const negotiation = await this.openNegotiation(
      id,
      jobNotBefore,
      jobNotAfter,
    );
    return {
      jobId: id,
      status: negotiation.status,
      planHash,
      fragments,
      ticketId: negotiation.ticketId,
      offeredNodes: negotiation.offeredNodes,
    };
  }

  /**
   * 打开（或续接）片段复核：只在 `COMPILED` 时新发要约——重复调用不会二次要约
   * （发件箱按幂等键去重，且 `COMPILED → NEGOTIATING` 迁移只允许一次）。
   */
  private async openNegotiation(
    jobId: string,
    notBefore: string,
    notAfter: string,
  ): Promise<{ status: string; ticketId?: string; offeredNodes?: string[] }> {
    const { job } = await this.jobs.get(jobId);
    if (job.status !== "COMPILED") {
      return { status: job.status };
    }
    const offered = await this.tickets.offerTickets({
      jobId,
      notBefore,
      notAfter,
    });
    return {
      status: "NEGOTIATING",
      ticketId: offered.ticketId,
      offeredNodes: offered.offeredNodes,
    };
  }

  /** 运维杠杆：重新发起片段要约（作业须处于 `COMPILED`）。 */
  @Post("jobs/:id/offer-tickets")
  async offerTickets(@Param("id") id: string) {
    const { job } = await this.jobs.get(id);
    if (job.status !== "COMPILED")
      throw new MdopError(
        "E_RUNTIME",
        {},
        `作业状态 ${job.status} 不允许发起凭证要约`,
      );
    const header = (job.jobHeader ?? {}) as {
      not_before?: string;
      not_after?: string;
    };
    const out = await this.tickets.offerTickets({
      jobId: id,
      notBefore: header.not_before ?? jobNotBeforeOf(job),
      notAfter:
        header.not_after ??
        job.deadline ??
        new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    return { jobId: id, status: "NEGOTIATING", ...out };
  }

  /** 运维杠杆：把已就绪的阶段下发（作业须已取得凭证）。 */
  @Post("jobs/:id/dispatch")
  async dispatch(@Param("id") id: string) {
    const dispatched = await this.scheduler.dispatchReadyStages(id);
    return { jobId: id, dispatched };
  }

  /**
   * 运维杠杆：补发缺失的 `PurgeOrder`（终态作业没收齐回执时用）。
   * 幂等：已有回执的节点不再发。收齐后作业进 `PURGED`。
   */
  @Post("jobs/:id/purge")
  async purgeMissing(@Param("id") id: string) {
    const { job } = await this.jobs.get(id);
    const out = await this.purge.orchestratePurge(id);
    return { jobId: id, status: job.status, ordered: out.ordered };
  }

  @Get("jobs/:id")
  async get(@Param("id") id: string) {
    const out = await this.jobs.get(id);
    // 回执链连续性 + 链头锚定状态：§11.5「核验锚定」就在这一条上核。
    const nodes = [...new Set(out.fragments.map((f) => f.node))];
    const chains = await Promise.all(
      nodes.map((node) => this.receiptChain.verifyChain(node, id)),
    );
    const ticket = await this.tickets.ticketSummary(id);
    return {
      ...out,
      chains,
      anchors: await this.receiptChain.anchorsOf(id),
      // 凭证摘要（含按节点的执行环境期望）：C2 作业在控制台上最该被看见的一行（任务 7.2）
      ticket,
      // 平台侧合并结果（C3 交付物）；未收齐投递时为 null
      result: await this.merge.mergedResult(id),
      // 会话证明与**持有方的核验结论**（任务 7.4）：三态明确——
      // `holderVerification=null` 是「还没核验」，不是「核验通过」
      // 应上报见证的只有凭证里冻结了执行环境期望的可信空间节点；持有方不出见证，
      // 把它们算进来会被显示成「尚未上报见证」
      witnessStatus: await this.witnessStatus.forJob(
        id,
        Object.keys(ticket?.attestation ?? {}),
      ),
    };
  }

  /** 运维杠杆：给该作业的各节点链头补锚（幂等；链不可达时进补偿队列，不伪造交易号）。 */
  @Post("jobs/:id/anchor")
  async anchor(@Param("id") id: string) {
    return {
      jobId: id,
      anchors: await this.receiptChain.anchorJobChainHeads(id),
    };
  }

  @Get("jobs")
  list() {
    return this.jobs.list();
  }

  /**
   * 各节点最近一次能力通告（心跳上报）。缺省给平台节点一条完整通告；
   * 未通告能力的节点**不加进 map** —— 编译时 `assertNodeCanRun` 会以
   * `E_CAPABILITY_MISMATCH` 拒绝把阶段放在它上面。
   */
  async capabilities(
    space = currentSpaceId(),
  ): Promise<Map<string, NodeCapability>> {
    const map = new Map<string, NodeCapability>();
    map.set(PLATFORM_NODE, {
      node: PLATFORM_NODE,
      runtime: ["native", "wasm"],
      system_ops: SYSTEM_OPERATORS.map((o) => `${o.id}@${o.version}`),
      whitelist_digests: [],
      tee: null,
      protocols: [],
    });
    const rows = await this.registry.find();
    for (const row of rows) {
      const mdop = (
        row.lastHeartbeat as { mdop?: Record<string, unknown> } | null
      )?.mdop;
      if (!mdop) continue;
      const node = participantUrn(space, row.participantId);
      map.set(node, {
        node,
        runtime: asStringArray(mdop.runtime),
        system_ops: asStringArray(mdop.system_ops),
        whitelist_digests: asStringArray(mdop.whitelist_digests),
        tee: (mdop.tee as { kind: string; min_tcb?: string } | null) ?? null,
        protocols: Array.isArray(mdop.protocols)
          ? (mdop.protocols as Array<{ name: string; version: string }>)
          : [],
      });
    }
    return map;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function jobNotBeforeOf(job: { createdAt?: Date | null }): string {
  return job.createdAt
    ? new Date(job.createdAt).toISOString()
    : new Date().toISOString();
}
