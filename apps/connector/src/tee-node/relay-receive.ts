import {
  MdopError,
  canonicalSm3,
  type AttestationExpectation,
  type AttestationPolicy,
  type FlowLabel,
  type PhysicalStage,
} from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';
import type { BudgetKey, BudgetPolicy } from '../mdop/node/budget-ledger';
import type { NodeArtifactStore } from '../mdop/node/node-artifacts';
import type { TrustedNodeSession } from '../mdop/node/node-session';
import {
  deliverC3Payload,
  handleExpiry,
  registerArtifactHandle,
  type ArtifactDeliveryDeps,
} from './c3-delivery';
import { NodeContractStore } from './contract-store';
import type { NodeReceiptReporter } from './receipt-report';
import { runNodeSession, runNodeStage } from './session';
import { reportSessionWitnesses } from './witness-report';

/**
 * 节点侧**接收平台中继的 C2 信封**并跑完一个阶段（任务 3.14 / 3.12d、design D15 的后半段）。
 *
 * 一次接收要完成三件事，顺序不能乱：
 *  ① 跑会话（入口守卫 → KMS 释放 → 解封 → 节点内执行 → 发布审查 → 只出 C3 → 回执成链）；
 *  ② 把 C3 **登记句柄**（`ArtifactReady`，不含载荷）再**投递载荷**（`ResultDeliver`，数据面）；
 *  ③ 上报**会话见证**（证明 + 释放凭据），让持有方自己验。
 *
 * 节点不采信中继消息里的「它可信」声明：信封的 AAD/签名/策略/有效期由入口守卫逐项核对，
 * 合约策略由装配方提供的**本地副本**给出（节点侧的契约获取路径见 tasks §3.15）。
 *
 * **一次阶段可能有多个封存输入**：跨院配对的 `pair` 阶段吃两家持有方各自的信封，
 * 平台按持有方逐条中继（每条一个 `C2EnvelopeRelay`），所以本模块的核 `runRelayedStage`
 * 收的是**一组**信封：齐了才跑，且**一条会话一次性解封全部输入**（证明与释放凭据都属于同一次）。
 * `receiveRelayedEnvelope` 是单信封的既有入口（保留给单输入场景与既有装配）。
 *
 * **两种落点（任务 3.12d）**：
 *  - `publish`（缺省）：本阶段就是这个节点在该作业上的终点产出 → 审查 → 出口 → 投递 C3；
 *  - `publish: false`：产物还有**同节点的下游**（如跨院配对结果要接着做降密）→ 只跑阶段，
 *    C2 制品留在本节点制品库，**只登记句柄、不投递载荷**。C2 是入口形态而非出口形态。
 */

export interface C2RelayBody {
  data_envelope: unknown;
  sealed: { ciphertext: string; iv: string; tag: string };
  /** 持有方（信封签署方）URN。 */
  holder: string;
  credential_id: string;
}

export interface RelayReceiveDeps {
  session: TrustedNodeSession;
  /** 以**节点身份**签名的出站客户端（C3 与见证都走它）。 */
  outbound: MdopOutboundClient;
  /** C3 与见证的接收方（本设计中是平台）。 */
  platform: string;
  /**
   * 合约副本库（任务 3.15）：条款只从**验过双签的副本**取，不从消息里取。
   * 装配方可预先灌入（复用 ContractOffer 流程），也可由中继消息随带副本（见 `contractCopy`）。
   */
  contracts: NodeContractStore;
  /** 部署配置里的平台节点公钥：核验合约副署用（MUST NOT 取自消息）。 */
  platformPublicKey: string;
  /** 回执链上报（可选：给了就上报，让平台收链并锚定链头）。 */
  receipts?: NodeReceiptReporter;
  /**
   * 本地状态落盘（可选，任务 3.16）：阶段跑完后 `persist()` 一次——
   * 回执链、制品表与去重表因此不随重启丢失。
   */
  state?: { persist(): unknown };
  /**
   * 节点本地制品库（`publish: false` 时**必需**）：C2 中间制品存这里，
   * 供同节点的下游阶段按句柄取用。传的应当与会话里的那一份是同一个实例。
   */
  artifacts?: NodeArtifactStore;
}

/** 一个阶段的封存输入集合（同一作业、同一凭证、同一阶段）。 */
export interface RelayedStageInput {
  jobId: string;
  credentialId: string;
  /** 本阶段要吃的 C2 信封：跨院配对这类阶段会有**多条**（持有方各一条）。 */
  relays: C2RelayBody[];
  /** 合约号；条款从**验过的副本**取。 */
  contractId: string;
  /**
   * 首次见到该合约时随中继带来的副本（canonical + 持有方签名 + 平台副署）。
   * 已存过可省略——判据不变：两条签名都要过、公钥都不取自消息。
   */
  contractCopy?: { canonical: string; holderSignature: string; platformCountersignature: string };
  /** 生效的证明策略（注册中心白名单 ∩ 合约）。 */
  policy: AttestationPolicy;
  /** 凭证里为本节点冻结的期望。 */
  expectation: AttestationExpectation;
  holderKeys: Map<string, string>;
  stage: PhysicalStage;
  manifest: unknown;
  minCell: number;
  budget: { key: BudgetKey; policy: BudgetPolicy; cost: number; applicant: string };
  /**
   * 产物是否**出口**（缺省 true＝单阶段路径的既有行为）。
   * 派发器按片段判定：还有同节点下游的阶段留在节点内（见本文件顶部说明）。
   */
  publish?: boolean;
  now?: Date;
}

