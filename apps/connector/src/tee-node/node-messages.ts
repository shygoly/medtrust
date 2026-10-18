import { Logger } from '@nestjs/common';
import {
  MdopError,
  parseExecutionTicket,
  parseTicketCore,
  resolveMeasurementWhitelist,
  verifyTicketForExecution,
  type AttestationPolicy,
  type Envelope,
  type ExecutionTicket,
  type MdopContract,
  type PhysicalStage,
  type TicketCore,
} from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';
import type { BudgetKey, BudgetPolicy } from '../mdop/node/budget-ledger';
import type { NodeArtifactStore } from '../mdop/node/node-artifacts';
import type { TrustedNodeSession } from '../mdop/node/node-session';
import type { NodeContractStore } from './contract-store';
import type { NodeDeclassifyRegistration } from './declassify-op';
import {
  nodeEnvironmentSnapshot,
  reviewFragmentForNode,
  signNodeAcceptance,
  type C2InboundEdge,
  type NodeFragmentReviewDeps,
  type NodeFragmentReviewOutcome,
  type NodeJobHeader,
} from './fragment-review';
import type { NodeReceiptReporter } from './receipt-report';
import {
  dispatchNodeStage,
  resumeNodeStageReports,
  stageOutcome,
  type NodeStageDispatchDeps,
  type NodeStageOutcome,
} from './stage-dispatch';
import type { C2RelayBody } from './relay-receive';
import { NodeExecutedStages, type ExecutedStageEntry } from './executed-ledger';
import { outstandingReports } from './stage-reports';

/**
 * 可信空间节点的**消息处理**（任务 3.17）：把平台下发的五类消息接成一条能跑通的链。
 *
 * 为什么这一层非有不可：节点此前只有「跑一次已装配好的阶段」的能力，**没有任何消息入口**——
 * 平台发来的 `PlanFragmentOffer`（要约）与 `PurgeOrder`（销毁）被长轮询如实记为「收到但暂无处理器」。
 * 后果不是「少一个功能」，而是**链根本跑不起来**：
 *  - 平台按 `holderNodes`（全部片段节点）收齐接受签名才签发凭证 ⇒ 节点不接受，作业永远停在与要约阶段；
 *  - 平台收齐全部销毁回执才进 `PURGED` ⇒ 节点不回执，作业永远进不了终态。
 *
 * 五类消息与各自的判据：
 *
 * | 消息 | 做什么 | 判据从哪来 |
 * |---|---|---|
 * | `PlanFragmentOffer` | 本地复核（`fragment-review.ts`）→ 签名接受 / 带错误码拒绝 | 本地合约副本、本地白名单、本节点能力通告 |
 * | `ExecutionTicketIssue` | 存凭证并**当场校验**（含快照比对） | 本地片段 + 平台公钥（部署配置） |
 * | `C2EnvelopeRelay` | 按**片段里的 C2 入边**把信封缓冲到对应阶段 | 已复核片段（不从消息猜目标阶段） |
 * | `StageDispatch` | 信封齐了就执行（先解封后执行），否则**等**（不误报失败） | 凭证 + 本地片段 + 已到位的信封 |
 * | `PurgeOrder` | 销毁本作业制品并回签名回执（幂等） | 本节点制品库 |
 *
 * 两条刻意的设计：
 *  ① **信封与派发是两个来源**：平台分别下发 `C2EnvelopeRelay` 与 `StageDispatch`，先后顺序不保证。
 *     因此这里做**会合**：谁后到谁触发执行；先到的一方只登记，**不报 FAILED**（那会把正常的竞态
 *     误判成节点故障并触发平台退避重试）。
 *  ② **幂等按 `凭证:阶段`**：至少一次投递会重复下发同一阶段，已执行过的**绝不重跑**。
 *     执行与上报是分开的：阶段的副作用一发生完就登记并落盘（`executed-ledger.ts`），之后的句柄登记 /
 *     C3 投递 / 会话见证 / 回执链 / 阶段状态哪一步没送达，重发的指令只补那一步（`stage-reports.ts`）。
 */

export interface NodeStageDeploymentContext {
  /** 本次查询的记账口径（数据集×快照、上限、申请方）。 */
  budget: { key: BudgetKey; policy: BudgetPolicy; cost: number; applicant: string };
  /** 持有方（信封签署方）的登记公钥——由部署侧的参与方登记表给出。 */
  holderPublicKey(signer: string): string | undefined;
}

