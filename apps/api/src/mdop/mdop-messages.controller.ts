import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { UseFilters } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { MdopErrorFilter } from "./mdop-error.filter";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  Certificate as CertificateEntity,
  MdopDeliveryEntity,
  MdopFragmentEntity,
  MdopHandleEntity,
  MdopJobEntity,
} from "@medtrust/database";
import {
  assertNoInlineArtifact,
  parseArtifactHandle,
  parseDataEnvelope,
  parseParticipantUrn,
  parseSessionWitness,
  SchemaError,
  sm3Hex,
  type AttestationPolicy,
  type Envelope,
} from "@medtrust/mdop";
import { MdopOutboxService } from "./mdop-outbox.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { canonicalSm3 } from "@medtrust/mdop";
import type { RwsAnalysisSpec } from "../runtime/rws-orchestrator/types";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopAttestationService } from "./mdop-attestation.service";

/**
 * MDOP 消息入口（任务 7.2 / 7.7）。
 *
 * - `POST /api/v1/mdop/messages`：**控制面**。信封签名是唯一的应用层认证；
 *   `body` 夹带制品内容一律拒收。
 * - `POST /api/v1/mdop/deliveries`：**数据面**。只承载 C3 结果投递，逐项校验：
 *   等级为 C3、摘要与已登记句柄一致、合约接收方包含平台、作业有有效凭证。
 */
@ApiTags("mdop")
@Controller("mdop")
@UseFilters(MdopErrorFilter)
export class MdopMessagesController {
  private readonly logger = new Logger(MdopMessagesController.name);

  constructor(
    private readonly outbox: MdopOutboxService,
    private readonly contracts: MdopContractService,
    private readonly purge: MdopPurgeService,
    /** 会话见证的验签与登记（任务 6.7）。 */
    private readonly attestations: MdopAttestationService,
    private readonly receiptChain: MdopReceiptChainService,
    private readonly merge: MdopMergeService,
    /** 片段接受的收集与凭证签发（任务 7.5）。 */
    private readonly tickets: MdopTicketService,
    /** 阶段状态推进与下游派发（任务 7.6）。 */
    private readonly scheduler: MdopSchedulerService,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
    @InjectRepository(MdopHandleEntity, "controlplane")
    private readonly handles: Repository<MdopHandleEntity>,
    @InjectRepository(MdopDeliveryEntity, "controlplane")
    private readonly deliveryRepo: Repository<MdopDeliveryEntity>,
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    /** 片段（作业 → 节点）：C2 中继要核对「目标是不是本作业的片段节点」。 */
    @InjectRepository(MdopFragmentEntity, "controlplane")
    private readonly fragments: Repository<MdopFragmentEntity>,
  ) {}

  /**
   * **校验方直推证明背书**（D-TEE-6 补注，2026-10-03）。
   *
   * 与 `POST /mdop/attestations`（operator JWT）登记的是同一件事、走同一个 `acceptEndorsement`，
   * 区别只在承载方式：这里**不要人工账号**——背书本身由校验方的部署密钥签名，平台用部署配置的
   * `MDOP_KMS_PUBKEY` 验签并核白名单，签名就是它的全部认证（同本控制器 `messages` 的口径）。
   * 校验方是机器身份，让它保管一个 operator 口令既不必要也扩大了它的权限面。
   * 重放无害：背书有有效期，且按 `{node}#{quoteDigest}` 幂等。
   */
  @Post("attestations/endorsements")
  @Throttle({ default: { limit: 10, ttl: 1000 } })
  @ApiOperation({
    summary: "校验方推送节点证明背书（签名认证，无需 JWT；平台不自己验 quote）",
  })
  async endorsement(@Body() body: unknown) {
    const row = await this.attestations
      .acceptEndorsement(body)
      .catch((err: Error) => {
        // 推送体形状不对是调用方的错，不是平台内部错误（MdopError 由过滤器映射，这里只补形状错）
        if (err instanceof SchemaError)
          throw new BadRequestException(err.message);
        throw err;
      });
    return {
      registered: true,
      node: row.node,
      kind: row.kind,
      expiresAt: row.expiresAt,
      verifiedBy: row.verifiedBy,
      chainTx: row.chainTx ?? null,
    };
  }

