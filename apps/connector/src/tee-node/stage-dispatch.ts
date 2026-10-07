import {
  Logger,
} from '@nestjs/common';
import {
  MdopError,
  parseFragment,
  type AttestationExpectation,
  type AttestationPolicy,
  type FlowLabel,
  type PhysicalStage,
} from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';
import type { BudgetKey, BudgetPolicy } from '../mdop/node/budget-ledger';
import type { NodeArtifactStore } from '../mdop/node/node-artifacts';
import type { TrustedNodeSession } from '../mdop/node/node-session';
import { handleExpiry } from './c3-delivery';
import type { NodeContractStore } from './contract-store';
import type { NodeDeclassifyRegistration } from './declassify-op';
import type { NodeReceiptReporter } from './receipt-report';
import { executeRelayedStage, type C2RelayBody } from './relay-receive';
import {
  finishStageReporting,
  publishedC3Source,
  type PendingStageReports,
  type StageArtifactRef,
  type StageReportDeps,
  type StageReportStep,
  type StageReportingResult,
} from './stage-reports';
import { reportNodeStageStatus } from './stage-status';

const logger = new Logger('NodeStageDispatch');

/**
 * 节点侧的**阶段派发器**（任务 3.12d）：平台逐阶段下发（`StageDispatch`），节点按阶段类型选落点。
 *
 *   有 C2 信封的阶段（`pair` 这种吃持有方封存数据的阶段）
 *     → `receiveRelayedEnvelope`：证明 → 入口守卫 → KMS 释放 → 解封 → 节点内执行；
 *   输入是本节点制品的阶段（`decTee` 这种接着算的阶段）
 *     → 从**本节点制品库**取上游 → 执行 → （要出口时）发布审查 → 出口 → 投递。
 *
 * **出口与否只看一件事：本阶段产物有没有同节点的下游**（`hasSameNodeDownstream`）。
 * 有下游＝节点内的中间产物，必须留在节点内（C2 是入口形态，不是出口形态）；没有下游＝本节点
 * 为该作业的终点产出，才走发布审查与出口。这条判据完全来自**片段**（平台编译产物），
 * 不新增协议字段、不从消息里的自述取任何东西。
 *
 * 如实边界：这是**库级装配**（可被守护进程/CLI 调用，用例覆盖两阶段全流程），
 * 节点守护进程的长驻循环与注册/心跳接线仍属部署动作（tasks §3.13 / §3.14）。
 */

export interface NodeStageDispatchDeps {
  /** 本节点身份（参与方 URN）。 */
  node: string;
  session: TrustedNodeSession;
  /** 本节点制品库（中间制品与最终 C3 都落这里）。 */
  artifacts: NodeArtifactStore;
  contracts: NodeContractStore;
  /** 部署配置里的平台节点公钥（核验合约副署；MUST NOT 取自消息）。 */
  platformPublicKey: string;
  outbound: MdopOutboundClient;
  /** 平台 URN（C3 与见证的接收方）。 */
  platform: string;
  /** 降密算子的发布审查记录来源（出口造随行清单用）。 */
  declassify: NodeDeclassifyRegistration;
  receipts?: NodeReceiptReporter;
  state?: { persist(): unknown };
}

export interface NodeStageDispatchInput {
  jobId: string;
  credentialId: string;
  contractId: string;
  stage: PhysicalStage;
  manifest: unknown;
  minCell: number;
  budget: { key: BudgetKey; policy: BudgetPolicy; cost: number; applicant: string };
  /** C2 会话所需：生效证明策略（注册中心白名单 ∩ 合约）。**只在 `relays` 存在时必需**。 */
  policy?: AttestationPolicy;
  /** C2 会话所需：凭证里为本节点冻结的执行环境期望（缺省即拒收 C2 输入）。 */
  expectation?: AttestationExpectation;
  /** C2 会话所需：持有方（信封签署方）的登记公钥表。 */
  holderKeys?: Map<string, string>;
  /**
   * 本阶段要吃的 C2 信封（持有方封好、平台中继来的）；**没有**就是吃本节点制品。
   * 跨院配对这类阶段有**多条**（每个持有方一条）：齐了才跑，一次会话解封全部输入。
   */
  relays?: C2RelayBody[];
  /** 首次见到该合约时随中继带来的副本（双签；判据与中继路径完全一致）。 */
  contractCopy?: { canonical: string; holderSignature: string; platformCountersignature: string };
  /**
   * 本节点的**片段**（平台编译产物）：出口判据（有无同节点下游）从这里算。
   * 不给就按「本阶段即终点产出」处理（缺省 publish），用于单阶段与历史夹具。
   */
  fragment?: unknown;
  /** 解封阶段的原始持有方（出口守卫 R5 用）——由解封阶段推出，**不从消息里取**。 */
  originHolders?: readonly string[];
  /** 平台下发该阶段时给的 attempt（状态上报的幂等键要一致；缺省 1）。 */
  attempt?: number;
  now?: Date;
}