export interface NodeMessageRouterDeps {
  /** 本节点标识（URN）。 */
  node: string;
  /** 平台 URN（收件方与平台签名主体）。 */
  platform: string;
  /** 以**节点身份**签名的出站客户端。 */
  outbound: MdopOutboundClient;
  /** 本节点身份密钥（接受签名用；私钥不出本进程）。 */
  identity: { privateKey: string; publicKey: string };
  /** 部署配置里的平台节点公钥（核验凭证里的平台签名与合约副署）。 */
  platformPublicKey: string;
  /**
   * 参与方登记公钥（部署侧注入的登记表）：验**合约副本的持有方签名**与**C2 信封的持有方签名**都用它。
   * 与 `stageContext.holderPublicKey` 通常指向同一张表，但在要约阶段还没有阶段上下文，因此单列一项。
   */
  participantPublicKey?(participant: string): string | undefined;
  session: TrustedNodeSession;
  artifacts: NodeArtifactStore;
  contracts: NodeContractStore;
  declassify: NodeDeclassifyRegistration;
  /** 要约复核所需（白名单 / 本节点能力 / 度量白名单 / 账本开关）。 */
  review: Omit<NodeFragmentReviewDeps, 'node' | 'contracts' | 'now'>;
  /** 执行阶段所需的部署侧上下文（预算口径与持有方登记公钥）。 */
  stageContext(
    input: {
      jobId: string;
      credentialId: string;
      stage: PhysicalStage;
      terms: MdopContract;
      /** 申请方（来自作业头；账本按它记账并做差分查询检测）。 */
      applicant: string;
      /** 数据快照口径（合约预审快照给得出就用它，否则由部署方决定）。 */
      snapshot?: string;
    },
  ): Promise<NodeStageDeploymentContext> | NodeStageDeploymentContext;
  receipts?: NodeReceiptReporter;
  state?: { persist(): unknown };
  /**
   * 已执行阶段登记（`凭证:阶段` → 结果）。装配时与 `state` 用**同一个实例**，它才会随节点状态落盘、
   * 重启后恢复；不给就只在本进程内有效（单测与一次性装配用）。
   */
  executed?: NodeExecutedStages;
  now?: () => Date;
}

export type NodeMessageStatus = 'handled' | 'deferred' | 'rejected' | 'ignored';

export interface NodeMessageResult {
  msgType: string;
  status: NodeMessageStatus;
  detail?: string;
  /** 阶段执行结果（仅 `StageDispatch` 真正执行时有）。 */
  outcome?: NodeStageOutcome;
}

interface StageDispatchBody {
  ticketId: string;
  stageId: string;
  attempt: number;
}

export class NodeMessageRouter {
  /** 已复核（并已签名接受）的本节点片段。 */
  private readonly reviews = new Map<string, NodeFragmentReviewOutcome>();
  /** 已收到的执行凭证（只在内存；重启后由平台按至少一次投递重发）。 */
  private readonly tickets = new Map<string, ExecutionTicket>();
  /** 已到达的 C2 信封：`凭证 → 持有方 → 信封`（按持有方绑定到阶段输入）。 */
  private readonly envelopes = new Map<string, Map<string, C2RelayBody>>();
  /** 已到位的派发指令（等信封齐）。 */
  private readonly pendingDispatches = new Map<string, StageDispatchBody>();
  /**
   * 已执行完成的阶段（`凭证:阶段`）：至少一次投递下的幂等口径。
   * 与片段/凭证/信封不同，它**不能只在内存里**：执行有不可重来的副作用（密钥释放、预算扣减、C3 交付），
   * 重启后平台重发指令时必须认得出「这一段跑过了」（见 `executed-ledger.ts`）。
   */
  private readonly executed: NodeExecutedStages;
  private readonly logger = new Logger(NodeMessageRouter.name);

  constructor(private readonly deps: NodeMessageRouterDeps) {
    this.executed = deps.executed ?? new NodeExecutedStages();
  }

  /** 已复核的片段（装配/测试查询用；核对的是本节点自己复核过的那一份）。 */
  reviewed(ticketId: string): NodeFragmentReviewOutcome | undefined {
    return this.reviews.get(ticketId);
  }

  /** 已收到的凭证。 */
  ticket(ticketId: string): ExecutionTicket | undefined {
    return this.tickets.get(ticketId);
  }

  /**
   * 处理一封**已由长轮询验签**的平台消息（签名 / 收件人 / 时间窗在 `poller.ts` 已判）。
   *
   * 复核不过的**要约**走「拒绝消息」而不是抛错（拒绝是正常业务结论，要落回平台）；
   * 其余错误一律抛出，由调用方按至少一次投递重试——把网络抖动当业务拒绝会把作业误打成 REJECTED。
   */
  async handle(envelope: Envelope): Promise<NodeMessageResult> {
    const body = (envelope.body ?? {}) as Record<string, unknown>;
    switch (envelope.msg_type) {
      case 'PlanFragmentOffer':
        return this.onOffer(body);
      case 'ExecutionTicketIssue':
        return this.onTicketIssue(body);
      case 'C2EnvelopeRelay':
        return this.onRelay(envelope, body);
      case 'StageDispatch':
        return this.onStageDispatch(envelope, body);
      case 'PurgeOrder':
        return this.onPurgeOrder(envelope, body);
      default:
        return { msgType: envelope.msg_type, status: 'ignored' };
    }
  }