  @Post("messages")
  // 控制面是**批量**通道：一次长轮询回来会连着发多条（片段接受、阶段状态、审计回执…），
  // 两院又常常同拍到达，默认 20/s 会把合法的审计回执上报打成 429。信封签名 + nonce
  // 才是它的真实防线，这里只留一个防滥用的上界。
  @Throttle({ default: { limit: 200, ttl: 1000 } })
  @ApiOperation({
    summary: "接收连接器的控制面消息（至少一次；按 msg_id/幂等键去重）",
  })
  async messages(@Body() body: { envelope?: Envelope }) {
    if (!body?.envelope) throw new BadRequestException("缺少 envelope");
    const envelope = body.envelope;
    // 控制面消息夹带制品内容即拒（规格「MDOP 消息经出站通道传输」）
    assertNoInlineArtifact(envelope.body ?? {}, "control-plane");
    const sender = parseParticipantUrn(envelope.sender);
    if (!sender) throw new BadRequestException("sender 不是参与方 URN");
    const cert = await this.certs.findOne({
      where: { participantId: sender.id },
    });
    if (!cert) throw new ForbiddenException("发送方没有登记证书");
    if (cert.revoked) throw new ForbiddenException("发送方证书已吊销");
    const verified = await this.outbox.verifyInbound(
      envelope,
      cert.subjectPublicKey,
    );
    return this.dispatch(verified, sender.id, cert.subjectPublicKey);
  }