/** 单信封入口的输入（＝`RelayedStageInput` 少一个数组层）。 */
export interface RelayReceiveInput extends Omit<RelayedStageInput, 'relays'> {
  relay: C2RelayBody;
}

export interface RelayReceiveOutcome {
  /** 阶段产物（`C3` 时已投递载荷；`C2` 时只留在节点本地）。 */
  payload: Record<string, unknown>;
  /** 产物等级：`C3`（出口）或 `C2`（留在节点本地）。 */
  label: FlowLabel;
  /** 是否已出口（`publish: false` 时为 false）。 */
  published: boolean;
  handle: string;
  digest: string;
  /** 已上报的会话见证条数（每个 `key_id` 一条）。 */
  witnesses: number;
  /** 本次新上报的回执条数（平台据此校链与锚定）。 */
  receipts: number;
  handleRegistered: boolean;
  delivered: boolean;
}

/** 单信封入口（既有装配与用例的形状）。 */
export async function receiveRelayedEnvelope(
  deps: RelayReceiveDeps,
  input: RelayReceiveInput,
): Promise<RelayReceiveOutcome> {
  const { relay, ...rest } = input;
  return runRelayedStage(deps, { ...rest, relays: [relay] });
}

/**
 * 跑一个「吃 C2 信封」的阶段。信封数量不限（每条一个持有方的封存输入），
 * 但**必须是同一次会话**：一次证明、逐份释放、解封后一起进算子。
 */
