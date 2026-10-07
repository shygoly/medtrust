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
import { deliverC3Payload, handleExpiry, registerArtifactHandle } from './c3-delivery';
import type { NodeContractStore } from './contract-store';
import type { NodeDeclassifyRegistration } from './declassify-op';
import type { NodeReceiptReporter } from './receipt-report';
import { runRelayedStage, type C2RelayBody } from './relay-receive';
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
   * 只是这条状态没送到——调用方 MUST 把阶段记为已执行并在平台重发指令时补报，MUST NOT 重跑。
   */
  statusReported?: boolean;
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
 * 派发一个阶段。返回值的 `label` 说明这一阶段的落点：
 * `C3` 已投递；`C2`/`C0` 留在节点内，供下游阶段取用。
 */
export async function dispatchNodeStage(
  deps: NodeStageDispatchDeps,
  input: NodeStageDispatchInput,
): Promise<NodeStageOutcome> {
  const attempt = input.attempt ?? 1;
  let outcome: NodeStageOutcome;
  try {
    outcome = await dispatchOnce(deps, input);
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
  // 成功状态**放在投递之后**：平台一侧是「收到 C3 投递即合并、收到阶段成功即推进下游」，
  // 先后反了会让合并先于载荷到达而空转一轮。
  //
  // **上报失败不抛出**：到这里阶段已经执行完（密钥已释放、预算已扣、C3 已投递），这些都不可重来。
  // 抛出会让调用方把它当成「没执行」，下一轮长轮询整段重跑——多要一次密钥、多扣一次预算、
  // 用另一个摘要覆盖已交付的 C3。如实返回 `statusReported: false`，由调用方登记并在重发时补报。
  const statusReported = await reportNodeStageStatus(statusDeps(deps), {
    jobId: input.jobId,
    stageId: input.stage.id,
    credentialId: input.credentialId,
    attempt,
    status: 'SUCCEEDED',
    digest: outcome.digest,
    label: outcome.label,
  }).then(
    () => true,
    (sendErr) => {
      logger.warn(
        `阶段成功状态上报失败（阶段已执行完，待平台重发指令时补报）job=${input.jobId} stage=${input.stage.id}：${(sendErr as Error).message}`,
      );
      return false;
    },
  );
  return { ...outcome, statusReported };
}

/** 一次派发（信封阶段走会话、本地阶段走本节点制品）——状态上报包在外面。 */
async function dispatchOnce(
  deps: NodeStageDispatchDeps,
  input: NodeStageDispatchInput,
): Promise<NodeStageOutcome> {
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
    const outcome = await runRelayedStage(
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
      label: outcome.label,
      published: outcome.published,
      handle: outcome.handle,
      digest: outcome.digest,
      witnesses: outcome.witnesses,
      receipts: outcome.receipts,
      delivered: outcome.delivered,
    };
  }

  return runLocalStage(deps, input, keepLocal);
}

/**
 * **本地输入阶段**：上游是本节点制品库里的中间制品（不是信封）。
 *
 * 出口只可能发生在「产物是 C3 且没有同节点下游」时；此时必须要有一份**发布审查记录**
 * （由 `declassify.small_cell` 算子产生）。没有记录就拒——**未经节点内审查不得出口**，
 * 不存在「先出口，审查以后补」的路径。
 */
async function runLocalStage(
  deps: NodeStageDispatchDeps,
  input: NodeStageDispatchInput,
  keepLocal: boolean,
): Promise<NodeStageOutcome> {
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
    const outbound = deliveryDeps(deps);
    const now = input.now ?? new Date();
    await registerArtifactHandle(outbound, {
      jobId: input.jobId,
      credentialId: input.credentialId,
      stage: input.stage,
      handle: published.handle,
      label: 'C3',
      digest: published.digest,
      expiresAt: handleExpiry(now),
    });
    await deliverC3Payload(outbound, {
      jobId: input.jobId,
      credentialId: input.credentialId,
      stage: input.stage,
      handle: published.handle,
      label: 'C3',
      digest: published.digest,
      expiresAt: handleExpiry(now),
      payload: published.c3,
    });
    const receipts = deps.receipts ? await deps.receipts.report(input.jobId) : 0;
    deps.state?.persist();
    return {
      label: 'C3',
      published: true,
      handle: published.handle,
      digest: published.digest,
      // 本地阶段没有密钥释放 → 没有会话见证；释放那一次的见证在解封阶段已上报
      witnesses: 0,
      receipts,
      delivered: true,
    };
  }

  // 中间产物：入本节点制品库（不出口、不投递载荷），下游阶段按同一句柄取用
  const now = input.now ?? new Date();
  deps.artifacts.put({
    handle,
    jobId: input.jobId,
    label: output.label,
    digest: output.digest,
    payload: output.payload,
    expiresAt: new Date(now.getTime() + 72 * 3_600_000).toISOString(),
  });
  // **C0 制品不得出现对外句柄**（规格「登记节点内的 C0 句柄」）：解封后的明细只留在节点内，
  // 连句柄都不对外登记——登记一个 C0 句柄本身就是一次「这里有明细制品」的泄露面。
  // C2 中间制品相反：它本来就是跨节点形态（协议要求两侧都登记句柄），所以照常登记。
  if (output.label === 'C2')
    await registerArtifactHandle(deliveryDeps(deps), {
      jobId: input.jobId,
      credentialId: input.credentialId,
      stage: input.stage,
      handle,
      label: output.label,
      digest: output.digest,
      expiresAt: handleExpiry(now),
    });
  const receipts = deps.receipts ? await deps.receipts.report(input.jobId) : 0;
  deps.state?.persist();
  return {
    label: output.label,
    published: false,
    handle,
    digest: output.digest,
    witnesses: 0,
    receipts,
    delivered: false,
  };
}

function deliveryDeps(deps: NodeStageDispatchDeps): {
  outbound: MdopOutboundClient;
  platform: string;
  receipts?: NodeReceiptReporter;
  state?: { persist(): unknown };
} {
  return {
    outbound: deps.outbound,
    platform: deps.platform,
    ...(deps.receipts ? { receipts: deps.receipts } : {}),
    ...(deps.state ? { state: deps.state } : {}),
  };
}

function statusDeps(deps: NodeStageDispatchDeps): { outbound: MdopOutboundClient; platform: string } {
  return { outbound: deps.outbound, platform: deps.platform };
}