  private async dispatch(
    envelope: Envelope,
    senderId: string,
    senderPublicKey: string,
  ) {
    const body = envelope.body as Record<string, unknown>;
    switch (envelope.msg_type) {
      case "ContractAgree": {
        const row = await this.contracts.agree({
          contractId: String(body.contract_id),
          canonical: String(body.canonical),
          holderSignature: String(body.holder_signature),
          // 签名证明「这份条款是提供方签的」；身份绑定再证明「现在提交它的就是提供方」
          senderUrn: envelope.sender,
        });
        return {
          accepted: true,
          msg_type: envelope.msg_type,
          contractId: row.id,
          mdopStatus: row.mdopStatus,
          platformCountersignature: row.platformCountersignature,
        };
      }
      case "CapabilityAdvertise":
        return {
          accepted: true,
          msg_type: envelope.msg_type,
          sender: senderId,
        };
      case "PurgeReceipt": {
        // 同样传**已认证上下文**：销毁回执必须由声明的那一方自己签（不得替别家宣布已销毁）
        const out = await this.purge.onPurgeReceipt(body as never, {
          urn: envelope.sender,
          publicKey: senderPublicKey,
        });
        return { accepted: true, msg_type: envelope.msg_type, ...out };
      }
      case "AttestationReport":
        return this.onAttestationReport(envelope, body, senderId);
      case "AuditReceipt": {
        // 身份与公钥都来自**消息层已认证的上下文**（证书目录），不采信回执正文的自述：
        // 「signer 必须就是发送方」+「签名必须能被该参与方公钥验过」两条都在服务里判。
        const out = await this.receiptChain.ingestAuditReceipt(body, {
          urn: envelope.sender,
          publicKey: senderPublicKey,
        });
        return {
          accepted: out.accepted,
          msg_type: envelope.msg_type,
          reason: out.reason,
        };
      }
      case "ArtifactReady": {
        // 制品就绪：只登记**句柄**（不含数据），数据面另行投递 C3 内容。
        // 句柄 schema 里没有 job/node（它们是信封与登记方的属性），必须在这里补上——
        // 否则 `cp_mdop_handle.jobId` 非空约束直接 500，连接器拿不到任何回执。
        const row = await this.persistHandle(body.handle, {
          jobId: envelope.job_id,
          node: senderId,
        });
        return {
          accepted: true,
          msg_type: envelope.msg_type,
          handle: row.handle,
        };
      }
      // ── 凭证要约的应答（任务 7.5）：收齐接受即签发凭证，任一拒绝即 REJECTED ──
      case "PlanFragmentAccept": {
        const out = await this.tickets.accept(
          {
            jobId: envelope.job_id,
            ticketId: String(body.ticket_id),
            core: body.core as never,
            snapshot: String(body.snapshot),
            holderSignature: body.holder_signature as never,
            signer: String(body.signer),
          },
          // 身份取自消息层已认证上下文：签名挡伪造，身份绑定挡「记到别人账上」
          { urn: envelope.sender, publicKey: senderPublicKey },
        );
        // 全部持有方到齐、凭证已签发 → 立刻下发第一跳阶段（§7.6 调度）。
        if (out.status === "TICKETED")
          await this.dispatchSafely(envelope.job_id);
        return { accepted: true, msg_type: envelope.msg_type, ...out };
      }
      case "PlanFragmentReject": {
        const out = await this.tickets.reject(
          {
            jobId: envelope.job_id,
            ticketId: String(body.ticket_id),
            signer: String(body.signer),
            code: String(body.code ?? "E_REJECTED"),
            ...(body.message ? { message: String(body.message) } : {}),
          },
          // reject 协议里没有签名 → 身份绑定是唯一可控点（不得替别家拒绝、把作业作废）
          { urn: envelope.sender, publicKey: senderPublicKey },
        );
        return { accepted: true, msg_type: envelope.msg_type, ...out };
      }
      // ── 阶段状态（任务 7.6）：成功推进下游，可重试错误按退避重发 ──
      case "StageStatus": {
        const out = await this.scheduler.onStageStatus({
          jobId: envelope.job_id,
          stageId: String(body.stage_id),
          // 上报方来自**消息层已认证的上下文**：阶段状态驱动状态机，必须核对是不是该阶段的落点节点
          reporter: envelope.sender,
          status: body.status as never,
          ...(body.code ? { code: String(body.code) } : {}),
          ...(body.message ? { message: String(body.message) } : {}),
          // 上报方执行的 attempt：被顶替的旧 attempt 迟到的状态不驱动状态机
          ...(Number.isInteger(body.attempt)
            ? { attempt: Number(body.attempt) }
            : {}),
        });
        if (out.stage === "SUCCEEDED" && out.jobStatus === "RUNNING") {
          await this.dispatchSafely(envelope.job_id);
        }
        return { accepted: true, msg_type: envelope.msg_type, ...out };
      }
      default:
        // 其余类型（片段接受/拒绝、阶段状态、回执）由 §7.5/§7.6/§7.9 的分发器接管；
        // 这里如实记录「收到但暂无处理器」，不静默丢弃。
        this.logger.warn(
          `收到暂无处理器的消息类型 ${envelope.msg_type}（from ${senderId}）`,
        );
        return {
          accepted: false,
          msg_type: envelope.msg_type,
          reason: "no-handler-yet",
        };
    }
  }