  // ── 要约：复核 → 签名接受 / 带错误码拒绝 ──────────────────────────────

  private async onOffer(body: Record<string, unknown>): Promise<NodeMessageResult> {
    const ticketId = String(body.ticket_id ?? '');
    const jobHeader = body.job_header as NodeJobHeader | undefined;
    if (!ticketId || !jobHeader)
      throw new MdopError('E_RUNTIME', {}, '片段要约缺 ticket_id 或作业头（无法完成复核）');

    let outcome: NodeFragmentReviewOutcome;
    try {
      // ① 先收下随要约下发的**已双签合约副本**（本地验签后才存档）。
      //    顺序不能反：复核第 2 项判的就是「本地有没有覆盖本片段全部算子的副本」。
      this.storeContractCopies(body.contracts);
      outcome = await reviewFragmentForNode(
        { node: this.deps.node, contracts: this.deps.contracts, ...this.deps.review, now: this.now() },
        {
          ticketId,
          core: body.core,
          jobHeader,
          fragment: body.fragment,
          fragments: (body.fragments ?? {}) as Record<string, string>,
        },
      );
    } catch (err) {
      // 拒绝消息**只含错误码与一句说明**（不含本地策略原文/白名单/数据规模）
      const code = err instanceof MdopError ? err.code : 'E_RUNTIME';
      const reason = err instanceof MdopError ? err.toRejectReason() : undefined;
      const detail = (err as Error)?.message ?? '本节点拒绝该片段';
      await this.send('PlanFragmentReject', {
        jobId: jobHeader.job_id,
        idempotencyKey: `reject:${ticketId}:${this.deps.node}`,
        body: {
          ticket_id: ticketId,
          signer: this.deps.node,
          code,
          message: reason?.message ?? detail,
          ...(reason?.edge ? { edge: reason.edge } : {}),
        },
      });
      return { msgType: 'PlanFragmentOffer', status: 'rejected', detail: code };
    }

    const core: TicketCore = parseTicketCore(body.core);
    this.reviews.set(ticketId, outcome);
    const acceptance = signNodeAcceptance({
      core,
      snapshot: outcome.snapshot,
      node: this.deps.node,
      privateKey: this.deps.identity.privateKey,
      publicKey: this.deps.identity.publicKey,
    });
    await this.send('PlanFragmentAccept', {
      jobId: core.job_id,
      idempotencyKey: `accept:${ticketId}:${this.deps.node}`,
      body: {
        ticket_id: ticketId,
        core,
        snapshot: outcome.snapshot,
        holder_signature: acceptance.sig,
        signer: this.deps.node,
      },
    });
    return { msgType: 'PlanFragmentOffer', status: 'handled', detail: `accepted:${outcome.contractId}` };
  }

  // ── 凭证：存下来并**当场**校验（含快照比对）───────────────────────────

  /**
   * 收下随要约带来的**已双签合约副本**（复核第 2 项的本地来源）。
   *
   * 三条与「不采信平台口径」一致的做法：
   *  - 验签公钥**都不取自副本**：平台副署用部署配置的平台节点公钥，持有方签名用**登记表**里的公钥
   *    （且其 `kid` 必须等于条款里的 `provider_public_key_kid`）；
   *  - 任一条验不过就**整条丢弃**（不留半份副本）；
   *  - 副本缺失或签名不全**不算错**：复核会在第 2 项按「本地没有覆盖全部算子的副本」拒掉，
   *    这里不替它下结论（两处判据各自独立，避免互相掩盖）。
   */
  private storeContractCopies(raw: unknown): number {
    if (!Array.isArray(raw)) {
      this.logger.warn('PlanFragmentOffer 未随附 contracts 数组：本节点无法建立合约副本');
      return 0;
    }
    if (raw.length === 0)
      this.logger.warn('PlanFragmentOffer 的 contracts 数组为空：本节点无法建立合约副本');
    let stored = 0;
    for (const item of raw) {
      const copy = item as {
        contract_id?: unknown;
        canonical?: unknown;
        holder_signature?: unknown;
        platform_countersignature?: unknown;
      };
      const canonical = String(copy?.canonical ?? '');
      if (!canonical) continue;
      let provider = '';
      try {
        provider = String((JSON.parse(canonical) as { provider?: unknown })?.provider ?? '');
      } catch {
        continue;
      }
      const holderPublicKey = provider ? this.deps.participantPublicKey?.(provider) : undefined;
      if (!holderPublicKey) {
        this.logger.warn(
          `合约副本缺持有方登记公钥 contract=${String(copy?.contract_id ?? '')} provider=${provider || '(缺失)'}`,
        );
        continue;
      }
      try {
        this.deps.contracts.verifyAndStore({
          canonical,
          holderSignature: String(copy?.holder_signature ?? ''),
          platformCountersignature: String(copy?.platform_countersignature ?? ''),
          platformPublicKey: this.deps.platformPublicKey,
          holderPublicKey,
        });
        stored += 1;
      } catch (err) {
        // 验不过即丢（复核会以「本地没有可用副本」拒，不把「平台给的副本可疑」说成别的）。
        // 留一条不含条款原文/公钥的诊断：没有它，节点只会回一个笼统的 E_CONTRACT_UNSIGNED，
        // 运维无法区分“没下发”“平台副署不对”“持有方公钥登记不匹配”三种完全不同的故障。
        this.logger.warn(
          `合约副本验签未通过 contract=${String(copy.contract_id ?? '')} provider=${provider}：${
            (err as Error)?.message ?? '未知原因'
          }`,
        );
      }
    }
    this.logger.log(`合约副本验签存档：收到 ${raw.length} 份，通过 ${stored} 份`);
    return stored;
  }

