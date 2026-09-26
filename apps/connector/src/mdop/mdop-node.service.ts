import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MdopError,
  canonicalSm3,
  holderSignAcceptance,
  parseAuditReceipt,
  parseExecutionTicket,
  parseFragment,
  parsePurgeReceipt,
  parseSessionWitness,
  parseTicketCore,
  signCanonicalObject,
  verifyEnvelope,
  verifyTicketForExecution,
  type AuditReceipt,
  type AttestationPolicy,
  type Envelope,
  type ExecutionTicket,
  type PurgeReceipt,
} from '@medtrust/mdop';
import { MdopContractStore } from './contract-store';
import { MdopOperatorWhitelistStore } from './operator-whitelist';
import { MdopReviewService, type JobHeaderView } from './mdop-review';
import { MdopStageExecutor } from './mdop-executor';
import { MdopEgressGuard } from './mdop-egress';
import { MdopOutboundClient } from './mdop-client';
import { MdopLocalStore } from './mdop-local-store';
import { loadConnectorPrivateKey, connectorPublicKey } from '../domain/connector-key';
import { platformPublicKey } from '../domain/platform-keys';
import { NodeWitnessVerifier } from './node/witness-verify';

/**
 * 连接器侧 MDOP 运行时（任务 8.2/8.4/8.5/8.7）。
 *
 * 一条消息的完整路径：
 *   信封印证（平台节点公钥 + 收件人 + 时间窗 + nonce）→ 按类型分派
 *   → 片段要约走**七项本地复核** → 签名接受/只带错误码拒绝
 *   → 凭证 + 调度到达时先校验凭证与快照 → 幂等执行 → 制品入库 + 句柄上报
 *   → 阶段状态与审计回执出站；终态收 PurgeOrder 销毁并出销毁回执。
 *
 * 缺省 `MDOP_ENABLED=false`：关闭时完全不处理 MDOP 消息（旧管线不受影响）。
 */

export interface NodeHandleResult {
  msg_type: string;
  handled: boolean;
  detail?: string;
}