  /**
   * 节点上报**会话见证**（任务 6.7 / D13）：本次证明 + KMS 释放凭据。
   *
   * 平台只做三件事：
   *  ① 核对这条见证确实来自它自称的那个参与方（信封签名已认证发送方，这里再要求
   *     `sender === witness.node` 且 `envelope.job_id === witness.job_id`）；
   *  ② 用**部署配置里的 KMS 公钥**验签，并核对合约证明策略与凭证里冻结的期望，把**本体**存下来
   *     （只存摘要时持有方验不了，D13 会退化成「信平台」）；
   *  ③ 把**同一份见证**转发给该作业的持有方，让它们**自己验**。
   *
   * 平台**不**声称自己验过厂商 quote——那需要厂商证明根（PCCS / trustee / VCD 等），
   * 属 KMS 或具备证明根的部署方；这也是「平台给不出结论、只能给出可验对象」的原因。
   */
  private async onAttestationReport(
    envelope: Envelope,
    body: Record<string, unknown>,
    senderId: string,
  ): Promise<Record<string, unknown>> {
    const witness = parseSessionWitness(body.witness);
    if (envelope.sender !== witness.node)
      throw new BadRequestException(
        `见证声明的节点（${witness.node}）与信封发送方不一致`,
      );
    if (envelope.job_id !== witness.job_id)
      throw new BadRequestException("见证的作业与信封 job_id 不一致");

    const job = await this.jobs.findOne({ where: { id: witness.job_id } });
    if (!job) throw new BadRequestException("见证所属作业不存在");
    if (!(job.contracts ?? []).includes(witness.contract_id))
      throw new BadRequestException("见证的合约不在该作业的合约列表里");

    const described = await this.contracts.describeForNode(witness.contract_id);
    const policy = described.contract.attestation_policy as
      AttestationPolicy | undefined;
    if (!policy)
      throw new BadRequestException("该合约未声明证明策略，不得登记 C2 见证");

    const summary = await this.tickets.ticketSummary(witness.job_id);
    const expectation = summary?.attestation?.[witness.node];

    const row = await this.attestations.ingestWitness({
      witness,
      policy,
      ...(expectation ? { expectation } : {}),
    });

    // 转发给**数据持有方**（合约提供方）——D13 要的是持有方自己验；再加上合约里其他
    // 接收方（平台与上报节点除外）。持有方不在 recipients 里（C2 合约的接收方通常只有
    // 节点与平台），只按 recipients 转发会一份都发不出去。
    const recipients = [
      ...new Set([described.holder, ...described.recipients]),
    ].filter((r) => r !== this.outbox.platformParty() && r !== witness.node);
    for (const receiver of recipients) {
      await this.outbox.enqueue({
        msgType: "AttestationWitness",
        receiver,
        jobId: witness.job_id,
        idempotencyKey: `witness:${witness.warrant.warrant_digest}:${receiver}`,
        body: { witness },
      });
    }
    this.logger.log(
      `会话见证已登记并转发 node=${witness.node}（from ${senderId}）→ ${recipients.length} 个持有方`,
    );
    return {
      accepted: true,
      msg_type: envelope.msg_type,
      node: row.node,
      forwarded: recipients.length,
    };
  }

  /**
   * 推进下游阶段。作业已进入终态（`SUCCEEDED`/`REJECTED`/`FAILED`/`ABORTED`）时
   * `dispatchReadyStages` 会按迁移表拒绝——那是**预期**结果，不该让整条消息失败。
   */
  private async dispatchSafely(jobId: string): Promise<void> {
    try {
      const dispatched = await this.scheduler.dispatchReadyStages(jobId);
      if (dispatched)
        this.logger.log(`作业 ${jobId} 下发 ${dispatched} 个阶段`);
    } catch (err) {
      this.logger.warn(`作业 ${jobId} 阶段下发跳过：${(err as Error).message}`);
    }
  }