  private async onTicketIssue(body: Record<string, unknown>): Promise<NodeMessageResult> {
    const ticket = parseExecutionTicket(body.ticket);
    const review = this.reviews.get(ticket.core.ticket_id);
    if (!review)
      throw new MdopError(
        'E_TICKET_INVALID',
        {},
        '本节点没有该凭证对应的已复核片段：不接受未复核的凭证',
      );
    await this.verifyTicket(ticket, review);
    this.tickets.set(ticket.core.ticket_id, ticket);
    return {
      msgType: 'ExecutionTicketIssue',
      status: 'handled',
      detail: ticket.core.ticket_id,
    };
  }

  // ── C2 信封：按**已复核片段里的 C2 入边**绑定到阶段（目标不从消息里猜）──

  private async onRelay(
    envelope: Envelope,
    body: Record<string, unknown>,
  ): Promise<NodeMessageResult> {
    const relay = body as unknown as C2RelayBody;
    const ticketId = String(relay.credential_id ?? '');
    const review = this.reviews.get(ticketId);
    if (!review)
      throw new MdopError(
        'E_TICKET_INVALID',
        {},
        `本节点没有凭证 ${ticketId} 的已复核片段：不接受未复核作业的 C2 信封`,
      );
    const holder = String(relay.holder ?? '');
    const stageId = bindRelayToStage(review, holder).stageId;

    // 目标阶段已经执行过：这份信封早被消费掉了。平台在收下成功状态之前还会重发它
    // （上报欠着的那段时间里每个重投间隔一次），这里不再缓冲——既不占内存，也不留一份待解封的密文。
    if (this.executed.get(`${ticketId}:${stageId}`))
      return { msgType: 'C2EnvelopeRelay', status: 'handled', detail: 'already-consumed' };

    // 去重按**持有方**：同一份信封重投是幂等的；换了 key_id 则是另一份信封（冲突即拒）
    const perTicket = this.envelopes.get(ticketId) ?? new Map<string, C2RelayBody>();
    this.envelopes.set(ticketId, perTicket);
    const existing = perTicket.get(holder);
    if (existing) {
      const sameKey =
        keyIdOf(existing) === keyIdOf(relay) && refOf(existing) === refOf(relay);
      if (!sameKey)
        throw new MdopError(
          'E_ENVELOPE_POLICY',
          {},
          `${holder} 同一作业送来了第二份不同的 C2 信封（key_id/密文引用不一致）`,
        );
      return { msgType: 'C2EnvelopeRelay', status: 'handled', detail: 'duplicate' };
    }
    perTicket.set(holder, relay);

    // 会合：派发指令已经在等这批信封 → 现在执行
    const key = `${ticketId}:${stageId}`;
    const stage = review.fragment.stages.find((s) => s.id === stageId);
    if (this.pendingDispatches.has(key) && stage && this.stageReady(ticketId, stage))
      return this.executeStage(key);
    return {
      msgType: 'C2EnvelopeRelay',
      status: 'deferred',
      detail: `buffered:${stageId}`,
    };
  }

  // ── 派发：信封齐了就执行，没齐就等（竞态不是失败）─────────────────────

