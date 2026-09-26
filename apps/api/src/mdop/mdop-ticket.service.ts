import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  Certificate as CertificateEntity,
  MdopFragmentEntity,
  MdopJobEntity,
  MdopOutboxEntity,
  MdopSignatureRecordEntity,
  MdopStageEntity,
  MdopTicketEntity,
} from "@medtrust/database";
import {
  MdopError,
  mergeAttestationPolicies,
  assertJobTransition,
  buildTicket,
  parseTicketCore,
  parseParticipantUrn,
  participantUrn,
  verifyHolderAcceptance,
  type ExecutionTicket,
  type AttestationExpectation,
  type AttestationPolicy,
  type TicketCore,
  type TicketSignature,
} from "@medtrust/mdop";
import { CaService } from "../runtime/participant-identity/ca.service";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopAttestationService } from "./mdop-attestation.service";

/**
 * 执行凭证服务（任务 7.5 / 协议 §7.5、规格「执行凭证与持有方否决」）。
 *
 * 流程：发片段要约（只含**本方片段** + 片段哈希表 + 凭证核心）→ 收集接受/拒绝 →
 * 任一拒绝或超时即 `REJECTED` 且**不发任何 StageDispatch** → 全部接受后平台加签 → 下发凭证。
 *
 * 数据快照不进 `plan_hash`，由各持有方把「本节点快照标识 + 凭证核心」一起签名，
 * 凭证逐签署方记录（设计 D11）。
 */

export interface OfferTicketsInput {
  jobId: string;
  notBefore: string;
  notAfter: string;
  /** 每个节点的复核时限（小时）；缺省 72。 */
  deadlineHours?: number;
}

export interface FragmentAcceptInput {
  jobId: string;
  ticketId: string;
  /** 连接器签的凭证核心（平台逐字节比对后用持有方证书公钥验签）。 */
  core: TicketCore;
  snapshot: string;
  holderSignature: { alg: string; kid: string; value: string };
  signer: string;
}

export interface FragmentRejectInput {
  jobId: string;
  ticketId: string;
  signer: string;
  code: string;
  message?: string;
}

/**
 * **消息层已认证的发送方**（URN + 证书公钥；来自信封与证书目录，MUST NOT 采信消息自述）。
 *
 * 为什么 accept / reject 两条都要它：
 *  - `accept`：签名能挡住「伪造别家的接受」，但把 `signer` 与发送方绑起来才挡得住
 *    「拿别家的接受到处投递 / 记到别家账上」；
 *  - `reject`：**协议里 reject 没有签名**（只有 signer/code/message），所以身份绑定就是**唯一**的可控点——
 *    不绑，任何已认证参与方都能替别家「拒绝」，把整个作业打成 `REJECTED` 并向各院广播 `JobAbort`。
 */
export interface AuthenticatedSender {
  urn: string;
  /**
   * 该参与方证书公钥（来自证书目录）。
   * 本服务当前只用 `urn` 做身份绑定——`accept` 的签名用 `certFor(signer)` 验、`reject` 协议里没有签名；
   * 带上它保持与其它 ingest 路径同一形状，供将来的签名校验使用。
   */
  publicKey?: string;
}

@Injectable()
export class MdopTicketService {
  private readonly logger = new Logger(MdopTicketService.name);

  constructor(
    private readonly gm: GMCryptoService,
    private readonly ca: CaService,
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(MdopFragmentEntity, "controlplane")
    private readonly fragments: Repository<MdopFragmentEntity>,
    @InjectRepository(MdopStageEntity, "controlplane")
    private readonly stages: Repository<MdopStageEntity>,
    @InjectRepository(MdopTicketEntity, "controlplane")
    private readonly tickets: Repository<MdopTicketEntity>,
    @InjectRepository(MdopSignatureRecordEntity, "controlplane")
    private readonly signatures: Repository<MdopSignatureRecordEntity>,
    @InjectRepository(MdopOutboxEntity, "controlplane")
    private readonly outbox: Repository<MdopOutboxEntity>,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
    /**
     * C2 作业的**执行环境期望**来源（任务 5.3）：把「本院批准在这份代码下执行」冻进凭证核心。
     * 二者都是可选注入：非 C2 作业不需要它们；C2 作业缺它们即 fail-closed。
     */
    @Optional() private readonly contracts?: MdopContractService,
    @Optional() private readonly attestations?: MdopAttestationService,
  ) {}