export interface NodeStageOutcome {
  /** 产物等级：`C3`（已出口投递）或 `C2`/`C0`（留在节点本地）。 */
  label: FlowLabel;
  published: boolean;
  handle: string;
  digest: string;
  /** 本次上报的会话见证条数（**本地阶段为 0**：本阶段没有密钥释放，释放发生在解封阶段）。 */
  witnesses: number;
  /** 本次上报的回执条数（平台据此校链与锚定）。 */
  receipts: number;
  delivered: boolean;
  /**
   * 成功状态是否已被平台收下（`dispatchNodeStage` 填写）。`false` = 阶段**已经执行完**、
   * 只是上报还没做完——调用方 MUST 把阶段记为已执行并在平台重发指令时补报，MUST NOT 重跑。
   */
  statusReported?: boolean;
  /** 还欠着的上报步骤（`dispatchNodeStage` 填写；全部送达时不带）。 */
  pendingReports?: StageReportStep[];
  /** 停在哪一步、为什么（没送到，等重发再补）。 */
  reportStalled?: StageReportingResult['stalled'];
  /** 哪一步被拒（已按阶段失败上报，未重跑）。 */
  reportRejected?: StageReportingResult['rejected'];
}

/**
 * 阶段**执行完**（副作用已发生、产物已入节点制品库）但**尚未上报**时的结果。
 * `pending` 是还欠平台的上报清单——调用方应当**先把它登记落盘**，再去做上报。
 */
export interface ExecutedNodeStage {
  outcome: Pick<NodeStageOutcome, 'label' | 'published' | 'handle' | 'digest'>;
  pending: PendingStageReports;
}

/** `dispatchNodeStage` 在两个时点回调调用方（消息路由器借此登记并落盘）。 */
export interface NodeStageDispatchHooks {
  /**
   * 执行刚完成、**任何上报之前**。从这一刻起阶段不得再被执行——调用方 MUST 在这里把它登记为
   * 已执行并落盘（连同 `executed.pending`；该对象会随上报进展被原地划掉）。
   */
  onExecuted?(executed: ExecutedNodeStage): void;
  /** 每送达一项上报之后（调用方落盘，使进展不随进程丢失）。 */
  onProgress?(): void;
}

/** 节点内中间制品与最终产物的**统一句柄口径**（解封阶段与本地阶段都用它）。 */
export function localArtifactHandle(node: string, jobId: string, stageId: string): string {
  return `art://${node}/${jobId}/${stageId}`;
}

/**
 * 本阶段产物是否**还有同节点的下游**（＝必须留在节点内，不得出口）。
 *
 * 判据只取片段里的结构事实：`stages[].inputs[].from === stageId` 且 `node === 本节点`。
 * 片段非法（缺字段、多余字段）→ `parseFragment` 抛错——**fail-closed**，不当成「没有下游」。
 */
export function hasSameNodeDownstream(fragment: unknown, stageId: string, node: string): boolean {
  const parsed = parseFragment(fragment);
  return parsed.stages.some(
    (candidate) => candidate.node === node && candidate.inputs.some((edge) => edge.from === stageId),
  );
}

/**
 * 派发一个阶段：**执行 → 回调调用方登记 → 上报**。返回值的 `label` 说明这一阶段的落点：
 * `C3` 走出口并投递；`C2`/`C0` 留在节点内，供下游阶段取用。
 *
 * 失败分两种，处理完全不同：
 *  - **执行失败**（抛出）：阶段没有产出。照旧出站报 `FAILED`，平台按错误码决定退避重试或让作业失败；
 *  - **执行成功、上报没做完**（不抛出）：副作用已经发生、不可重来。返回值里 `statusReported=false`
 *    并列出 `pendingReports`，由调用方在平台重发指令时用 {@link resumeNodeStageReports} 接着补——
 *    绝不重跑（重跑＝再向保管方要一次钥匙、再做一次发布审查、再扣一次预算）。
 */