  private async onStageDispatch(
    envelope: Envelope,
    body: Record<string, unknown>,
  ): Promise<NodeMessageResult> {
    const ticketId = String(body.ticket_id ?? '');
    const stageId = String(body.stage_id ?? '');
    const attempt = Number(body.attempt ?? 1);
    const key = `${ticketId}:${stageId}`;

    // 已执行过（含重启前执行的）：**不重跑**。平台只在收下成功状态之后才撤回这份指令，
    // 它重发就说明还在等——把还欠着的上报（句柄 / C3 / 见证 / 回执链 / 状态）接着做完。
    const done = this.executed.get(key);
    if (done) return this.resumeReports(done, { ticketId, stageId, attempt, envelope });

    const review = this.reviews.get(ticketId);
    if (!review)
      throw new MdopError('E_TICKET_INVALID', {}, `本节点没有凭证 ${ticketId} 的已复核片段`);
    const stage = review.fragment.stages.find((s) => s.id === stageId);
    if (!stage)
      throw new MdopError('E_TICKET_INVALID', {}, `本节点片段里没有阶段 ${stageId}`);

    this.pendingDispatches.set(key, { ticketId, stageId, attempt });
    if (!this.stageReady(ticketId, stage)) return this.waiting(envelope, stageId);
    return this.executeStage(key);
  }

  // ── 销毁：销毁本作业制品 + 签名回执（幂等，链上加 PURGED 事件）──────────

  private async onPurgeOrder(
    envelope: Envelope,
    body: Record<string, unknown>,
  ): Promise<NodeMessageResult> {
    const jobId = String(body.job_id ?? envelope.job_id ?? '');
    if (!jobId) throw new MdopError('E_RUNTIME', {}, 'PurgeOrder 缺 job_id');
    // 幂等键用平台那条指令的键：重复指令返回**同一份**回执（不产生两份不同内容的回执）
    const idempotencyKey = envelope.idempotency_key || `purge:${jobId}`;
    const receipt = this.deps.session.purge({
      jobId,
      reason: 'purge-order',
      idempotencyKey,
      now: this.now(),
    });
    // 制品已销毁：这个作业还欠着的上报一律作废（C3 **不可再投**），并立刻落盘——
    // 否则进程在回执发出之前被杀，重启后状态文件里的制品与欠账又都回来了。
    this.executed.markJobPurged(jobId);
    this.persist('销毁之后');
    await this.send('PurgeReceipt', {
      jobId,
      idempotencyKey: `purge-receipt:${jobId}`,
      body: receipt as unknown as Record<string, unknown>,
    });
    // 销毁事件也要上链：平台按「节点 + 作业」收链并校验连续性
    if (this.deps.receipts) await this.deps.receipts.report(jobId);
    this.deps.state?.persist();
    return {
      msgType: 'PurgeOrder',
      status: 'handled',
      detail: `purged:${receipt.handles.length}`,
    };
  }

  // ── 执行 ──────────────────────────────────────────────────────────────