  /**
   * 发起片段要约：给每个有片段的节点发一份，**只含它自己的片段**与片段哈希表。
   * 平台同时把凭证核心冻结下来（各持有方签的就是这一份）。
   */
  async offerTickets(input: OfferTicketsInput): Promise<{
    ticketId: string;
    core: TicketCore;
    offeredNodes: string[];
  }> {
    const job = await this.mustGetJob(input.jobId);
    assertJobTransition(job.status as never, "NEGOTIATING");
    const fragments = await this.fragments.find({
      where: { jobId: input.jobId },
    });
    if (fragments.length === 0)
      throw new MdopError("E_RUNTIME", {}, "作业没有片段，无法发起凭证要约");
    // 要约只发给**持有方**：平台自己的合并片段由平台执行，不需要「接受」别人的计划。
    const holders = fragments.filter(
      (row) => row.node !== this.platformParty(),
    );
    if (holders.length === 0)
      throw new MdopError("E_RUNTIME", {}, "作业没有任何持有方片段");

    const fragmentHashes: Record<string, string> = {};
    for (const row of fragments) fragmentHashes[row.node] = row.fragmentHash;
    const dayMs = 86_400_000;
    // **已双签的合约副本**：随要约一并下发，节点/连接器各自**本地验签后存档**（§7.4 第 2 项）。
    // 为什么必须随要约给：复核要用「本地合约副本」，而可信空间节点不是提供方——它拿不到
    // `ContractOffer`（那只发给提供方），没有副本就会把每一份要约都以 `E_CONTRACT_UNSIGNED` 拒掉。
    // 给的是**签名对象本身**（canonical + 持有方签名 + 平台副署），复核侧不采信平台给的结论、
    // 只采信自己验过的签名。
    const contractCopies = await this.contractCopiesForOffer(job.contracts);
    const deadlineHours = input.deadlineHours ?? 72;
    // C2 作业：把每个「接收 C2 的节点」的执行环境期望冻进凭证核心（要约时定稿、各持有方连它一起签）。
    // 这一步会**重新**核对一遍证明登记——编译到要约之间证明可能已过期，要约时刻才是权威。
    const expectations = await this.attestationExpectations(job);
    const core: TicketCore = parseTicketCore({
      ticket_id: `tkt-${randomUUID()}`,
      job_id: input.jobId,
      plan_hash: job.planHash ?? "",
      fragments: fragmentHashes,
      not_before: input.notBefore,
      not_after: input.notAfter,
      ...(expectations ? { attestation: expectations } : {}),
    });

    await this.tickets.save(
      this.tickets.create({
        ticketId: core.ticket_id,
        jobId: input.jobId,
        core: core as unknown as Record<string, unknown>,
        signatures: [],
        status: "OFFERED",
      }),
    );
    for (const row of holders) {
      await this.enqueue({
        msgType: "PlanFragmentOffer",
        receiver: row.node,
        jobId: input.jobId,
        idempotencyKey: `offer:${core.ticket_id}:${row.node}`,
        body: {
          ticket_id: core.ticket_id,
          core,
          // 只给对方自己的片段全文 + 全量片段哈希表；看不到别家的片段内容
          fragment: row.fragment,
          fragments: fragmentHashes,
          // 作业头（用途/申请方/合约/伦理/预算/有效期）——连接器的七项复核要用它，
          // 且不泄露任何别的节点的片段内容。
          job_header: job.jobHeader ?? {
            job_id: job.id,
            purpose: job.purpose,
            applicant: job.applicant,
            contracts: job.contracts,
            ...(job.ethicsRef ? { ethics_ref: job.ethicsRef } : {}),
            ...(job.dpBudget !== null && job.dpBudget !== undefined
              ? { dp_budget: job.dpBudget }
              : {}),
            not_before: input.notBefore,
            not_after: input.notAfter,
          },
          // 已双签的合约副本（复核第 2 项用）：可信空间节点拿不到 `ContractOffer`，
          // 缺它就等于把复核降级成「信平台口径」。给的是签名对象本身，各侧**本地验签后存档**。
          ...(contractCopies.length ? { contracts: contractCopies } : {}),
          review_deadline: new Date(
            Date.now() + deadlineHours * 3_600_000,
          ).toISOString(),
        },
      });
    }
    await this.jobs.update(
      { id: input.jobId },
      { status: "NEGOTIATING", updatedAt: new Date() },
    );
    void dayMs;
    return {
      ticketId: core.ticket_id,
      core,
      offeredNodes: holders.map((f) => f.node),
    };
  }