export async function dispatchNodeStage(
  deps: NodeStageDispatchDeps,
  input: NodeStageDispatchInput,
  hooks: NodeStageDispatchHooks = {},
): Promise<NodeStageOutcome> {
  const attempt = input.attempt ?? 1;
  let executed: ExecutedNodeStage;
  try {
    executed = await executeNodeStage(deps, input);
  } catch (err) {
    // 失败也要出站：平台靠 `StageStatus` 分「可重试 / 不可重试」并决定是否重发（§7.6），
    // 不报状态就等于让作业永远卡在这一阶段。
    const code = err instanceof MdopError ? err.code : 'E_RUNTIME';
    await reportNodeStageStatus(statusDeps(deps), {
      jobId: input.jobId,
      stageId: input.stage.id,
      credentialId: input.credentialId,
      attempt,
      status: 'FAILED',
      code,
      message: (err as Error).message,
    }).catch((sendErr) =>
      logger.warn(`阶段失败状态上报失败 job=${input.jobId} stage=${input.stage.id}：${(sendErr as Error).message}`),
    );
    throw err;
  }

  // 执行的副作用到此全部发生完。**先让调用方登记落盘，再碰网络**：之后任何一条上报失败、
  // 或进程在上报途中被杀，重发的指令都只补欠着的上报。
  hooks.onExecuted?.(executed);

  const reporting = await resumeNodeStageReports(
    deps,
    {
      jobId: input.jobId,
      credentialId: input.credentialId,
      stageId: input.stage.id,
      attempt,
      digest: executed.outcome.digest,
      label: executed.outcome.label,
      pending: executed.pending,
      statusReported: false,
      ...(input.now ? { now: input.now } : {}),
    },
    hooks,
  );
  try {
    deps.state?.persist();
  } catch (err) {
    // 阶段已执行、上报已尽力：写盘失败不该把这一切说成「阶段失败」，但必须留痕
    logger.error(`节点状态落盘失败 job=${input.jobId} stage=${input.stage.id}：${(err as Error).message}`);
  }
  return stageOutcome(executed.outcome, executed.pending, reporting);
}

/**
 * 把一个**已执行**阶段还欠着的上报做完（首次上报与「指令重发后补报」是同一段代码）。
 * 顺序固定：句柄登记 → C3 投递 → 会话见证 → 回执链 → 成功状态；成功状态**放在最后**——
 * 平台一侧是「收到 C3 投递即合并、收到阶段成功即推进下游并撤回指令」，先后反了会让合并先于载荷
 * 到达而空转一轮，更会让节点失去「指令重发」这个补报的机会。
 */
export async function resumeNodeStageReports(
  deps: NodeStageDispatchDeps,
  input: {
    jobId: string;
    credentialId: string;
    stageId: string;
    attempt: number;
    digest: string;
    label: FlowLabel;
    pending: PendingStageReports;
    statusReported: boolean;
    now?: Date;
  },
  hooks: Pick<NodeStageDispatchHooks, 'onProgress'> = {},
): Promise<StageReportingResult> {
  const reportDeps: StageReportDeps = {
    outbound: deps.outbound,
    platform: deps.platform,
    ...(deps.receipts ? { receipts: deps.receipts } : {}),
    // C3 载荷只从**本节点制品库**取，并核对出口记录（首投与补投同一条路、同一份判据）
    c3Payload: publishedC3Source({
      artifacts: deps.artifacts,
      ...(deps.receipts ? { receipts: deps.receipts } : {}),
      ...(input.now ? { now: () => input.now as Date } : {}),
    }),
  };
  const result = await finishStageReporting(reportDeps, {
    jobId: input.jobId,
    credentialId: input.credentialId,
    stageId: input.stageId,
    attempt: input.attempt,
    digest: input.digest,
    label: input.label,
    pending: input.pending,
    statusReported: input.statusReported,
    ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}),
  });
  const where = `job=${input.jobId} stage=${input.stageId}`;
  if (result.rejected)
    logger.error(
      `阶段已执行完成，但上报被拒（未重跑）${where}：${result.rejected.message}` +
        (result.rejected.failureReported ? '' : '；失败状态也没送到，待指令重发时再报'),
    );
  else if (result.stalled)
    logger.warn(
      `阶段已执行完成，上报未做完（未重跑，待平台重发指令时接着补）${where} ` +
        `欠=${result.outstanding.join(',')}：${result.stalled.message}`,
    );
  return result;
}