  /**
   * 执行一个已到位的阶段。**执行前再验一次凭证**（协议 §7.5）：要约时的复核结论不够，
   * 平台重签过的核心、换过的快照都要在这里被抓住（`E_SNAPSHOT_CHANGED` / `E_TICKET_INVALID`）。
   */
  private async executeStage(key: string): Promise<NodeMessageResult> {
    const dispatch = this.pendingDispatches.get(key);
    if (!dispatch) throw new MdopError('E_RUNTIME', {}, '没有待执行的派发指令');
    const { ticketId, stageId, attempt } = dispatch;
    const review = this.reviews.get(ticketId);
    const ticket = this.tickets.get(ticketId);
    if (!review || !ticket)
      throw new MdopError('E_TICKET_INVALID', {}, '缺已复核片段或执行凭证，拒绝执行');
    const stage = review.fragment.stages.find((s) => s.id === stageId);
    if (!stage) throw new MdopError('E_TICKET_INVALID', {}, `本节点片段里没有阶段 ${stageId}`);

    const now = this.now();
    await this.verifyTicket(ticket, review, now);
    // 防呆：任何一条入边缺信封都不得进入解封（正常由会合保证，这里再判一次）
    if (!this.stageReady(ticketId, stage))
      throw new MdopError('E_ENVELOPE_POLICY', {}, `阶段 ${stageId} 的 C2 信封尚未齐`);

    const manifest = review.manifests.get(stage.op);
    if (!manifest)
      throw new MdopError('E_OP_NOT_WHITELISTED', {}, `本节点没有该算子的清单：${stage.op}`);
    const inbound = review.c2Inbound.filter((e) => e.stageId === stageId);
    const ctx = await this.deps.stageContext({
      jobId: ticket.core.job_id,
      credentialId: ticketId,
      stage,
      terms: review.terms,
      // 申请方来自**作业头**（复核时已验过用途），不拿节点自己冒充申请方——那会让差分查询检测失灵
      applicant: review.jobHeader.applicant?.org ?? '',
      ...(review.terms.pre_review_snapshot
        ? { snapshot: review.terms.pre_review_snapshot }
        : {}),
    });

    // 持有方登记公钥必须齐全：缺一家就不能验信封签名，也就不能解封
    const holderKeys = new Map<string, string>();
    for (const edge of inbound) {
      const key = ctx.holderPublicKey(edge.fromNode);
      if (!key)
        throw new MdopError('E_AUTH_INVALID', {}, `部署侧没有 ${edge.fromNode} 的登记公钥`);
      holderKeys.set(edge.fromNode, key);
    }

    const relays = inbound.length ? this.relaysFor(ticketId, stage, inbound) : [];
    const policy = inbound.length ? this.effectivePolicy(review) : undefined;
    const recorded: { entry?: ExecutedStageEntry } = {};
    const outcome = await dispatchNodeStage(
      this.dispatchDeps(),
      {
        jobId: ticket.core.job_id,
        credentialId: ticketId,
        contractId: review.contractId,
        stage: { ...stage, params: this.stageParamsFor(stage, inbound, relays) },
        manifest,
        minCell: minCellOf(stage, review.terms),
        budget: ctx.budget,
        ...(policy ? { policy } : {}),
        ...(review.expectation ? { expectation: review.expectation } : {}),
        ...(holderKeys.size ? { holderKeys } : {}),
        ...(relays.length ? { relays } : {}),
        // 出口判据（有无同节点下游）用**本节点复核过的片段**，不用消息里送来的任何东西
        fragment: review.fragment,
        originHolders: inbound.map((e) => e.fromNode),
        attempt,
        now,
      },
      {
        // 执行的副作用到此全部发生完（密钥已释放 / 发布审查与预算已做 / 产物已入制品库）。
        // **先登记并落盘，再做任何上报**：此后哪一条上报没送达、进程在上报途中被杀，
        // 重发的指令都只补欠着的那几步，不会把阶段再跑一遍。
        onExecuted: (executed) => {
          recorded.entry = this.executed.record({
            key,
            jobId: ticket.core.job_id,
            credentialId: ticketId,
            outcome: { ...executed.outcome, witnesses: 0, receipts: 0, delivered: false },
            statusReported: false,
            pending: executed.pending,
          });
          // 输入已被消费：派发指令与信封缓冲到此为止（执行失败时它们留着，等平台的下一个 attempt）
          this.pendingDispatches.delete(key);
          this.envelopes.delete(ticketId);
          this.persist('阶段执行完成');
        },
        onProgress: () => this.persist('上报进展'),
      },
    );

    if (recorded.entry) this.settle(recorded.entry, outcome);
    return {
      msgType: 'StageDispatch',
      status: 'handled',
      detail: `${outcome.label}:${outcome.handle}${reportingSuffix(outcome)}`,
      outcome,
    };
  }

  /**
   * 平台重发了一个**已执行**阶段的指令：只把还欠着的上报接着做完，绝不重跑。
   *
   * 重启后的进程也走这里——登记、制品库、回执链都从状态文件恢复；片段与凭证（只在内存里）
   * 用不着：这里不执行任何东西，只是把已经发生的事告诉平台。
   */
  private async resumeReports(
    done: ExecutedStageEntry,
    dispatch: { ticketId: string; stageId: string; attempt: number; envelope: Envelope },
  ): Promise<NodeMessageResult> {
    const replay = (detail: string, outcome: NodeStageOutcome = done.outcome): NodeMessageResult => ({
      msgType: 'StageDispatch',
      status: 'handled',
      detail,
      outcome,
    });
    // 作业已销毁：制品不在了，欠着的上报作废（C3 不可再投），也不再报成功
    if (done.purged) return replay('already-executed:purged');
    const pending = done.pending ?? {};
    if (done.statusReported && outstandingReports(pending).length === 0) return replay('already-executed');

    const onlyStatus = outstandingReports(pending).length === 0;
    const reporting = await resumeNodeStageReports(
      this.dispatchDeps(),
      {
        jobId: done.jobId || String(dispatch.envelope.job_id ?? ''),
        credentialId: done.credentialId ?? dispatch.ticketId,
        stageId: dispatch.stageId,
        attempt: dispatch.attempt,
        digest: done.outcome.digest,
        label: done.outcome.label,
        pending,
        statusReported: done.statusReported,
        now: this.now(),
      },
      { onProgress: () => this.persist('上报进展') },
    );
    const outcome = stageOutcome(done.outcome, pending, reporting, done.outcome);
    this.settle(done, outcome);
    if (reporting.complete) return replay('already-executed:status-reported', outcome);
    if (reporting.rejected) return replay(`already-executed:report-rejected(${reporting.rejected.step})`, outcome);
    return replay(
      onlyStatus ? 'already-executed:status-pending' : `already-executed${reportingSuffix(outcome)}`,
      outcome,
    );
  }