  /** 收到某院的接受：验签（本方证书公钥）→ 记录；全部到齐即签发凭证并下发。 */
  async accept(
    input: FragmentAcceptInput,
    sender: AuthenticatedSender,
  ): Promise<{ status: "COLLECTING" | "TICKETED" }> {
    // 身份绑定：`signer` 必须就是这条消息的已认证发送方（签名只挡伪造，不挡「记到别人账上」）
    if (input.signer !== sender.urn)
      throw new MdopError(
        "E_AUTH_INVALID",
        {},
        `接受消息自称 ${input.signer}，但已认证发送方是 ${sender.urn}`,
      );
    const job = await this.mustGetJob(input.jobId);
    if (job.status === "REJECTED") return { status: "COLLECTING" }; // 已否决：忽略迟到接受
    const ticket = await this.mustGetTicket(input.ticketId);
    // 至少一次投递：同一份接受会被重发（平台会重投要约，连接器会重发接受）。
    // 凭证已签发后再走一次「收齐 → 平台加签 → TICKETED」的迁移是非法的，会把本来
    // 跑得好好的作业判成错误；这里**直接返回同一结果**（幂等）。
    if (
      ticket.status === "ISSUED" ||
      job.status === "TICKETED" ||
      job.status === "RUNNING"
    )
      return { status: "TICKETED" };
    const core = parseTicketCore(ticket.core);

    // ① 核心必须与平台冻结的那一份一致（不能改凭证核心）
    if (JSON.stringify(core) !== JSON.stringify(parseTicketCore(input.core)))
      throw new BadRequestException("接受消息里的凭证核心与平台冻结的不一致");

    // ② 用该节点的登记证书公钥验「核心 + 快照」的签名
    const cert = await this.certFor(input.signer);
    const holderSig: TicketSignature = {
      signer: input.signer,
      role: "holder",
      snapshot: input.snapshot,
      sig: input.holderSignature,
    };
    if (!verifyHolderAcceptance(core, holderSig, cert.subjectPublicKey)) {
      await this.recordSignature(
        input.jobId,
        input.signer,
        "accept-rejected",
        "验签失败",
      );
      throw new MdopError("E_AUTH_INVALID", {}, "持有方接受签名无效");
    }

    const existing = (ticket.signatures as unknown as TicketSignature[]).filter(
      (s) => s.signer !== input.signer,
    );
    const collected = [...existing, holderSig];
    await this.tickets.update(
      { ticketId: input.ticketId },
      { signatures: collected as never },
    );
    await this.recordSignature(
      input.jobId,
      input.signer,
      "accept",
      undefined,
      input.snapshot,
      input.holderSignature.value,
    );

    // ③ 到齐？→ 平台加签，签发凭证
    const expected = await this.holderNodes(input.jobId);
    const accepted = new Set(collected.map((s) => s.signer));
    if (!expected.every((node) => accepted.has(node)))
      return { status: "COLLECTING" };

    // 平台加签：用平台节点密钥对**凭证核心**签名（私钥不出 CaService；
    // 与 packages/mdop 的 platformSignCore 同一口径：SM3(JCS(core))）。
    const platformSignature: TicketSignature = {
      signer: this.platformParty(),
      role: "platform",
      sig: this.ca.signObjectWith("platform-node", core),
    };
    const ticketObj: ExecutionTicket = buildTicket(
      core,
      collected,
      platformSignature,
    );
    await this.tickets.update(
      { ticketId: input.ticketId },
      {
        signatures: ticketObj.signatures as unknown as never,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    );
    await this.recordSignature(
      input.jobId,
      this.ca.platformNodePublicKey, // 公钥指纹留痕（私钥不落任何记录）
      "platform-countersign",
      undefined,
      undefined,
      platformSignature.sig.value,
    );
    for (const node of expected) {
      await this.enqueue({
        msgType: "ExecutionTicketIssue",
        receiver: node,
        jobId: input.jobId,
        idempotencyKey: `ticket:${core.ticket_id}:${node}`,
        body: { ticket: ticketObj },
      });
    }
    assertJobTransition(job.status as never, "TICKETED");
    await this.jobs.update(
      { id: input.jobId },
      { status: "TICKETED", updatedAt: new Date() },
    );
    return { status: "TICKETED" };
  }

  /**
   * 收到某院的拒绝：作业立即 `REJECTED`，**不发任何 StageDispatch**，
   * 并通知其他节点作废要约。
   */
  async reject(
    input: FragmentRejectInput,
    sender: AuthenticatedSender,
  ): Promise<{ status: "REJECTED" }> {
    // **reject 没有签名**（协议如此），身份绑定是唯一可控点：不得替别家拒绝
    if (input.signer !== sender.urn)
      throw new MdopError(
        "E_AUTH_INVALID",
        {},
        `拒绝消息自称 ${input.signer}，但已认证发送方是 ${sender.urn}`,
      );
    const job = await this.mustGetJob(input.jobId);
    await this.recordSignature(input.jobId, input.signer, "reject", input.code);
    if (job.status !== "REJECTED") {
      await this.jobs.update(
        { id: input.jobId },
        {
          status: "REJECTED",
          rejectReason: `${input.code}: ${input.message ?? "持有方拒绝"}`,
          updatedAt: new Date(),
        },
      );
    }
    const nodes = await this.holderNodes(input.jobId);
    for (const node of nodes) {
      if (node === input.signer) continue;
      await this.enqueue({
        msgType: "JobAbort",
        receiver: node,
        jobId: input.jobId,
        idempotencyKey: `abort:${input.jobId}:${node}`,
        body: { reason: "另一持有方拒绝，要约作废", by: input.signer },
      });
    }
    this.logger.warn(
      `作业 ${input.jobId} 因 ${input.signer} 拒绝进入 REJECTED`,
    );
    return { status: "REJECTED" };
  }

  /** 复核超时：视同拒绝（fail-closed）。 */
  async expireNegotiation(
    jobId: string,
    reason = "复核超时视同拒绝",
  ): Promise<void> {
    const job = await this.mustGetJob(jobId);
    if (job.status === "REJECTED") return;
    await this.jobs.update(
      { id: jobId },
      { status: "REJECTED", rejectReason: reason, updatedAt: new Date() },
    );
    for (const node of await this.holderNodes(jobId)) {
      await this.enqueue({
        msgType: "JobAbort",
        receiver: node,
        jobId,
        idempotencyKey: `abort:${jobId}:${node}`,
        body: { reason },
      });
    }
  }

  /**
   * 凭证摘要（控制台展示用，任务 7.2）：状态 + **按节点的执行环境期望**。
   *
   * 控制台要能看到「各院批准的到底是在哪份代码下执行」，这是 C2 作业最该被看见的一行；
   * 取最新一条凭证（不论是否已 ISSUED），便于协商阶段就能看到期望。
   */
  async ticketSummary(jobId: string): Promise<{
    ticketId: string;
    status: string;
    attestation: Record<string, AttestationExpectation>;
  } | null> {
    const rows = await this.tickets.find({ where: { jobId } });
    if (rows.length === 0) return null;
    const latest = rows[rows.length - 1];
    const core = parseTicketCore(latest.core);
    return {
      ticketId: core.ticket_id,
      status: String(latest.status ?? "OFFERED"),
      attestation: core.attestation ?? {},
    };
  }

  /** 已签发的凭证（调度器/执行前校验用）。 */
  async issuedTicket(jobId: string): Promise<ExecutionTicket | null> {
    const row = await this.tickets.findOne({
      where: { jobId, status: "ISSUED" },
    });
    if (!row) return null;
    return {
      core: parseTicketCore(row.core),
      signatures: row.signatures as unknown as TicketSignature[],
    };
  }

  /**
   * 逐节点算出「执行环境期望」：只给**接收 C2**的节点写（其它节点为空）。
   *
   * 判据不是「节点有没有 TEE 能力」，而是**它的片段里有没有 C2 输入**——后者才是真正会把
   * 密文送过去的那一步。没有 C2 输入就不该在这份凭证里出现期望，否则会把非 C2 作业也拖进 C2 语义。
   */
  private async attestationExpectations(
    job: MdopJobEntity,
  ): Promise<Record<string, AttestationExpectation> | undefined> {
    const fragments = await this.fragments.find({ where: { jobId: job.id } });
    const c2Nodes = fragments
      .filter((row) => {
        const stages =
          (row.fragment as { stages?: Array<{ input_labels?: string[] }> })
            .stages ?? [];
        return stages.some((s) => (s.input_labels ?? []).includes("C2"));
      })
      .map((row) => row.node);
    if (c2Nodes.length === 0) return undefined;

    if (!this.contracts || !this.attestations)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        {},
        "C2 作业缺少合约服务或证明登记服务，不能签发凭证",
      );

    // 多合约取更严的一侧（与编译期同一函数，避免两处各算一遍）
    let policy: AttestationPolicy | undefined;
    for (const contractId of job.contracts) {
      const described = await this.contracts.describeForNode(contractId);
      const declared = described.contract.attestation_policy;
      if (!declared) continue;
      policy = policy ? mergeAttestationPolicies(policy, declared) : declared;
    }
    if (!policy)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        {},
        "合约未声明证明策略，不得签发 C2 凭证",
      );