/** 合成对外的阶段结果（核心事实来自执行，计数与进展来自本次上报）。 */
export function stageOutcome(
  core: ExecutedNodeStage['outcome'],
  pending: PendingStageReports,
  reporting: StageReportingResult,
  previous?: Pick<NodeStageOutcome, 'witnesses' | 'receipts'>,
): NodeStageOutcome {
  return {
    ...core,
    witnesses: (previous?.witnesses ?? 0) + reporting.witnesses,
    receipts: (previous?.receipts ?? 0) + reporting.receipts,
    // 「已投递」只对出口产物有意义：出口了、且 C3 投递不再欠着
    delivered: core.published && !pending.delivery,
    statusReported: reporting.statusReported,
    ...(reporting.outstanding.length ? { pendingReports: reporting.outstanding } : {}),
    ...(reporting.stalled ? { reportStalled: reporting.stalled } : {}),
    ...(reporting.rejected ? { reportRejected: reporting.rejected } : {}),
  };
}

/**
 * **只执行、不上报**（信封阶段走会话、本地阶段走本节点制品）。返回时副作用已全部发生、
 * 产物已入节点制品库；函数里没有任何出站请求。
 */
export async function executeNodeStage(
  deps: NodeStageDispatchDeps,
  input: NodeStageDispatchInput,
): Promise<ExecutedNodeStage> {
  const keepLocal =
    input.fragment !== undefined && hasSameNodeDownstream(input.fragment, input.stage.id, deps.node);

  if (input.relays?.length) {
    // C2 会话的三件本地事实缺一不可：生效策略、凭证里冻结的期望、持有方登记公钥。
    // 缺任一项即拒（fail-closed）——「先解封、后面再补校验」在这里没有路径。
    if (!input.policy || !input.expectation || !input.holderKeys || input.holderKeys.size === 0)
      throw new MdopError(
        'E_ATTESTATION_FAILED',
        {},
        'C2 阶段缺生效策略/执行环境期望/持有方登记公钥：不得解封',
      );
    const executed = await executeRelayedStage(
      {
        session: deps.session,
        outbound: deps.outbound,
        platform: deps.platform,
        contracts: deps.contracts,
        platformPublicKey: deps.platformPublicKey,
        artifacts: deps.artifacts,
        ...(deps.receipts ? { receipts: deps.receipts } : {}),
        ...(deps.state ? { state: deps.state } : {}),
      },
      {
        jobId: input.jobId,
        credentialId: input.credentialId,
        relays: input.relays,
        contractId: input.contractId,
        ...(input.contractCopy ? { contractCopy: input.contractCopy } : {}),
        policy: input.policy,
        expectation: input.expectation,
        holderKeys: input.holderKeys,
        stage: input.stage,
        manifest: input.manifest,
        minCell: input.minCell,
        budget: input.budget,
        publish: !keepLocal,
        ...(input.now ? { now: input.now } : {}),
      },
    );
    return {
      outcome: {
        label: executed.label,
        published: executed.published,
        handle: executed.handle,
        digest: executed.digest,
      },
      pending: executed.pending,
    };
  }

  return runLocalStage(deps, input, keepLocal);
}

/**
 * **本地输入阶段**：上游是本节点制品库里的中间制品（不是信封）。只执行、不上报。
 *
 * 出口只可能发生在「产物是 C3 且没有同节点下游」时；此时必须要有一份**发布审查记录**
 * （由 `declassify.small_cell` 算子产生）。没有记录就拒——**未经节点内审查不得出口**，
 * 不存在「先出口，审查以后补」的路径。出口（`session.publish`）把 C3 存进节点制品库并写下
 * `EXITED` 回执；之后的投递（含补投）只认那一份（见 `stage-reports.ts#publishedC3Source`）。
 */