  /** 把一次上报尝试的结果记回登记并落盘（欠账清单已被原地划掉，这里补计数与状态位）。 */
  private settle(entry: ExecutedStageEntry, outcome: NodeStageOutcome): void {
    entry.outcome = {
      label: outcome.label,
      published: outcome.published,
      handle: outcome.handle,
      digest: outcome.digest,
      witnesses: outcome.witnesses,
      receipts: outcome.receipts,
      delivered: outcome.delivered,
    };
    if (outcome.statusReported) entry.statusReported = true;
    if (entry.pending && outstandingReports(entry.pending).length === 0) delete entry.pending;
    this.persist('上报结果');
  }

  private dispatchDeps(): NodeStageDispatchDeps {
    return {
      node: this.deps.node,
      session: this.deps.session,
      artifacts: this.deps.artifacts,
      contracts: this.deps.contracts,
      platformPublicKey: this.deps.platformPublicKey,
      outbound: this.deps.outbound,
      platform: this.deps.platform,
      declassify: this.deps.declassify,
      ...(this.deps.receipts ? { receipts: this.deps.receipts } : {}),
      ...(this.deps.state ? { state: this.deps.state } : {}),
    };
  }

  /**
   * 落盘。失败只告警、不抛出：登记已经在内存里（本进程内不会重跑），而上报不该因为
   * 一次写盘失败停下来。**但这条告警要当真**——写不进盘，进程重启后就认不出这一段跑过了。
   */
  private persist(when: string): void {
    try {
      this.deps.state?.persist();
    } catch (err) {
      this.logger.error(`节点状态落盘失败（${when}）：${(err as Error).message}`);
    }
  }

  // ── 判据与工具 ────────────────────────────────────────────────────────

  /** 本阶段的封存输入是否已全部到位（没有 C2 入边＝本地输入阶段，直接算到位）。 */
  private stageReady(ticketId: string, stage: PhysicalStage): boolean {
    const inbound = this.reviews.get(ticketId)?.c2Inbound.filter((e) => e.stageId === stage.id) ?? [];
    if (inbound.length === 0) return true;
    const buffered = this.envelopes.get(ticketId);
    return inbound.every((e) => buffered?.has(e.fromNode));
  }

  private waiting(envelope: Envelope, stageId: string): NodeMessageResult {
    // **不是失败**：平台的两条下行消息（中继与派发）没有先后保证，先到的这条只登记。
    // 报 FAILED 会把正常竞态误判成节点故障，并触发平台退避重试。
    return {
      msgType: envelope.msg_type,
      status: 'deferred',
      detail: `waiting-envelopes:${stageId}`,
    };
  }

  /**
   * 按 `stage.inputs` 的顺序取出信封：每条入边一家持有方，与已复核片段**逐条对齐**。
   * 顺序确定性来自片段本身（不是消息到达顺序），因此同一份计划重复执行结论一致。
   */
  private relaysFor(
    ticketId: string,
    stage: PhysicalStage,
    inbound: NodeFragmentReviewOutcome['c2Inbound'],
  ): C2RelayBody[] {
    const buffered = this.envelopes.get(ticketId) ?? new Map<string, C2RelayBody>();
    return stage.inputs.map((input) => {
      const edge = inbound.find((e) => e.fromStage === input.from);
      if (!edge)
        throw new MdopError(
          'E_CAPABILITY_MISMATCH',
          { edge: `${input.from}->${stage.id}` },
          '本阶段的输入没有对应的 C2 入边，无法绑定信封',
        );
      const relay = buffered.get(edge.fromNode);
      if (!relay)
        throw new MdopError(
          'E_ENVELOPE_POLICY',
          { edge: `${input.from}->${stage.id}` },
          `持有方 ${edge.fromNode} 的 C2 信封尚未到位`,
        );
      return relay;
    });
  }

  /**
   * 阶段参数：把收到的信封**按入边**绑成算子的输入参数（如跨院配对的 `parties`）。
   *
   * 这是「谁的数据喂给哪个输入」的绑定，只能来自本地事实（已复核片段的入边 + 信封自身），
   * MUST NOT 采信消息里自述的目标。
   */
  private stageParamsFor(
    stage: PhysicalStage,
    inbound: NodeFragmentReviewOutcome['c2Inbound'],
    relays: readonly C2RelayBody[],
  ): Record<string, unknown> {
    const params: Record<string, unknown> = { ...stage.params };
    if (relays.length === 0) return params;
    params.parties = stage.inputs.map((input, index) => {
      const edge = inbound.find((e) => e.fromStage === input.from)!;
      return { ref: refOf(relays[index]), node: edge.fromNode };
    });
    return params;
  }