export async function runRelayedStage(
  deps: RelayReceiveDeps,
  input: RelayedStageInput,
): Promise<RelayReceiveOutcome> {
  if (!input.relays.length)
    throw new MdopError('E_RUNTIME', {}, '本阶段没有任何封存输入（C2 信封），拒绝执行');

  // ① 合约副本：首次随中继带来的副本先验双签存档（公钥来自部署配置与登记表，都不取自消息）；
  //    没带副本就必须是**已验过**的那一份，否则 `requireForSession` 直接拒。
  if (input.contractCopy) {
    // 副本由**合约的 provider** 签；对照的登记公钥取信封签署方（不在登记表里就取不到 → 拒）
    deps.contracts.verifyAndStore({
      ...input.contractCopy,
      platformPublicKey: deps.platformPublicKey,
      holderPublicKey: input.holderKeys.get(input.relays[0].holder) ?? '',
      ...(input.now ? { now: input.now } : {}),
    });
  }
  const terms = deps.contracts.requireForSession(input.contractId);
  if (!terms.recipients.includes(deps.platform))
    throw new MdopError('E_LABEL_VIOLATION', {}, '合约接收方列表里没有 C3 交付目标');

  // 多持有方作业：各院各签各的合约，信封绑的是**各自那一份**。逐条按信封声明的合约号取
  // **本地验过双签的副本**（没验过即拒）；每份合约都必须把 C3 交付目标列为接收方，
  // 产出物的接收方范围取各合约的**交集**（任何一份没授权的接收方都不得拿到结果）。
  const termsFor = (relay: C2RelayBody) => {
    const declared = (relay.data_envelope as { policy?: { contract?: unknown } } | undefined)?.policy
      ?.contract;
    if (typeof declared !== 'string' || declared === terms.contract_id) return terms;
    const own = deps.contracts.requireForSession(declared);
    if (!own.recipients.includes(deps.platform))
      throw new MdopError('E_LABEL_VIOLATION', {}, `合约 ${declared} 的接收方列表里没有 C3 交付目标`);
    return own;
  };
  const relayTerms = input.relays.map(termsFor);
  const contractRecipients = terms.recipients.filter((r) =>
    relayTerms.every((t) => t.recipients.includes(r)),
  );

  const sessionInput = {
    jobId: input.jobId,
    credentialId: input.credentialId,
    contractId: terms.contract_id,
    contract: {
      contract_id: terms.contract_id,
      data_product_id: terms.data_product_id,
      allowed_ops: terms.allowed_ops,
      ...(terms.attestation_policy ? { attestation_policy: terms.attestation_policy } : {}),
    },
    policy: input.policy,
    expectation: input.expectation,
    inputs: input.relays.map((relay, index) => {
      const own = relayTerms[index];
      return {
        rawEnvelope: relay.data_envelope,
        sealed: relay.sealed,
        // 「登记侧的事实」以 KMS 为准：这里只是请求里的归属声明（KMS 自己的登记优先）。
        keyOwner: { job_id: input.jobId, contract_id: own.contract_id },
        ...(own.contract_id === terms.contract_id
          ? {}
          : {
              contract: {
                contract_id: own.contract_id,
                data_product_id: own.data_product_id,
                allowed_ops: own.allowed_ops,
                ...(own.attestation_policy ? { attestation_policy: own.attestation_policy } : {}),
              },
            }),
      };
    }),
    holderKeys: input.holderKeys,
    credentialValid: true,
    contractActive: true,
    stage: input.stage,
    manifest: input.manifest,
    minCell: input.minCell,
    target: deps.platform,
    contractRecipients,
    budget: { ...input.budget, kind: 'query' as const },
    ...(input.now ? { now: input.now } : {}),
  };

  // ─ 落点一：还有同节点下游 → 只跑阶段，C2 中间制品留在本节点 ────────────────
  if (input.publish === false) {
    if (!deps.artifacts)
      throw new MdopError('E_RUNTIME', {}, '本阶段产物要留在节点本地，但没有接上节点制品库');
    const { stage, witnesses: localWitnesses } = await runNodeStage(deps.session, sessionInput);
    if (stage.output.label !== 'C2')
      throw new MdopError(
        'E_LABEL_VIOLATION',
        {},
        `声明为节点内中间阶段却产出 ${stage.output.label}：中间阶段只能是 C2（C3 属出口形态）`,
      );
    // ① 制品落**本节点**制品库：下游阶段按同一句柄 `art://<node>/<job>/<stage>` 取用
    deps.artifacts.put({
      handle: stage.localHandle,
      jobId: input.jobId,
      label: 'C2',
      digest: stage.output.digest,
      payload: stage.output.payload,
      expiresAt: new Date((input.now ?? new Date()).getTime() + 72 * 3_600_000).toISOString(),
    });
    // ② 只登记句柄（控制面），**不投递载荷**——C2 不出节点
    await registerArtifactHandle(deliveryDeps(deps), {
      jobId: input.jobId,
      credentialId: input.credentialId,
      stage: input.stage,
      handle: stage.localHandle,
      label: 'C2',
      digest: stage.output.digest,
      expiresAt: handleExpiry(input.now ?? new Date()),
    });
    // ③ 见证：密钥**确实**释放过，持有方要能自己验那一次释放
    const localWitnessCount = await reportSessionWitnesses(localWitnesses, {
      receiver: deps.platform,
      outbound: deps.outbound,
    });
    const localReceipts = deps.receipts ? await deps.receipts.report(input.jobId) : 0;
    deps.state?.persist();
    return {
      payload: stage.output.payload,
      label: 'C2',
      published: false,
      handle: stage.localHandle,
      digest: stage.output.digest,
      witnesses: localWitnessCount,
      receipts: localReceipts,
      handleRegistered: true,
      delivered: false,
    };
  }

  // ─ 落点二：本阶段是该节点的终点产出 → 审查 → 出口 → 投递 C3 ──────────────
  const { result, witnesses } = await runNodeSession(deps.session, sessionInput);
  const digest = canonicalSm3(result.c3);

  // ① 登记句柄（控制面，不含载荷）
  await registerArtifactHandle(deliveryDeps(deps), {
    jobId: input.jobId,
    credentialId: input.credentialId,
    stage: input.stage,
    handle: result.handle,
    label: 'C3',
    digest,
    expiresAt: handleExpiry(input.now ?? new Date()),
  });

  // ② 数据面投递 C3 载荷（平台是合约明示的接收方）
  await deliverC3Payload(deliveryDeps(deps), {
    jobId: input.jobId,
    credentialId: input.credentialId,
    stage: input.stage,
    handle: result.handle,
    label: 'C3',
    digest,
    expiresAt: handleExpiry(input.now ?? new Date()),
    payload: result.c3,
  });

  // ③ 会话见证上报（持有方据此独立核验）
  const witnessesSent = await reportSessionWitnesses(witnesses, {
    receiver: deps.platform,
    outbound: deps.outbound,
  });

  // ④ 回执链上报（平台按「节点 + 作业」收链、逐条验连续性、终态锚定链头）
  const receiptsSent = deps.receipts ? await deps.receipts.report(input.jobId) : 0;

  // ⑤ 本地落盘：把这一轮产生的回执与制品写进节点自己的数据目录
  deps.state?.persist();

  return {
    payload: result.c3,
    label: 'C3',
    published: true,
    handle: result.handle,
    digest: result.digest,
    witnesses: witnessesSent,
    receipts: receiptsSent,
    handleRegistered: true,
    delivered: true,
  };
}

/** 出站登记/投递的公共依赖（判据与事实只有一份）。 */
function deliveryDeps(deps: RelayReceiveDeps): ArtifactDeliveryDeps {
  return {
    outbound: deps.outbound,
    platform: deps.platform,
    ...(deps.receipts ? { receipts: deps.receipts } : {}),
    ...(deps.state ? { state: deps.state } : {}),
  };
}