async function runLocalStage(
  deps: NodeStageDispatchDeps,
  input: NodeStageDispatchInput,
  keepLocal: boolean,
): Promise<ExecutedNodeStage> {
  const terms = deps.contracts.requireForSession(input.contractId);
  if (!terms.recipients.includes(deps.platform))
    throw new MdopError('E_LABEL_VIOLATION', {}, '合约接收方列表里没有 C3 交付目标');

  // 上游按**统一句柄口径**取：`art://<node>/<job>/<上游阶段>`（解封阶段存下的就是它）
  const upstream = new Map<string, Record<string, unknown>>();
  for (const edge of input.stage.inputs) {
    const handle = localArtifactHandle(deps.node, input.jobId, edge.from);
    const record = deps.artifacts.read(handle);
    if (!record)
      throw new MdopError(
        'E_RUNTIME',
        {},
        `上游制品不在本节点（${edge.from} → ${handle}）：本地阶段只吃本节点内已执行阶段的产物`,
      );
    upstream.set(edge.from, record.payload);
  }

  // 合约条款：system 算子读发布条件用（如降密的 minCell），只从**验过的本地副本**取
  const copy = deps.contracts.get(input.contractId);
  let termsJson: Record<string, unknown> | undefined;
  if (copy) {
    try {
      termsJson = JSON.parse(copy.canonical) as Record<string, unknown>;
    } catch {
      throw new MdopError('E_CONTRACT_UNSIGNED', {}, '本地合约副本不是合法 JSON，拒绝执行');
    }
  }

  // 执行走**会话**（不是裸执行器）：本地阶段同样要在证明之后执行、并对执行留痕（EXECUTED 回执）
  const localStage = await deps.session.executeLocalStage({
    jobId: input.jobId,
    stage: input.stage,
    inputs: upstream,
    manifest: input.manifest,
    ...(termsJson ? { contractTerms: { ...termsJson, credential_id: input.credentialId } } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const output = localStage.output;

  const handle = localArtifactHandle(deps.node, input.jobId, input.stage.id);
  const now = input.now ?? new Date();
  const stageRef = {
    id: input.stage.id,
    op: input.stage.op,
    op_digest: input.stage.op_digest,
    output_schema: input.stage.output_schema,
  };
  const receipts: Pick<PendingStageReports, 'receipts'> = deps.receipts ? { receipts: true } : {};

  if (!keepLocal && output.label === 'C3') {
    const record = deps.declassify.recordFor(input.jobId, input.stage.id);
    if (!record)
      throw new MdopError(
        'E_RELEASE_CHECK_FAILED',
        {},
        `阶段 ${input.stage.id} 产出 C3 但没有发布审查记录：未经节点内审查的产物不得出口`,
      );
    const published = await deps.session.publish({
      jobId: input.jobId,
      credentialId: input.credentialId,
      contractId: terms.contract_id,
      stage: input.stage,
      reviewed: { payload: output.payload, review: record },
      budget: input.budget,
      target: deps.platform,
      contractRecipients: terms.recipients,
      originHolders: input.originHolders ?? [],
      // 同一段的证明与执行凭据共用：EXECUTED 与 EXITED 的证明摘要因此对得上
      session: { report: localStage.report, attestation: localStage.attestation, releases: [] },
      ...(input.now ? { now: input.now } : {}),
    });
    const ref: StageArtifactRef = {
      stage: stageRef,
      handle: published.handle,
      label: 'C3',
      digest: published.digest,
      expiresAt: handleExpiry(now),
    };
    return {
      outcome: { label: 'C3', published: true, handle: published.handle, digest: published.digest },
      // 本地阶段没有密钥释放 → 没有会话见证；释放那一次的见证在解封阶段已上报
      pending: { handle: ref, delivery: ref, ...receipts },
    };
  }

  // 中间产物：入本节点制品库（不出口、不投递载荷），下游阶段按同一句柄取用
  deps.artifacts.put({
    handle,
    jobId: input.jobId,
    label: output.label,
    digest: output.digest,
    payload: output.payload,
    expiresAt: new Date(now.getTime() + 72 * 3_600_000).toISOString(),
  });
  return {
    outcome: { label: output.label, published: false, handle, digest: output.digest },
    pending: {
      // **C0 制品不得出现对外句柄**（规格「登记节点内的 C0 句柄」）：解封后的明细只留在节点内，
      // 连句柄都不对外登记——登记一个 C0 句柄本身就是一次「这里有明细制品」的泄露面。
      // C2 中间制品相反：它本来就是跨节点形态（协议要求两侧都登记句柄），所以照常登记。
      ...(output.label === 'C2'
        ? {
            handle: {
              stage: stageRef,
              handle,
              label: output.label,
              digest: output.digest,
              expiresAt: handleExpiry(now),
            },
          }
        : {}),
      ...receipts,
    },
  };
}

function statusDeps(deps: NodeStageDispatchDeps): { outbound: MdopOutboundClient; platform: string } {
  return { outbound: deps.outbound, platform: deps.platform };
}