  /** 生效证明策略：合约策略 ∩ 注册中心度量白名单（两侧都只取本地已知的事实）。 */
  private effectivePolicy(review: NodeFragmentReviewOutcome): AttestationPolicy | undefined {
    const base = review.terms.attestation_policy;
    if (!base) return undefined;
    const effective = resolveMeasurementWhitelist({
      registryWhitelist: this.deps.review.registryMeasurements,
      policy: base,
    });
    return { ...base, allowed_measurements: effective };
  }

  /**
   * 凭证校验（含**重算快照**比对）。
   *
   * 快照要用**当下**的能力通告重算：换算子摘要、换期望、或本节点自己的链型/可信基变了，
   * 都会与接受时签入的值对不上 → `E_SNAPSHOT_CHANGED`（作业须重新要约）。
   */
  private async verifyTicket(
    ticket: ExecutionTicket,
    review: NodeFragmentReviewOutcome,
    now = this.now(),
  ): Promise<void> {
    const capability = await this.deps.review.capability();
    verifyTicketForExecution({
      ticket,
      node: this.deps.node,
      fragment: review.fragment,
      nodePublicKey: this.deps.identity.publicKey,
      platformPublicKey: this.deps.platformPublicKey,
      platformParty: this.deps.platform,
      now,
      recomputedSnapshot: nodeEnvironmentSnapshot(review.fragment, review.expectation, capability),
    });
  }

  private async send(
    msgType: 'PlanFragmentAccept' | 'PlanFragmentReject' | 'PurgeReceipt',
    input: { jobId: string; idempotencyKey: string; body: Record<string, unknown> },
  ): Promise<void> {
    await this.deps.outbound.sendMessage(
      this.deps.outbound.buildEnvelope({
        msgType,
        jobId: input.jobId,
        receiver: this.deps.platform,
        idempotencyKey: input.idempotencyKey,
        body: input.body,
      }),
    );
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/**
 * 阶段的最小发布阈值：取**合约 `publication.minCell` 与阶段参数 `minCell` 的较大值**。
 *
 * 参数不得弱于合约（与降密算子 `declassify-op.ts` 同一条规矩）：阶段参数来自计划（申请方可写），
 * 合约阈值来自持有方签过的本地副本。此前是「参数优先」——单阶段出口路径（会话内自审，不经降密算子）
 * 上，一个比合约小的阶段参数就能把阈值压下去。参数只能把阈值**抬高**，抬不低。
 * 两边都没有有效值时返回 0，由发布审查按「缺 minCell」拒（fail-closed）。
 */
function minCellOf(stage: PhysicalStage, terms: MdopContract): number {
  const positive = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return Math.max(positive(terms.publication.minCell), positive(stage.params.minCell));
}

/**
 * 把一封 C2 信封绑定到它在**已复核片段**里的目标阶段（目标不从消息猜、不从消息取）。
 *
 * 信封本身只有 `aad`（作业/凭证/合约）与 `origin_sig.signer`，没有「来自哪个阶段」的字段，
 * 因此绑定只能靠片段里的**入边**：`from_node === 信封签署方`。同一持有方有两条 C2 入边时
 * **无法唯一定位**——与其猜（猜错就是把甲的数据当乙的用），不如拒：本期只支持「一家一条」。
 */
export function bindRelayToStage(
  review: NodeFragmentReviewOutcome,
  holder: string,
): C2InboundEdge {
  const inbound = review.c2Inbound.filter((e) => e.fromNode === holder);
  if (inbound.length === 0)
    throw new MdopError(
      'E_CAPABILITY_MISMATCH',
      {},
      `${holder} 不是本节点在该作业里登记的 C2 来源（入边为空）`,
    );
  if (inbound.length > 1)
    throw new MdopError(
      'E_CAPABILITY_MISMATCH',
      {},
      `${holder} 在本节点有 ${inbound.length} 条 C2 入边，无法把信封唯一绑定到阶段输入`,
    );
  return inbound[0];
}

/** 信封的密钥标识（去重与冲突判定用）。 */
function keyIdOf(relay: C2RelayBody): string {
  const envelope = relay.data_envelope as { wrapped_key?: { key_id?: string } } | undefined;
  return String(envelope?.wrapped_key?.key_id ?? '');
}

/** 信封的密文引用（阶段输入绑定的键）。 */
function refOf(relay: C2RelayBody): string {
  const envelope = relay.data_envelope as { payload?: { ciphertext_ref?: string } } | undefined;
  return String(envelope?.payload?.ciphertext_ref ?? '');
}


/** 结果说明的后缀：上报没做完时列出还欠着的步骤（做完了就是空串）。 */
function reportingSuffix(outcome: NodeStageOutcome): string {
  if (outcome.reportRejected) return `:report-rejected(${outcome.reportRejected.step})`;
  if (outcome.pendingReports?.length) return `:reports-pending(${outcome.pendingReports.join(',')})`;
  return '';
}