  /**
   * **C2 数据信封的中继**（任务 3.14、design D15）：持有方封好的 C2 信封经平台转给目标节点。
   *
   * 平台在这条链上是**转运方，不是接收方**：信封里的数据密钥封给了节点本次会话的一次性公钥，
   * 平台没有那把私钥，因此「看得见密文、解不开」。平台在这里只做**可判定的检查**：
   *  ① 信封由持有方签名（沿用出站认证与信封验签）；
   *  ② 信封的合约在该作业的合约列表里，且该合约**声明了证明策略**（否则该合约不允许 C2）；
   *  ③ AAD 绑定的作业/合约与信封自身一致；
   *  ④ **密文摘要**与信封登记的一致（平台不解密也能查完整性）；
   *  ⑤ 目标节点必须是该作业的**片段节点**（不能借中继把 C2 送到计划外的节点）；
   *  ⑥ 信封未过期。
   * 通过这些检查后入**发件箱**，由目标节点长轮询取走（与连接器同一套通道与认证）。
   */
  @Post("envelopes")
  @Throttle({ default: { limit: 200, ttl: 1000 } })
  @ApiOperation({
    summary: "接收并中继 C2 数据信封（数据面；平台只转运不解密）",
  })
  async relayEnvelope(
    @Body()
    body: {
      envelope?: Envelope;
      /** AEAD 密文体（与信封 `payload.ciphertext_ref` 对应）。 */
      sealed?: { ciphertext: string; iv: string; tag: string };
      /** 目标：可信空间节点（参与方 URN），必须是该作业的片段节点。 */
      target?: string;
    },
  ) {
    if (!body?.envelope || !body.sealed || !body.target)
      throw new BadRequestException("缺少 envelope / sealed / target");
    const sender = parseParticipantUrn(body.envelope.sender);
    if (!sender) throw new BadRequestException("sender 不是参与方 URN");
    const cert = await this.certs.findOne({
      where: { participantId: sender.id },
    });
    if (!cert) throw new ForbiddenException("发送方没有登记证书");
    await this.outbox.verifyInbound(body.envelope, cert.subjectPublicKey);

    const payload = body.envelope.body as
      { data_envelope?: unknown } | undefined;
    let dataEnvelope;
    try {
      dataEnvelope = parseDataEnvelope(payload?.data_envelope);
    } catch (err) {
      throw new BadRequestException(
        `C2 信封结构非法：${(err as Error).message}`,
      );
    }

    // ② 合约：在作业的合约列表里，且声明了证明策略
    const job = await this.jobs.findOne({
      where: { id: body.envelope.job_id },
    });
    if (!job) throw new BadRequestException("作业不存在");
    // 只为**执行中**的作业转运：作业已出执行态（成功/失败/中止/销毁）后迟到的信封没有任何阶段
    // 会消费它，放进发件箱只会让目标节点白白下载并缓冲一份密文。
    if (job.status !== "TICKETED" && job.status !== "RUNNING")
      throw new BadRequestException(
        `作业已不在执行态（${job.status}），不再中继 C2 信封`,
      );
    if (!(job.contracts ?? []).includes(dataEnvelope.policy.contract))
      throw new BadRequestException("信封的合约不在该作业的合约列表里");
    const described = await this.contracts.describeForNode(
      dataEnvelope.policy.contract,
    );
    if (!described.contract.attestation_policy)
      throw new BadRequestException("该合约未声明证明策略，不得中继 C2 信封");

    // ③ AAD 绑定与信封自身一致（换作业/换合约即拒）
    if (dataEnvelope.aad.job_id !== body.envelope.job_id)
      throw new BadRequestException("信封 AAD 的作业与消息的作业不一致");
    if (dataEnvelope.aad.contract_id !== dataEnvelope.policy.contract)
      throw new BadRequestException("信封 AAD 的合约与策略里的合约不一致");

    // ④ 密文摘要（不解密也能查完整性）；⑤ 目标必须是本作业的片段节点；⑥ 未过期
    const actualDigest = `sm3:${sm3Hex(Buffer.from(body.sealed.ciphertext, "base64"))}`;
    if (actualDigest !== dataEnvelope.payload.digest)
      throw new BadRequestException("密文摘要与信封声明不符");
    const fragments = await this.fragments.find({
      where: { jobId: body.envelope.job_id },
    });
    if (!fragments.some((f) => f.node === body.target))
      throw new BadRequestException("目标节点不是该作业的片段节点");
    if (Date.parse(dataEnvelope.policy.not_after) <= Date.now())
      throw new BadRequestException("信封已过期");

    // 中继：入发件箱（目标节点长轮询取走）。幂等键按「密钥 + 目标」取，
    // 至少一次投递下重复中继同一份信封不会在节点侧变成两份。
    const relayKey = `relay:${dataEnvelope.wrapped_key.key_id}:${body.target}`;
    // 「密钥 + 目标」挡不住**重封**：持有方把同一阶段又封了一次（换了密钥）就是另一条行。
    // 同一作业、同一持有方、同一目标只留最新一份——旧的在这里撤回，不留给节点每轮下载再拒收
    // （2026-10-07 真机事故：两家各重封 4 次，节点一次长轮询收到 8 份、5.2MB）。
    await this.outbox.withdrawSupersededRelays({
      jobId: body.envelope.job_id,
      receiver: body.target,
      holder: body.envelope.sender,
      keepId: `C2EnvelopeRelay:${relayKey}`,
    });
    await this.outbox.enqueue({
      msgType: "C2EnvelopeRelay",
      receiver: body.target,
      jobId: body.envelope.job_id,
      idempotencyKey: relayKey,
      body: {
        data_envelope: dataEnvelope as unknown as Record<string, unknown>,
        sealed: body.sealed,
        holder: body.envelope.sender,
        credential_id: dataEnvelope.aad.credential_id,
      },
    });
    // 审计行：只留句柄与摘要（**不**在中继表里再存一份密文）
    await this.deliveryRepo.save(
      this.deliveryRepo.create({
        id: randomUUID(),
        jobId: body.envelope.job_id,
        node: body.envelope.sender,
        handle: dataEnvelope.payload.ciphertext_ref,
        label: "C2",
        digest: actualDigest,
        accepted: true,
        reason: `relay→${body.target}`,
        payload: null,
      }),
    );
    this.logger.log(
      `C2 信封已中继 job=${body.envelope.job_id} from=${body.envelope.sender} → ${body.target}`,
    );
    return {
      accepted: true,
      target: body.target,
      handle: dataEnvelope.payload.ciphertext_ref,
    };
  }