@Injectable()
export class MdopNodeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MdopNodeService.name);
  private tickTimer?: ReturnType<typeof setInterval>;
  /** 已签发的凭证（内存缓存；重启后需平台重发，缺凭证即拒绝执行 —— fail-closed）。 */
  private readonly tickets = new Map<string, ExecutionTicket>();
  /** 已上报过的审计回执 id（避免重复上报）。 */
  private readonly reported = new Set<string>();

  constructor(
    private readonly contracts: MdopContractStore,
    private readonly whitelist: MdopOperatorWhitelistStore,
    private readonly review: MdopReviewService,
    private readonly executor: MdopStageExecutor,
    private readonly egress: MdopEgressGuard,
    private readonly outbound: MdopOutboundClient,
    private readonly store: MdopLocalStore,
    @Optional() private readonly opts: { privateKey?: string; participantId?: string } = {},
    /**
     * 持有方侧的会话见证核验（任务 6.7）。KMS 公钥来自**部署配置**
     * （`CONNECTOR_MDOP_KMS_PUBKEY`），缺省即「未接入」——此时见证一律判拒绝并留痕。
     * 放在 `opts` **之后**：既有的位置化构造（用例、装配代码）不必改。
     */
    @Optional()
    private readonly witnessVerifier: NodeWitnessVerifier = new NodeWitnessVerifier({
      kmsPublicKey: (process.env.CONNECTOR_MDOP_KMS_PUBKEY ?? '').trim(),
    }),
  ) {}

  enabled(): boolean {
    return (process.env.MDOP_ENABLED ?? 'false').trim().toLowerCase() === 'true';
  }

  /**
   * 启动时把**落盘的 nonce** 载入内存：信封校验是同步接口，
   * 不同步这一份，重启后同一封重放就会漏过去（规格要求 nonce 重启后仍有效）。
   */
  async onModuleInit(): Promise<void> {
    const loaded = await this.store.hydrateNonces();
    if (loaded) this.logger.log(`已载入 ${loaded} 条未过期 nonce（重启后防重放继续有效）`);
    // 周期任务必须有人驱动：上报未上报的审计回执（§8.7 回执链要送上链头）、
    // TTL 到期自主销毁、清理过期 nonce。没有这个定时器，回执只会躺在本地库里。
    this.tickTimer = setInterval(() => {
      void this.tick().catch((err) =>
        this.logger.warn(`MDOP 周期任务失败：${(err as Error).message}`),
      );
    }, 60_000);
    this.tickTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  /** 处理长轮询批次里的 MDOP 信封。 */
  async handleBatch(envelopes: Envelope[] | undefined): Promise<NodeHandleResult[]> {
    if (!this.enabled()) return [];
    const results: NodeHandleResult[] = [];
    for (const envelope of envelopes ?? []) {
      try {
        results.push(await this.handleEnvelope(envelope));
      } catch (err) {
        const message = err instanceof MdopError ? `${err.code}: ${err.message}` : (err as Error).message;
        this.logger.warn(`MDOP 消息处理失败（${envelope?.msg_type}）：${message}`);
        results.push({ msg_type: String(envelope?.msg_type), handled: false, detail: message });
      }
    }
    return results;
  }

  async handleEnvelope(envelope: Envelope): Promise<NodeHandleResult> {
    const platformKey = platformPublicKey('platform-node');
    if (!platformKey) throw new Error('未配置 CONNECTOR_PLATFORM_NODE_PUBKEY（fail-closed）');
    // **先按 msg_id 去重**：至少一次投递会把同一条消息重发多次，协议要求对重复消息
    // 返回与首次相同的结果（不重放副作用）。去重必须先于 nonce 校验——否则合法的重发
    // 会被当成重放错误（nonce 已被首次消费），并对同一条消息反复告警。
    const dedupKey = `msg:${envelope.msg_id}`;
    // 少数消息的作用是**恢复本地状态**（已复核片段与凭证只在内存里，重启即丢）。平台按
    // 至少一次投递会重发它们，但按 msg_id 去重会把重发挡回去 —— 于是重启后的节点永远
    // 拿不到片段/凭证，`StageDispatch` 一律 `E_TICKET_INVALID`。这类消息必须**每次都
    // 重新应用**：重放要约 = 重新走七项复核（幂等，且失败即拒，符合 fail-closed），
    // 重放凭证 = 按 ticket_id 覆盖写入。
    const reapplyTypes = new Set(['ExecutionTicketIssue', 'PlanFragmentOffer']);
    // 本地状态已建立就**短路**：重放要约只在「重启后内存为空」时才需要重新复核，
    // 否则每一轮长轮询都会把全部历史要约重跑一遍（重签、重发接受），既刷屏又
    // 把平台的限流打爆（实测：审计回执上报被 429 拦下）。
    if (envelope.msg_type === 'PlanFragmentOffer') {
      const ticketId = String((envelope.body as { ticket_id?: string })?.ticket_id ?? '');
      if (ticketId && this.reviewedTickets.has(ticketId))
        return { msg_type: envelope.msg_type, handled: true, detail: 'fragment-cached' };
    }
    if (envelope.msg_type === 'ExecutionTicketIssue') {
      const ticketId = String(
        (envelope.body as { ticket?: { core?: { ticket_id?: string } } })?.ticket?.core?.ticket_id ??
          '',
      );
      if (ticketId && this.tickets.has(ticketId))
        return { msg_type: envelope.msg_type, handled: true, detail: 'ticket-cached' };
    }
    const cached = reapplyTypes.has(envelope.msg_type)
      ? null
      : ((await this.store.findProcessed(dedupKey)) as unknown as NodeHandleResult | null);
    if (cached) return cached as unknown as NodeHandleResult;

    const self = this.selfUrn();
    // 信封四步校验：签名 / 收件人 / 时间窗 / nonce（落盘，重启后仍有效）。
    // **nonce 延后落盘**：处理成功后才记，否则「校验过但处理失败」的消息会被
    // 后续重发永久判成 E_REPLAY，永远送不达。
    verifyEnvelope(envelope, {
      self,
      senderPublicKey: platformKey,
      // 状态恢复型消息是平台**设计内的重发**：签名/收件人/时间窗照验，nonce 不再拦
      // （首次处理时已记过 nonce，再拦会把重发判成 E_REPLAY，状态永远恢复不了）。
      nonceStore: reapplyTypes.has(envelope.msg_type)
        ? { seen: () => false, remember: () => undefined }
        : this.store.nonceStore(),
      rememberNonce: false,
    });
    const body = envelope.body as Record<string, unknown>;
    const result = await this.dispatchByType(envelope, body);
    // 处理成功：现在才落 nonce（同一封重发由上面的 msg_id 去重拦下）
    if (!reapplyTypes.has(envelope.msg_type))
      this.store.nonceStore().remember(envelope.nonce, new Date(Date.now() + 10 * 60_000));
    await this.store.rememberProcessed(
      dedupKey,
      envelope.job_id ?? '',
      '__message__',
      1,
      result as unknown as Record<string, unknown>,
    );
    return result;
  }

  private async dispatchByType(
    envelope: Envelope,
    body: Record<string, unknown>,
  ): Promise<NodeHandleResult> {
    switch (envelope.msg_type) {
      case 'ContractOffer':
        return this.onContractOffer(body);
      case 'ContractTerminate':
        return this.onContractTerminate(body);
      case 'ContractAgreeAck':
        return this.onContractAgreeAck(body);
      case 'PlanFragmentOffer':
        return this.onFragmentOffer(body);
      case 'ExecutionTicketIssue':
        return this.onTicketIssue(body);
      case 'StageDispatch':
        return this.onStageDispatch(body);
      case 'AttestationWitness':
        return this.onAttestationWitness(body);
      case 'PurgeOrder':
        return this.onPurgeOrder(envelope, body);
      default:
        return { msg_type: envelope.msg_type, handled: false, detail: 'no-handler' };
    }
  }

  // ── 合约 ──────────────────────────────────────────────────────────────

  private async onContractOffer(body: Record<string, unknown>): Promise<NodeHandleResult> {
    const out = await this.contracts.receiveOffer({
      offer_id: String(body.offer_id),
      contract_id: String(body.contract_id),
      canonical: String(body.canonical),
    });
    if (out.agreement) {
      await this.sendMessage('ContractAgree', {
        idempotencyKey: `agree:${out.agreement.contractId}`,
        jobId: '',
        body: {
          contract_id: out.agreement.contractId,
          canonical: out.agreement.canonical,
          holder_signature: out.agreement.holderSignature,
          review: out.agreement.review,
        },
      });
      return { msg_type: 'ContractOffer', handled: true, detail: `auto-confirmed:${out.agreement.review}` };
    }
    // 缺省人工确认：留在本地待确认队列，等院内确认后再发 ContractAgree
    return { msg_type: 'ContractOffer', handled: true, detail: `pending-review:${out.status}` };
  }

  private async onContractTerminate(body: Record<string, unknown>): Promise<NodeHandleResult> {
    await this.contracts.applyTermination(
      String(body.contract_id),
      String(body.reason ?? '平台终止'),
    );
    return { msg_type: 'ContractTerminate', handled: true };
  }

  /** 平台副署回执：本地副本带齐双签名才算生效（复核只认本地副本）。 */
  private async onContractAgreeAck(body: Record<string, unknown>): Promise<NodeHandleResult> {
    const contractId = String(body.contract_id);
    const countersignature = String(body.platform_countersignature ?? '');
    if (!countersignature) throw new Error('ContractAgreeAck 缺平台副署');
    await this.contracts.applyCountersignature(contractId, countersignature);
    return { msg_type: 'ContractAgreeAck', handled: true, detail: `active:${contractId}` };
  }

  // ── 片段复核 ──────────────────────────────────────────────────────────

  private async onFragmentOffer(body: Record<string, unknown>): Promise<NodeHandleResult> {
    const core = parseTicketCore(body.core);
    const jobHeader = body.job_header as JobHeaderView | undefined;
    if (!jobHeader) throw new Error('片段要约缺少作业头（无法完成复核）');
    // **复核**与**投递接受**分开处理：只有复核不过才回 `PlanFragmentReject`。
    // 出站失败（网络/平台 4xx）不是「本院拒绝」，把它当拒绝会凭一次抖动把作业打成
    // REJECTED —— 那种情况应当直接抛出，让要约按至少一次投递再送一遍。
    let outcome: Awaited<ReturnType<MdopReviewService['review']>>;
    try {
      outcome = await this.review.review(
        {
          ticketId: String(body.ticket_id),
          core,
          jobHeader,
          fragment: body.fragment,
          fragments: body.fragments as Record<string, string>,
        },
        {
          node: this.selfUrn(),
          snapshotFor: async (dataProductId, stageIds) => this.snapshotFor(dataProductId, stageIds),
        },
      );
    } catch (err) {
      // 拒绝消息**只含错误码与一句说明**（不含本地策略原文/预算/数据规模）
      const code = err instanceof MdopError ? err.code : 'E_RUNTIME';
      const reason = err instanceof MdopError ? err.toRejectReason() : undefined;
      // 非 MdopError（出站失败、代码缺陷等）必须把原文带出来，否则只剩一句
      // 「本节点拒绝该片段」，连错在哪一步都看不出来。
      const detail = (err as Error)?.message ?? '本节点拒绝该片段';
      await this.sendMessage('PlanFragmentReject', {
        jobId: core.job_id,
        idempotencyKey: `reject:${core.ticket_id}:${this.selfUrn()}`,
        body: {
          ticket_id: core.ticket_id,
          signer: this.selfUrn(),
          code,
          message: reason?.message ?? detail,
          ...(reason?.edge ? { edge: reason.edge } : {}),
        },
      });
      await this.audit(core.job_id, '__negotiation__', 'FRAGMENT_REJECTED', {
        op_digest: 'component:x@1',
        output_digest: null,
        label: null,
        input_digests: [],
      });
      this.logger.warn(`片段被拒（${code}）：${detail} ticket=${core.ticket_id}`);
      return { msg_type: 'PlanFragmentOffer', handled: true, detail: `rejected:${code}` };
    }

    // 记住「本方片段」与「合同」：执行阶段要用它们做凭证校验与 minCell 读取
    this.rememberReviewed(core.ticket_id, outcome.fragment, outcome.contract.contractId, {
      dataProductId: outcome.dataProductId,
      stageIds: outcome.fragment.stages.map((s) => s.id),
      c2Targets: outcome.c2Targets,
    });

    const privateKey = this.privateKey();
    const acceptance = holderSignAcceptance(
      core,
      outcome.snapshot,
      this.selfUrn(),
      privateKey,
      connectorPublicKey(privateKey),
    );
    await this.sendMessage('PlanFragmentAccept', {
      jobId: core.job_id,
      idempotencyKey: `accept:${core.ticket_id}:${this.selfUrn()}`,
      body: {
        ticket_id: core.ticket_id,
        core,
        snapshot: outcome.snapshot,
        holder_signature: acceptance.sig,
        signer: this.selfUrn(),
      },
    });
    await this.audit(core.job_id, '__negotiation__', 'FRAGMENT_ACCEPTED', {
      op_digest: 'component:x@1',
      output_digest: null,
      label: null,
      input_digests: [],
    });
    return { msg_type: 'PlanFragmentOffer', handled: true, detail: 'accepted' };
  }

  private async onTicketIssue(body: Record<string, unknown>): Promise<NodeHandleResult> {
    const ticket = parseExecutionTicket(body.ticket);
    this.tickets.set(ticket.core.ticket_id, ticket);
    return { msg_type: 'ExecutionTicketIssue', handled: true, detail: ticket.core.ticket_id };
  }

  // ── 执行 ──────────────────────────────────────────────────────────────

  /**
   * 平台转来的**会话见证**（任务 6.7 / D13）：本院**自己验**，不采信平台的结论。
   *
   * 判据与期望都来自本地：合约副本（`attestation_policy`）与本院签过的凭证核心
   * （`core.attestation[node]`）。KMS 公钥来自部署配置——平台能「不给」，做不到「伪造」。
   * 通过/拒绝都写审计回执（`WITNESS_VERIFIED` / `WITNESS_REJECTED`），因此「验过没有」可查。
   */
  private async onAttestationWitness(body: Record<string, unknown>): Promise<NodeHandleResult> {
    const witness = parseSessionWitness(body.witness);

    // 本地合约副本：没有副本即不验（fail-closed），也不因为「平台说的」就当作已知合约
    const local = await this.contracts.get(witness.contract_id);
    if (!local) {
      await this.audit(witness.job_id, '__witness__', 'WITNESS_REJECTED', {
        op_digest: `kms:${witness.warrant.kms}`,
        output_digest: null,
        label: null,
        input_digests: [],
        // 规格要求「拒绝含错误码」：码进回执本体，而不是只回给平台的那一句 detail
        code: 'E_CONTRACT_UNSIGNED',
      });
      return { msg_type: 'AttestationWitness', handled: false, detail: 'E_CONTRACT_UNSIGNED' };
    }
    const terms = JSON.parse(local.canonical) as { attestation_policy?: AttestationPolicy };
    if (!terms.attestation_policy) {
      await this.audit(witness.job_id, '__witness__', 'WITNESS_REJECTED', {
        op_digest: `kms:${witness.warrant.kms}`,
        output_digest: null,
        label: null,
        input_digests: [],
        code: 'E_ENVELOPE_POLICY',
      });
      return { msg_type: 'AttestationWitness', handled: false, detail: 'E_ENVELOPE_POLICY' };
    }

    // 本院签过的期望（有就一并核对：换了代码或换了链型即拒）
    const ticket = this.tickets.get(witness.credential_id);
    const expectation = ticket?.core.attestation?.[witness.node];

    const record = this.witnessVerifier.verify({
      witness,
      policy: terms.attestation_policy,
      ...(expectation ? { expectation } : {}),
    });
    await this.audit(
      witness.job_id,
      '__witness__',
      record.verified ? 'WITNESS_VERIFIED' : 'WITNESS_REJECTED',
      {
        op_digest: `kms:${witness.warrant.kms}`,
        output_digest: record.warrant_digest,
        label: null,
        input_digests: witness.report.quote_digest ? [witness.report.quote_digest] : [],
        // 通过不带码；拒绝带**结构化**的错误码 + 一句固定说明（供持有方与审计按码统计）
        ...(record.verified ? {} : { code: record.code ?? 'E_RUNTIME', reason: record.reason ?? '' }),
      },
    );
    return {
      msg_type: 'AttestationWitness',
      handled: record.verified,
      detail: record.verified ? record.warrant_digest ?? undefined : record.code ?? undefined,
    };
  }

  private async onStageDispatch(body: Record<string, unknown>): Promise<NodeHandleResult> {
    const ticketId = String(body.ticket_id);
    const stageId = String(body.stage_id);
    const attempt = Number(body.attempt ?? 1);
    const key = String(body.idempotency_key ?? `${ticketId}:${stageId}:${attempt}`);

    // 幂等：同一 job:stage:attempt 返回原结果，不重算
    const previous = await this.store.findProcessed(key);
    if (previous) return { msg_type: 'StageDispatch', handled: true, detail: 'replayed' };

    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new MdopError('E_TICKET_INVALID', {}, '本节点没有该凭证（可能重启过）');

    const jobId = ticket.core.job_id;
    const fragmentRecord = await this.contracts.get(String(body.contract_id ?? ''));
    void fragmentRecord;
    // 待执行片段从本地已复核的副本取（平台在 dispatch 时不给片段内容）
    const fragment = this.pendingFragments.get(`${ticketId}:${stageId}`);
    if (!fragment) throw new MdopError('E_TICKET_INVALID', {}, '本节点没有该阶段的片段副本');

      // 执行前凭证校验 + 快照复核（重算入参与复核时**同一组**，否则必然不符）
      const args = this.reviewSnapshotArgs.get(ticketId) ?? { dataProductId: '', stageIds: [stageId] };
      const snapshot = await this.snapshotFor(args.dataProductId, args.stageIds);
    verifyTicketForExecution({
      ticket,
      node: this.selfUrn(),
      fragment,
      nodePublicKey: connectorPublicKey(this.privateKey()),
      platformPublicKey: platformPublicKey('platform-node'),
      platformParty: `urn:tds:${process.env.SPACE_ID ?? 'sh-med'}:participant:platform`,
      now: new Date(),
      recomputedSnapshot: snapshot,
    });

    const stage = fragment.stages.find((s) => s.id === stageId);
    if (!stage) throw new MdopError('E_TICKET_INVALID', {}, '片段里没有该阶段');

    // 执行（system 算子本节点注册；wasm 走沙箱）。取上游、执行、任一环节失败都在
    // 下面统一出站报告 FAILED —— 平台据此决定重试或让作业失败，绝不静默算空集。
    let output: Awaited<ReturnType<MdopStageExecutor['execute']>>;
    try {
      const inputs = new Map<string, Record<string, unknown>>();
      for (const input of stage.inputs) {
        // 数据源句柄（`ds://<node>/<dataProductId>`）不是上游阶段产物：由 source 算子
        // 自己按 `params.uri` 加载本地数据，这里不该去制品库找它。
        if (input.from.startsWith('ds://')) continue;
        // `inputs[].from` 是**本节点内的上游阶段 id**；也兼容直接给句柄的写法。
        const artifact =
          (await this.store.artifactForStage(jobId, input.from)) ??
          (await this.store.readArtifact(input.from));
        if (!artifact)
          throw new MdopError('E_RUNTIME', {}, `上游产物不存在或已销毁：${input.from}`);
        inputs.set(input.from, artifact.payload);
      }
      output = await this.executor.execute(
        {
          jobId,
          stage,
          inputs,
          attempt,
          // system 算子要读合约发布条件（如降密的 minCell）——从**本地合约副本**取
          ...(await this.localContractTerms(ticketId, stageId)),
        },
        this.whitelist.manifestFor(stage.op),
      );
    } catch (err) {
      // 失败也要出站：平台靠 StageStatus 区分「可重试 / 不可重试」并决定是否重发（§7.6）。
      const code = err instanceof MdopError ? err.code : 'E_RUNTIME';
      await this.reportStageStatus({
        jobId,
        stageId,
        attempt,
        ticketId,
        status: 'FAILED',
        code,
        message: (err as Error).message,
      }).catch((sendErr) =>
        this.logger.warn(`阶段失败状态上报失败：${(sendErr as Error).message}`),
      );
      throw err;
    }

    // 制品入库 + 句柄上报（只登记句柄，不含数据）；C0 制品**不投递**
    const handle = `art://${this.participantId()}/${jobId}/${stageId}/${stage.id}`;
    await this.store.putArtifact({
      handle,
      jobId,
      stage: stageId,
      label: output.label,
      schema: output.schema,
      digest: output.digest,
      payload: output.payload,
      stats: output.label === 'C3' ? c3Stats(output.payload) : null,
      expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      ticketId,
    });
    await this.sendMessage('ArtifactReady', {
      jobId,
      idempotencyKey: `ready:${jobId}:${stageId}:${attempt}`,
      body: {
        handle: {
          handle,
          label: output.label,
          schema: output.schema,
          digest: output.digest,
          producer: { stage: stageId, op: stage.op, op_digest: stage.op_digest },
          ticket_id: ticketId,
          expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
          stats: output.label === 'C3' ? c3Stats(output.payload) : null,
        },
      },
    }).catch((err) => this.logger.warn(`句柄上报失败：${(err as Error).message}`));

    // C3 制品投递到数据面：平台是合约明示的接收方（D-MDOP-2），合并要用载荷。
    // 投递前过**出节点守卫**（第三道拦截），目标必须在本地合约的接收方列表里。
    if (output.label === 'C3') {
      await this.deliverC3(jobId, stageId, ticketId, {
        handle,
        digest: output.digest,
        payload: output.payload,
      }).catch((err) => this.logger.warn(`C3 投递失败：${(err as Error).message}`));
    }

    // C2 制品：投给**复核结论里点名的 C2 对端**（经平台中继，平台只转运不解密）。
    // 目标不从消息里取、也不猜：复核阶段已经把它定下来了（§6.5 的 `c2Targets`）。
    if (output.label === 'C2') {
      await this.relayC2(jobId, ticketId, output.payload).catch((err) =>
        this.logger.warn(`C2 信封中继失败：${(err as Error).message}`),
      );
    }

    await this.store.rememberProcessed(key, jobId, stageId, attempt, {
      handle,
      label: output.label,
      digest: output.digest,
    });
    await this.audit(jobId, stageId, 'STAGE_SUCCEEDED', {
      op_digest: stage.op_digest,
      output_digest: output.digest,
      label: output.label,
      input_digests: [],
    });
    // 阶段状态出站：平台据此推进下游（读到的上游就绪即下发下一跳）。
    await this.reportStageStatus({
      jobId,
      stageId,
      attempt,
      ticketId,
      status: 'SUCCEEDED',
      digest: output.digest,
      label: output.label,
    }).catch((err) => this.logger.warn(`阶段状态上报失败：${(err as Error).message}`));
    return { msg_type: 'StageDispatch', handled: true, detail: `executed:${handle}` };
  }

  /** 上报阶段状态（控制面；不带任何制品内容）。 */
  private async reportStageStatus(input: {
    jobId: string;
    stageId: string;
    attempt: number;
    ticketId: string;
    status: 'SUCCEEDED' | 'FAILED';
    code?: string;
    message?: string;
    digest?: string;
    label?: string;
  }): Promise<unknown> {
    return this.sendMessage('StageStatus', {
      jobId: input.jobId,
      idempotencyKey: `status:${input.jobId}:${input.stageId}:${input.attempt}`,
      body: {
        job_id: input.jobId,
        stage_id: input.stageId,
        ticket_id: input.ticketId,
        attempt: input.attempt,
        status: input.status,
        ...(input.code ? { code: input.code } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.digest ? { digest: input.digest } : {}),
        ...(input.label ? { label: input.label } : {}),
      },
    });
  }

  /**
   * C2 信封的投递（任务 6.2 / 3.14）：把封好的信封交给**平台中继**转给该作业的 C2 目标节点。
   *
   * 三条不许含糊的边界：
   *  ① **目标来自复核结论**（`c2Targets`），不从消息里取、不猜；没有对端就**不投**（并留痕）；
   *  ② 投出去的是**密文 + 密钥封套**（平台解不开），明细仍在信封里、密钥封在目标节点的一次性公钥上；
   *  ③ 信封不是本节点自制的：它就是 `seal` 算子产出的那一份（带持有方签名与 AAD 绑定）。
   */
  private async relayC2(
    jobId: string,
    ticketId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const targets = this.ticketC2Targets.get(ticketId) ?? [];
    if (targets.length !== 1) {
      // 0 个：这不是 C2 作业（不该走到这里）；>1 个：本实现只支持单目标，多目标需要按边分别投递。
      this.logger.warn(
        `C2 信封未中继 job=${jobId} ticket=${ticketId}：复核结论中的 C2 对端数为 ${targets.length}`,
      );
      return;
    }
    const envelope = payload.envelope as Record<string, unknown> | undefined;
    const sealed = {
      ciphertext: String(payload.ciphertext ?? ''),
      iv: String(payload.iv ?? ''),
      tag: String(payload.tag ?? ''),
    };
    if (!envelope || !sealed.ciphertext || !sealed.iv || !sealed.tag)
      throw new Error('C2 制品缺信封或密文体，拒绝中继（不留半份信封）');

    const target = targets[0];
    const outer = this.outbound.buildEnvelope({
      msgType: 'C2EnvelopeSubmit',
      jobId,
      receiver: `urn:tds:${process.env.SPACE_ID ?? 'sh-med'}:participant:platform`,
      idempotencyKey: `c2submit:${jobId}:${String(envelope.wrapped_key ? (envelope.wrapped_key as { key_id?: string }).key_id : '')}`,
      body: { data_envelope: envelope },
    });
    await this.outbound.relayEnvelope({ envelope: outer, sealed, target });
    this.logger.log(`C2 信封已提交中继 job=${jobId} → ${target}`);
  }

  /**
   * C3 投递（数据面）：守卫放行 → 目标取本地合约接收方里的**平台** → 连载荷一起投。
   * 没有本地合约副本或契约不允许时**不投**（并记审计），绝不静默降级放行。
   */
  private async deliverC3(
    jobId: string,
    stageId: string,
    ticketId: string,
    art: { handle: string; digest: string; payload: Record<string, unknown> },
  ): Promise<void> {
    const target = this.egress.platformParty();
    const contractId = this.stageContracts.get(`${ticketId}:${stageId}`);
    const local = contractId ? await this.contracts.get(contractId) : null;
    if (!local) throw new Error(`本地没有该阶段的合约副本（${contractId ?? '未知合约'}），拒绝投递`);
    this.egress.assertDeliverable({ label: 'C3', target, contract: local });
    const envelope = this.outbound.buildEnvelope({
      msgType: 'ResultDeliver',
      jobId,
      receiver: target,
      idempotencyKey: `deliver:${jobId}:${stageId}:${ticketId}`,
      body: { handle: art.handle, digest: art.digest, label: 'C3' },
    });
    await this.outbound.sendDelivery(
      envelope,
      { handle: art.handle, label: 'C3', digest: art.digest },
      art.payload,
    );
    this.logger.log(`C3 已投递平台 job=${jobId} stage=${stageId} digest=${art.digest.slice(0, 16)}…`);
  }

  private readonly pendingFragments = new Map<string, ReturnType<typeof parseFragment>>();
  /** 已复核过的凭证号（内存态：重启后为空 → 允许平台重发要约重新复核）。 */
  private readonly reviewedTickets = new Set<string>();
  /** 复核结论里的 **C2 边对端**（`ticket:stage` 粒度不需要：一条凭证的对端由复核给出）。 */
  private readonly ticketC2Targets = new Map<string, string[]>();

  /**
   * 取本阶段的**本地合约条款**（system 算子读发布条件用，如降密的 minCell）。
   * 合约 id 在复核阶段按 `ticket:stage` 记下；执行时只读本地副本，不采信任何随消息内容。
   */
  private async localContractTerms(
    ticketId: string,
    stageId: string,
  ): Promise<{ contractTerms?: Record<string, unknown> }> {
    const contractId = this.stageContracts.get(`${ticketId}:${stageId}`);
    if (!contractId) return {};
    const local = await this.contracts.get(contractId);
    if (!local) return {};
    try {
      // 额外带上凭证号：封装算子要把它绑进信封的 AAD（换作业/换凭证即解不开）。
      return {
        contractTerms: {
          ...(JSON.parse(local.canonical) as Record<string, unknown>),
          credential_id: ticketId,
        },
      };
    } catch {
      return {};
    }
  }

  /** 复核时记下「凭证:阶段 → 合约 id」。 */
  private readonly stageContracts = new Map<string, string>();

  /**
   * 复核时算快照用的**入参**（凭证 → {数据产品, 阶段集合}）。
   *
   * 执行时要重算快照比对「接受时签入的值」（`E_SNAPSHOT_CHANGED`）。重算必须用
   * **同一组入参**：复核用的是合约里的数据产品 id + 片段全部阶段，执行时若改用
   * 别的东西（如空 id 与单个阶段），算出来的值必然不同，合法执行会被误判为数据变更。
   */
  private readonly reviewSnapshotArgs = new Map<
    string,
    { dataProductId: string; stageIds: string[] }
  >();

  /** 复核通过时把片段与合约缓存起来（执行阶段要用它做凭证校验与读发布条件）。 */
  rememberReviewed(
    ticketId: string,
    fragment: unknown,
    contractId?: string,
    snapshotArgs?: { dataProductId: string; stageIds: string[]; c2Targets?: string[] },
  ): void {
    const parsed = parseFragment(fragment);
    this.reviewedTickets.add(ticketId);
    if (snapshotArgs) this.reviewSnapshotArgs.set(ticketId, snapshotArgs);
    // C2 边的对端在复核阶段就定下了（§6.5 的 `c2Targets`）：投递 C2 信封时不再猜目标
    if (snapshotArgs?.c2Targets?.length) this.ticketC2Targets.set(ticketId, [...snapshotArgs.c2Targets]);
    for (const stage of parsed.stages) {
      this.pendingFragments.set(`${ticketId}:${stage.id}`, parsed);
      if (contractId) this.stageContracts.set(`${ticketId}:${stage.id}`, contractId);
    }
  }

  // ── 销毁 ──────────────────────────────────────────────────────────────

  private async onPurgeOrder(
    envelope: Envelope,
    body: Record<string, unknown>,
  ): Promise<NodeHandleResult> {
    const jobId = String(body.job_id ?? envelope.job_id);
    const privateKey = this.privateKey();
    const receipt = await this.buildPurgeReceipt(jobId, 'purge-order', privateKey, `purge:${jobId}`);
    await this.sendMessage('PurgeReceipt', {
      jobId,
      idempotencyKey: `purge-receipt:${jobId}`,
      body: receipt as unknown as Record<string, unknown>,
    });
    return { msg_type: 'PurgeOrder', handled: true, detail: `purged:${jobId}` };
  }

  /** 销毁制品并出签名回执（重复指令返回同一回执：句柄列表来自本地，幂等）。 */
  private async buildPurgeReceipt(
    jobId: string,
    reason: PurgeReceipt['reason'],
    privateKey: string,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<PurgeReceipt> {
    const artifacts = await this.store.listArtifacts(jobId);
    const handles = artifacts.map((a) => a.handle);
    const payload = {
      receipt_id: `rcpt:${jobId}:${reason}`,
      job_id: jobId,
      node: this.selfUrn(),
      reason,
      handles,
      destroyed_at: now.toISOString(),
      idempotency_key: idempotencyKey,
    };
    const sig = signCanonicalObject(payload, privateKey, {
      publicKey: connectorPublicKey(privateKey),
    });
    // 真正销毁：删掉本地制品行
    for (const artifact of artifacts) await this.store.purgeJob(jobId, reason, privateKey, idempotencyKey);
    // 销毁也是审计事件（规格：事件包括销毁）
    await this.audit(jobId, '__purge__', 'ARTIFACT_PURGED', {
      op_digest: 'component:purge@1',
      output_digest: null,
      label: null,
      input_digests: [],
    });
    return parsePurgeReceipt({ ...payload, sig });
  }

  /** 周期任务：TTL 到期自主销毁并出（ttl）回执；上报未上报的审计回执。 */
  async tick(now = new Date()): Promise<{ expired: number; reported: number }> {
    if (!this.enabled()) return { expired: 0, reported: 0 };
    const expired = await this.store.sweepExpired(now);
    for (const item of expired) {
      const receipt = await this.buildPurgeReceipt(
        item.jobId,
        'ttl',
        this.privateKey(),
        `purge-ttl:${item.jobId}`,
        now,
      );
      await this.sendMessage('PurgeReceipt', {
        jobId: item.jobId,
        idempotencyKey: `purge-receipt-ttl:${item.jobId}`,
        body: receipt as unknown as Record<string, unknown>,
      }).catch(() => undefined);
    }
    const pending = await this.store.unreportedReceipts();
    let reported = 0;
    for (const row of pending) {
      if (this.reported.has(row.receiptId)) continue;
      try {
        await this.sendMessage('AuditReceipt', {
          jobId: row.jobId,
          idempotencyKey: `audit:${row.receiptId}`,
          body: row.payload,
        });
        this.reported.add(row.receiptId);
        reported += 1;
      } catch (err) {
        this.logger.warn(`审计回执上报失败：${(err as Error).message}`);
        break;
      }
    }
    if (reported) await this.store.markReported(pending.slice(0, reported).map((r) => r.receiptId));
    await this.store.sweepNonces(now);
    return { expired: expired.length, reported };
  }

  // ── 工具 ──────────────────────────────────────────────────────────────

  /** 每事件一条签名审计回执（成链）。 */
  private async audit(
    jobId: string,
    stage: string,
    event: AuditReceipt['event'],
    detail: {
      op_digest: string;
      output_digest: string | null;
      label: AuditReceipt['label'];
      input_digests: string[];
      [extra: string]: unknown;
    },
  ): Promise<string> {
    const privateKey = this.privateKey();
    const previous = await this.store.lastReceipt(jobId);
    // 四个固定字段摊平，其余附加字段进 `detail` 子对象——
    // `AuditReceipt` 对**顶层**未知字段是拒收的，摊在顶层会让平台解析器直接拒掉这条回执。
    const { op_digest, output_digest, label, input_digests, ...extra } = detail;
    const payload = {
      receipt_id: randomUUID(),
      job_id: jobId,
      stage,
      event,
      input_digests,
      op_digest,
      output_digest,
      label,
      ...(Object.keys(extra).length > 0 ? { detail: extra } : {}),
      prev_receipt_hash: previous ? previous.entryHash : null,
      signer: this.selfUrn(),
      at: new Date().toISOString(),
    };
    const sig = signCanonicalObject(payload, privateKey, {
      publicKey: connectorPublicKey(privateKey),
    });
    const receipt = parseAuditReceipt({ ...payload, sig });
    const { entryHash } = await this.store.appendSignedReceipt(
      receipt as unknown as { receipt_id: string; job_id: string; stage: string; event: string; prev_receipt_hash: string | null },
    );
    return entryHash;
  }

  private async sendMessage(
    msgType: Parameters<MdopOutboundClient['buildEnvelope']>[0]['msgType'],
    input: { jobId: string; idempotencyKey: string; body: Record<string, unknown> },
  ): Promise<unknown> {
    const envelope = this.outbound.buildEnvelope({
      msgType,
      jobId: input.jobId,
      receiver: `urn:tds:${process.env.SPACE_ID ?? 'sh-med'}:participant:platform`,
      idempotencyKey: input.idempotencyKey,
      body: input.body,
    });
    return this.outbound.sendMessage(envelope);
  }

  private selfUrn(): string {
    return this.outbound.selfUrn();
  }

  private participantId(): string {
    return this.opts.participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
  }

  private privateKey(): string {
    const key = this.opts.privateKey ?? loadConnectorPrivateKey();
    if (!key) throw new Error('未配置连接器私钥（D-MDOP-3）');
    return key;
  }

  /** 数据快照标识（§9 接真实数据加载；缺省用数据产品 id 派生，保证确定性）。 */
  private async snapshotFor(dataProductId: string, stageIds: string[]): Promise<string> {
    return canonicalSm3({ dataset: dataProductId, stages: stageIds });
  }
}

/**
 * C3 句柄的 `stats`：**只是规模元数据，不是载荷**。
 *
 * 键名刻意不用 `rows`/`records`/`data` —— 控制面消息有「夹带制品内容」的结构化判据
 * （`ARTIFACT_PAYLOAD_KEYS`），用那些名字会把句柄上报本身判成夹带数据而拒收。
 */
function c3Stats(payload: Record<string, unknown>): Record<string, unknown> {
  const buckets = payload.buckets;
  if (Array.isArray(buckets)) {
    return { row_count: buckets.length, cohort_size: Number(payload.cohortSize ?? 0) };
  }
  return { row_count: Object.keys(payload).length };
}