    const out: Record<string, AttestationExpectation> = {};
    for (const node of c2Nodes) {
      const row = await this.attestations.assertUsableForC2(node, policy);
      const threshold =
        typeof policy.min_tcb === "string"
          ? policy.min_tcb
          : policy.min_tcb?.[row.kind];
      out[node] = {
        tee: row.kind,
        measurement: row.measurement,
        ...(threshold !== undefined ? { min_tcb: threshold } : {}),
      };
    }
    return out;
  }

  /**
   * 要约随附的**已双签合约副本**（复核用）。
   *
   * 只带**两份签名都齐**的副本：缺任何一份，复核侧本来就该拒（`E_CONTRACT_UNSIGNED`），
   * 带一份残缺的副本只会把「合约还没签完」伪装成「节点复核失败」。
   * 这里不挑接收方——副本是签名对象，验签公钥在复核侧来自部署配置与登记表，平台说了不算。
   */
  private async contractCopiesForOffer(contractIds: readonly string[]): Promise<
    Array<{
      contract_id: string;
      canonical: string;
      holder_signature: string;
      platform_countersignature: string;
    }>
  > {
    if (!this.contracts) return [];
    const out: Array<{
      contract_id: string;
      canonical: string;
      holder_signature: string;
      platform_countersignature: string;
    }> = [];
    for (const contractId of contractIds ?? []) {
      try {
        const described = await this.contracts.describeForNode(contractId);
        if (!described.holderSignature || !described.platformCountersignature)
          continue;
        out.push({
          contract_id: contractId,
          canonical: described.canonical,
          holder_signature: described.holderSignature,
          platform_countersignature: described.platformCountersignature,
        });
      } catch {
        // 该合约没有 MDOP 条款（或读不到）：不随要约下发，交由复核侧按本地副本判定
      }
    }
    return out;
  }

  /** 需要签名接受的**持有方**节点（平台自己的合并片段不算）。 */
  private async holderNodes(jobId: string): Promise<string[]> {
    return (await this.fragments.find({ where: { jobId } }))
      .map((f) => f.node)
      .filter((node) => node !== this.platformParty());
  }

  /** 平台节点的 URN。 */
  platformParty(): string {
    return participantUrn(process.env.SPACE_ID ?? "sh-med", "platform");
  }

  private async mustGetJob(jobId: string): Promise<MdopJobEntity> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new BadRequestException("作业不存在");
    return job;
  }

  private async mustGetTicket(ticketId: string): Promise<MdopTicketEntity> {
    const ticket = await this.tickets.findOne({ where: { ticketId } });
    if (!ticket) throw new BadRequestException("凭证不存在");
    return ticket;
  }

  private async certFor(signer: string): Promise<CertificateEntity> {
    // 签署方标识可能是 URN（`urn:tds:<space>:participant:<id>`）或裸参与方 id；
    // 证书按参与方 id 登记，这里统一归一后再查。
    const participantId = parseParticipantUrn(signer)?.id ?? signer;
    const cert = await this.certs.findOne({ where: { participantId } });
    if (!cert) throw new MdopError("E_AUTH_INVALID", {}, "签署方没有登记证书");
    if (cert.revoked)
      throw new MdopError("E_AUTH_INVALID", {}, "签署方证书已吊销");
    return cert;
  }

  private async recordSignature(
    jobId: string,
    signer: string,
    kind: string,
    reason?: string,
    snapshot?: string,
    value?: string,
  ): Promise<void> {
    await this.signatures.save(
      this.signatures.create({
        id: randomUUID(),
        jobId,
        ticketId: null,
        signer,
        role: "holder",
        snapshot: snapshot ?? null,
        alg: "SM2-SM3",
        value: value ?? "",
        kind,
        reason: reason ?? null,
      }),
    );
  }

  private async enqueue(input: {
    msgType: string;
    receiver: string;
    jobId: string;
    idempotencyKey: string;
    body: Record<string, unknown>;
  }): Promise<void> {
    await this.outbox.save(
      this.outbox.create({
        id: `${input.msgType}:${input.idempotencyKey}`,
        msg_id: randomUUID(),
        msg_type: input.msgType,
        job_id: input.jobId,
        receiver: input.receiver,
        sender: `urn:tds:${process.env.SPACE_ID ?? "sh-med"}:participant:platform`,
        idempotency_key: input.idempotencyKey,
        body: input.body,
      }),
    );
  }
}