  @Post("deliveries")
  @Throttle({ default: { limit: 200, ttl: 1000 } })
  @ApiOperation({ summary: "接收 C3 结果投递（数据面；只收 C3）" })
  async deliveries(
    @Body()
    body: {
      envelope?: Envelope;
      handle?: { handle: string; label: string; digest: string };
      /** C3 交付物载荷（平台是合约明示的接收方；非 C3 一律拒收）。 */
      payload?: Record<string, unknown>;
    },
  ) {
    if (!body?.envelope || !body.handle)
      throw new BadRequestException("缺少 envelope 或 handle");
    const sender = parseParticipantUrn(body.envelope.sender);
    if (!sender) throw new BadRequestException("sender 不是参与方 URN");
    // 投递行用**发送方 URN** 记节点：合并阶段按各院片段里的 URN 比对接收方，
    // 存成裸 participant id 会让「收齐判定」永远缺人（实测踩到过）。
    const senderUrn = body.envelope.sender;
    const cert = await this.certs.findOne({
      where: { participantId: sender.id },
    });
    if (!cert) throw new ForbiddenException("发送方没有登记证书");
    await this.outbox.verifyInbound(body.envelope, cert.subjectPublicKey);

    // 载荷必须**与接受判定同一次写入**：早期实现先查「已接受行」再回填载荷，
    // 而那一行要等本函数末尾才插入 —— 于是 payload 永远落不到库里，合并阶段
    // 只会看到「投递没有 C3 载荷」。
    const record = async (accepted: boolean, reason?: string) => {
      const existing = accepted
        ? await this.deliveryRepo.findOne({
            where: {
              jobId: body.envelope!.job_id,
              node: senderUrn,
              accepted: true,
            },
          })
        : null;
      const payload = accepted
        ? ((body.payload ?? null) as Record<string, unknown> | null)
        : null;
      if (existing) {
        // 重复投递（至少一次）：把载荷补上/刷新到同一条已接受记录
        await this.deliveryRepo.update({ id: existing.id }, { payload });
      } else {
        await this.deliveryRepo.save(
          this.deliveryRepo.create({
            id: randomUUID(),
            jobId: body.envelope!.job_id,
            node: senderUrn,
            handle: body.handle!.handle,
            label: body.handle!.label,
            digest: body.handle!.digest,
            accepted,
            reason: reason ?? null,
            payload,
          }),
        );
      }
      if (!accepted) throw new ForbiddenException(reason ?? "投递被拒");
      return { accepted: true, handle: body.handle!.handle };
    };

    // ① 数据面只收 C3
    if (body.handle.label !== "C3")
      return record(false, "数据面只接受 C3 投递");

    // ② 句柄必须已登记且摘要一致
    const registered = await this.handles.findOne({
      where: { handle: body.handle.handle },
    });
    if (!registered) return record(false, "句柄未登记");
    if (registered.digest !== body.handle.digest)
      return record(false, "摘要与已登记句柄不一致");
    // ②' 载荷摘要必须与声明一致（内容被改过即拒）
    if (body.payload && canonicalSm3(body.payload) !== body.handle.digest)
      return record(false, "投递载荷的摘要与声明不符");

    // ③ 合约接收方必须包含平台（D-MDOP-2）
    const job = await this.jobs.findOne({
      where: { id: body.envelope.job_id },
    });
    if (!job) return record(false, "作业不存在");
    const parties = new Set<string>();
    for (const contractId of job.contracts) {
      const described = await this.contracts.describeForNode(contractId);
      for (const party of described.recipients) parties.add(party);
    }
    if (!parties.has(this.outbox.platformParty()))
      return record(false, "合约接收方列表里没有平台");

    // ④ 作业必须已有凭证
    if (!["TICKETED", "RUNNING", "RELEASING", "SUCCEEDED"].includes(job.status))
      return record(false, "作业尚未取得执行凭证");

    const result = await record(true);
    if (body.payload) {
      // 收齐即合并（缺人时不合并，等重发）
      await this.merge
        .mergeIfReady(body.envelope.job_id, l15AnalysisOf(job))
        .catch((err) =>
          this.logger.error(
            `合并阶段失败（作业 ${body.envelope?.job_id}）：${(err as Error).message}`,
          ),
        );
    }
    return result;
  }

  /** 注册句柄（连接器上报 ArtifactReady 时用；只登记句柄，不含数据）。 */
  @Post("handles")
  async registerHandle(
    @Body()
    body: {
      handle?: Record<string, unknown>;
      jobId?: string;
      node?: string;
    },
  ) {
    if (!body?.handle) throw new BadRequestException("缺少 handle");
    if (!body.jobId || !body.node)
      throw new BadRequestException(
        "缺少 jobId / node（句柄 schema 不含作业与节点，登记方必须给出）",
      );
    const row = await this.persistHandle(body.handle, {
      jobId: body.jobId,
      node: body.node,
    });
    return { registered: true, handle: row.handle };
  }

  /**
   * 句柄落库：把「协议句柄」映射到控制面表的列（表里还带作业、节点、凭证、到期时间，
   * 这些都不在协议句柄 schema 里，必须由登记方从信封补齐）。
   */
  private async persistHandle(
    raw: unknown,
    meta: { jobId: string; node: string },
  ): Promise<MdopHandleEntity> {
    const handle = parseArtifactHandle(raw);
    return this.handles.save(
      this.handles.create({
        handle: handle.handle,
        jobId: meta.jobId,
        node: meta.node,
        stage: handle.producer.stage,
        label: handle.label,
        schema: handle.schema,
        digest: handle.digest,
        producer: handle.producer as unknown as Record<string, unknown>,
        ticketId: handle.ticket_id,
        expiresAt: handle.expires_at,
        stats: handle.stats ?? null,
      }),
    );
  }
}

/**
 * 从作业的逻辑计划里取出 L1.5 分析参数（合并阶段要用同一个 drug）。
 * 本期只有失衡检测一条 MDOP 链路；其他分析类型走旧管线。
 */
export function l15AnalysisOf(job: {
  logicalPlan?: Record<string, unknown>;
}): RwsAnalysisSpec {
  const plan = (job.logicalPlan ?? {}) as {
    stages?: Array<{ op?: string; params?: { drug?: string } }>;
  };
  const stage = (plan.stages ?? []).find((s) =>
    s.op?.startsWith("rws.disproportionality@"),
  );
  const drug = stage?.params?.drug;
  return {
    type: "disproportionality",
    level: "L1.5",
    ...(drug ? { drug } : {}),
  } as RwsAnalysisSpec;
}
