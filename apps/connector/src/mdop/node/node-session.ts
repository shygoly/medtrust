import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  canonicalSm3,
  verifyC2Execution,
  verifyReleaseWarrant,
  mergeReleaseManifests,
  withReleaseManifest,
  type AttestationExpectation,
  type AttestationPolicy,
  type AttestationProvider,
  type AttestationReport,
  type AttestationVerifier,
  type DataEnvelope,
  type FlowLabel,
  type KmsClient,
  type KeyReleaseWarrant,
  type PhysicalStage,
  type SessionWarrant,
} from '@medtrust/mdop';
import type { MdopStageExecutor } from '../mdop-executor';
import { NodeQueryBudgetLedger, type BudgetKey, type BudgetPolicy, type BudgetUsage } from './budget-ledger';
import { TrustedNodeEntryGuard } from './entry-guard';
import { NodeArtifactStore, type NodePurgeReceipt } from './node-artifacts';
import { NodeExitGuard } from './node-exit';
import { NodeReceiptChain } from './node-receipts';
import { NodePublicationReview, type PublicationReviewRecord } from './publication-review';
import { unsealPayload } from './unseal';

/**
 * **可信空间节点的一次 C2 会话**（任务 3.1–3.3 / 3.8 / 4.x 的装配点、协议 §9）。
 *
 * 把此前各自成立的部件串成一条真正跑得起来的会话：
 *
 *   证明（每次会话重新证明）→ 入口守卫 → KMS 释放（判据只有一份：`evaluateKeyRelease`）
 *   → 解封（AAD 绑定 + 密文完整性）→ 节点内执行 → 发布审查 → 只出 C3 → 回执成链 → 销毁
 *
 * 两条**可插拔**接缝（换硬件时改的是这两个实现，调用点不动——这是试点要证的结论）：
 *  - `attestation`：证明提供者（真实实现对接 CSV / TDX / SEV-SNP 证明链）；
 *  - `kms`：KMS 客户端（真实实现是数据持有方自建或与运营方共管的 KMS，D-TEE-1）。
 *
 * 另外两处也由装配方注入：`unwrapKey`（在飞地内用**一次性私钥**解开数据密钥——私钥不出实例）
 * 与 `verifier`（本节点若有厂商证明根，就自己验 quote；没有则依 KMS 释放凭据背书，D13）。
 *
 * **本类不假装自己是硬件节点**：注入软件证明提供者时，`evaluateKeyRelease` 会以
 * `E_CAPABILITY_MISMATCH` 拒掉整次会话——软件实现不能作 C2 目标这条规则在这里同样成立，
 * 所以「用软件提供者跑通全流程」在实现上是不可能的，也不需要靠人自觉。
 */

export interface C2SealedInput {
  /** 持有方封好的 `mdop.env/1.0` 信封（原样收到的对象）。 */
  rawEnvelope: unknown;
  /** 密文体（与信封 `wrapped_key.key_id` 对应）。 */
  sealed: { ciphertext: string; iv: string; tag: string };
  /** KMS 侧登记的密钥归属（**登记侧的事实**，不是随消息声明的）。 */
  keyOwner: { job_id: string; contract_id: string };
}

export interface C2SessionInput {
  jobId: string;
  credentialId: string;
  contractId: string;
  /** 本地合约副本的相关条款（`allowed_ops` / `data_product_id` / 证明策略都在里面）。 */
  contract: {
    contract_id: string;
    data_product_id: string;
    allowed_ops?: string[];
    attestation_policy?: AttestationPolicy;
  };
  /** 生效的证明策略（注册中心白名单与合约的**交集**，由调用方用 `resolveMeasurementWhitelist` 算好）。 */
  policy: AttestationPolicy;
  /** 凭证里为**本节点**冻结的执行环境期望（要约时各持有方签署的那份）。 */
  expectation: AttestationExpectation;
  inputs: C2SealedInput[];
  /** 持有方登记公钥（入口守卫验信封签名用）。 */
  holderKeys: Map<string, string>;
  credentialValid: boolean;
  contractActive: boolean;
  /** 节点内要执行的那一步（含算子引用、输入标签与输出等级）。 */
  stage: PhysicalStage;
  /** 注册中心签发的算子清单（执行器会校验未加白/已吊销即拒）。 */
  manifest: unknown;
  minCell: number;
  /** C3 的投递目标与合约接收方名单。 */
  target: string;
  contractRecipients: readonly string[];
  budget: { key: BudgetKey; policy: BudgetPolicy; cost: number; applicant: string; kind?: 'query' | 'subgroup' | 'recompute' };
  now?: Date;
}

export interface C2SessionResult {
  /** 过闸门后、只放给合约接收方的 C3 载荷。 */
  c3: Record<string, unknown>;
  handle: string;
  digest: string;
  /** 本节点身份（参与方 URN）——会话见证的 `node` 字段来源。 */
  node: string;
  jobId: string;
  credentialId: string;
  contractId: string;
  /** 本次会话的证明摘要（进回执，供第三方离线核验「在什么代码下处理过」）。 */
  attestation: { quote_digest: string; measurement: string; tcb: string | null };
  /** 本次会话的**证明报告本体**：会话见证要送它（只送摘要接收方验不了）。 */
  report: AttestationReport;
  /**
   * 本次会话的**逐密钥释放**：每份封存输入各有自己的 `key_id` 与释放凭据，
   * 因此见证按释放切分（同一份证明 + 各自那份凭据）。
   */
  releases: Array<{ key_id: string; warrant: KeyReleaseWarrant; warrant_digest: string }>;
  /** 兼容字段：最后一个释放的凭据摘要（多输入场景请用 `releases`）。 */
  warrantDigest: string;
  receiptsHead: string | null;
  review: PublicationReviewRecord;
  budget: BudgetUsage;
}

/** 一次会话的**凭据**（证明报告 + 逐密钥释放）：同一作业的多阶段共用同一份。 */
export interface C2SessionCredential {
  report: AttestationReport;
  attestation: { quote_digest: string; measurement: string; tcb: string | null };
  releases: Array<{ key_id: string; warrant: KeyReleaseWarrant; warrant_digest: string }>;
}

/**
 * **未出口**的一次阶段执行结果（两阶段路径的第一段：如跨院配对）。
 *
 * 产物**不在这里入制品库**：调用方（节点阶段派发器）决定是否 `artifacts.put`。
 * 这样 `run()` 的单阶段路径不会凭空多出一条中间制品，两阶段路径则把 C2 中间制品
 * 存在节点本地——**C2 是入口形态，不是出口形态**，它不经发布审查、不出节点。
 */
export interface C2StageResult {
  output: {
    /** 阶段产物等级（第一段恒为 C2：C2 只能由 seal 产生，也只能在节点内流转）。 */
    label: FlowLabel;
    schema: string;
    payload: Record<string, unknown>;
    digest: string;
  };
  /** 节点本地句柄（`art://<node>/<job>/<stage>`）：C2 中间制品就放在它下面。 */
  localHandle: string;
  jobId: string;
  credentialId: string;
  contractId: string;
  /** 本节点身份（参与方 URN）。 */
  node: string;
  attestation: { quote_digest: string; measurement: string; tcb: string | null };
  report: AttestationReport;
  releases: Array<{ key_id: string; warrant: KeyReleaseWarrant; warrant_digest: string }>;
  warrantDigest: string;
  /** 本次解封的**原始持有方**（出口守卫的 R5 判据要靠它传到发布那一步）。 */
  originHolders: string[];
  receiptsHead: string | null;
}

/**
 * **发布**的输入：已经过发布审查的产物 + 出口所需的上下文。
 *
 * 为什么把「审查」与「发布」分开传：发布审查（本节点内强制的小单元格抑制）**全流程只做一次**。
 * 两阶段路径里它是 `declassify.small_cell` 算子（`tee-node/declassify-op.ts`）；单阶段路径里
 * 由 `run()` 就地调用同一个 `NodePublicationReview`。若出口处再审查一次，第二次的
 * `suppressed` 计数会因为「已经抑制过」而变成 0，随行清单就会**少报**抑制格数。
 */
export interface C2PublicationInput {
  jobId: string;
  credentialId: string;
  contractId: string;
  stage: PhysicalStage;
  /** 已过发布审查的载荷与审查记录（审查的判定只有一份，见上面的说明）。 */
  reviewed: { payload: Record<string, unknown>; review: PublicationReviewRecord };
  budget: C2SessionInput['budget'];
  target: string;
  contractRecipients: readonly string[];
  /** 本节点执行过的 C2 信封的原始持有方（R5 用；本地制品阶段为空）。 */
  originHolders: readonly string[];
  /**
   * 本次会话的证明与释放凭据（多阶段共用解封阶段那一份）。
   * 缺省**重新证明**：出口那一刻必须有一份当下的证明，不能拿旧证明充数。
   */
  session?: C2SessionCredential;
  now?: Date;
}

export interface C2PublicationResult {
  /** 过闸门后带发布审查清单的 C3 载荷。 */
  c3: Record<string, unknown>;
  handle: string;
  digest: string;
  review: PublicationReviewRecord;
  budget: BudgetUsage;
  attestation: { quote_digest: string; measurement: string; tcb: string | null };
  receiptsHead: string | null;
}

/** **本地输入阶段**的执行结果（没有出口：出口由 `publish` 负责）。 */
export interface C2LocalStageResult {
  output: {
    label: FlowLabel;
    schema: string;
    payload: Record<string, unknown>;
    digest: string;
  };
  attestation: { quote_digest: string; measurement: string; tcb: string | null };
  report: AttestationReport;
  receiptsHead: string | null;
}

export interface NodeSessionDeps {
  /** 本节点身份（参与方 URN）。 */
  node: string;
  /** 证明提供者（可插拔；每次会话调用 `prove()`）。 */
  attestation: AttestationProvider;
  /** KMS 客户端（可插拔）。 */
  kms: KmsClient;
  /**
   * KMS 公钥：**来自部署配置或合约**（MUST NOT 取自消息）。节点用它核对释放凭据的签名，
   * 再据此判定「本次证明确实被 KMS 接受过」（D13：以释放凭据为主，不做原始 quote 自验）。
   */
  kmsPublicKey: string;
  /** 在飞地内解开数据密钥（一次性私钥不出实例）。 */
  unwrapKey(warrant: KeyReleaseWarrant): Uint8Array;
  /** 本节点若有厂商证明根则给出；没有则 `undefined`（依 KMS 释放凭据背书）。 */
  verifier?: AttestationVerifier;
  entryGuard: TrustedNodeEntryGuard;
  review: NodePublicationReview;
  exitGuard: NodeExitGuard;
  receipts: NodeReceiptChain;
  artifacts: NodeArtifactStore;
  budget: NodeQueryBudgetLedger;
  executor: MdopStageExecutor;
}

@Injectable()
export class TrustedNodeSession {
  private readonly logger = new Logger(TrustedNodeSession.name);
  /** 最近一次会话的证明报告（审计导出用；不跨会话复用）。 */
  private lastReport?: AttestationReport;

  constructor(private readonly deps: NodeSessionDeps) {}

  /** 最近一次证明报告（只读）。 */
  report(): AttestationReport | undefined {
    return this.lastReport;
  }

  /**
   * **单阶段路径**（会话即出口）：跑一个阶段 → 发布审查 → 出口 C3。
   *
   * 这是「一个阶段 + 会话内自审」的既有形态。需要「配对 → 降密」两阶段的场景走
   * `runStage` + `publish`：第一段只把 C2 中间制品留在节点本地。
   */
  async run(input: C2SessionInput): Promise<C2SessionResult> {
    const now = input.now ?? new Date();
    const stage = await this.runStageAt(input, now);

    // ⑥ 发布审查（节点内强制；拒放即失败，不做任何降级）
    // 先拦等级洗白：C0/C1 制品**不得**靠「过一遍发布审查」变成可出域的 C3
    // （等级由输入 join 推出，发布审查只做小单元格抑制与可识别内容拦截，不改变等级语义）。
    if (stage.output.label !== 'C2' && stage.output.label !== 'C3')
      throw new MdopError(
        'E_LABEL_VIOLATION',
        {},
        `节点内 C0/C1 制品不得进入发布审查（收到 ${stage.output.label}）：等级不能靠审查洗白`,
      );
    const review = this.deps.review.review({
      candidate: stage.output.payload,
      minCell: input.minCell,
      contractId: input.contractId,
    });
    const published = await this.publish({
      jobId: input.jobId,
      credentialId: input.credentialId,
      contractId: input.contractId,
      stage: input.stage,
      reviewed: { payload: review.payload, review: review.record },
      budget: input.budget,
      target: input.target,
      contractRecipients: input.contractRecipients,
      originHolders: stage.originHolders,
      session: {
        report: stage.report,
        attestation: stage.attestation,
        releases: stage.releases,
      },
      now,
    });

    return {
      // 交付的是**带发布审查清单**的那一份（汇总数随行、逐格明细留在节点本地）
      c3: published.c3,
      handle: published.handle,
      digest: stage.output.digest,
      node: this.deps.node,
      jobId: input.jobId,
      credentialId: input.credentialId,
      contractId: input.contractId,
      attestation: published.attestation,
      report: stage.report,
      releases: stage.releases,
      warrantDigest: stage.warrantDigest,
      receiptsHead: published.receiptsHead,
      review: review.record,
      budget: published.budget,
    };
  }

  /**
   * **跑一个阶段但不出口**（两阶段路径的第一段，任务 3.12d）：
   * 证明 → 入口守卫 → KMS 释放 → 解封 → 节点内执行。
   *
   * 只到「节点内产物」为止：不经发布审查、不入制品库、不出节点。调用方拿到
   * `output` 与 `localHandle` 后自行决定是否把 C2 中间制品存进本节点制品库
   * （`tee-node/stage-dispatch.ts` 就是这么做的），随后在**同一节点内**跑下一阶段。
   */
  async runStage(input: C2SessionInput): Promise<C2StageResult> {
    return this.runStageAt(input, input.now ?? new Date());
  }

  /**
   * **本地输入阶段**（两阶段路径的第二段，如 `decTee`）：证明 → 节点内执行 → `EXECUTED` 回执。
   *
   * 与 `runStage` 的区别只在输入来源：这里吃的是**本节点制品库**里的中间制品（已解封、没出过节点），
   * 因此没有入口守卫、没有 KMS 释放，也**没有解封事件**。执行同样要证明并留痕——否则回执链上会缺掉
   * 「降密那一步是在什么代码下跑的」这一环，链就不再能独立核验。
   */
  async executeLocalStage(input: {
    jobId: string;
    stage: PhysicalStage;
    inputs: Map<string, Record<string, unknown>>;
    manifest: unknown;
    contractTerms?: Record<string, unknown>;
    now?: Date;
  }): Promise<C2LocalStageResult> {
    const report = await this.deps.attestation.prove();
    this.lastReport = report;
    const attestation = {
      quote_digest: report.quote_digest ?? '',
      measurement: report.measurement,
      tcb: report.tcb,
    };
    const output = await this.deps.executor.execute(
      {
        jobId: input.jobId,
        stage: input.stage,
        inputs: input.inputs,
        attempt: 1,
        ...(input.contractTerms ? { contractTerms: input.contractTerms } : {}),
      },
      input.manifest,
    );
    this.deps.receipts.append({
      jobId: input.jobId,
      stage: input.stage.id,
      event: 'EXECUTED',
      opDigest: input.stage.op_digest,
      outputDigest: output.digest,
      label: output.label,
      attestation,
      // 本地阶段：输入来自本节点制品库，没有解封这一步（`local_stage` 让审计能看出区别）
      detail: { op: input.stage.op, local_stage: true },
    });
    return {
      output: {
        label: output.label,
        schema: output.schema,
        payload: output.payload,
        digest: output.digest,
      },
      attestation,
      report,
      receiptsHead: this.deps.receipts.head(input.jobId),
    };
  }

  private async runStageAt(input: C2SessionInput, now: Date): Promise<C2StageResult> {
    // ① 每次会话重新证明（一次证明长期复用＝把一次性检查当持续保证）
    const report = await this.deps.attestation.prove();
    this.lastReport = report;

    // ② 入口守卫：解密**之前**逐项核对信封（结构 / AAD / 出口形态 / 本节点链型 / 策略覆盖 / 有效期 / 持有方签名）
    const opened: Array<{ envelope: DataEnvelope; sealed: C2SealedInput['sealed'] }> = [];
    for (const item of input.inputs) {
      const decision = this.deps.entryGuard.check({
        rawEnvelope: item.rawEnvelope,
        selfNode: this.deps.node,
        expect: {
          job_id: input.jobId,
          credential_id: input.credentialId,
          contract_id: input.contractId,
        },
        contract: input.contract,
        providerKind: report.kind,
        now,
      });
      opened.push({ envelope: decision.envelope, sealed: item.sealed });
    }

    // ③ KMS 释放：逐份信封提交「证明 + 凭证 + key_id」，拿回以**本次证明的一次性公钥**封好的密钥
    const budgetKey = input.budget.key;
    // 先判预算（拒了就不扣），再算——顺序反了就成了「算了才发现超预算」
    try {
      this.deps.budget.assertWithin(budgetKey, input.budget.policy, input.budget.cost);
    } catch (err) {
      // **拒绝也要进签名回执链**（规格：预算消耗与拒绝 MUST 随作业回执上报，供审计与结算参照）。
      // 只在内存里拒掉，事后没人能证明「这条作业因预算被拒过、而且一分没扣」——
      // 而结算与追责恰恰要靠这一条。事件用协议既有的 `STAGE_FAILED`，不新造回执类型。
      this.deps.receipts.append({
        jobId: input.jobId,
        stage: input.stage.id,
        event: 'STAGE_FAILED',
        opDigest: 'component:node-budget@1',
        detail: {
          code: err instanceof MdopError ? err.code : 'E_RUNTIME',
          budget: {
            dataset: budgetKey.dataset,
            snapshot: budgetKey.snapshot,
            unit: input.budget.policy.unit,
            kind: input.budget.kind ?? 'query',
            cost: input.budget.cost,
            limit: input.budget.policy.limit,
            // 拒了就不扣：这一条让审计看得见「没有消耗」，而不是只能推断
            charged: false,
          },
        },
      });
      throw err;
    }

    const plaintexts = new Map<string, Record<string, unknown>>();
    const releases: Array<{ key_id: string; warrant: KeyReleaseWarrant; warrant_digest: string }> = [];
    for (const [index, item] of input.inputs.entries()) {
      const envelope = opened[index].envelope;
      const context = {
        job_id: input.jobId,
        credential_id: input.credentialId,
        contract_id: input.contractId,
        key_id: envelope.wrapped_key.key_id,
      };
      const warrant = await this.deps.kms.requestRelease({
        key_id: envelope.wrapped_key.key_id,
        key_owner: item.keyOwner,
        context,
        report,
        policy: input.policy,
        credential_valid: input.credentialValid,
        contract_active: input.contractActive,
        now,
      });
      // 信封 `wrapped_key.kms` = 数据持有方指定的密钥保管方；释放必须来自它（D-TEE-1）
      const session = this.verifyWarrant(
        warrant,
        report,
        context,
        input,
        now,
        envelope.wrapped_key.kms,
      );
      releases.push({ key_id: warrant.key_id, warrant, warrant_digest: session.digest });

      // ④ 解封：AAD 绑定不符即认证失败（换作业/换凭证/换合约都解不开）
      const dek = this.deps.unwrapKey(warrant);
      const projection = unsealPayload(
        opened[index].sealed,
        dek,
        {
          job_id: input.jobId,
          credential_id: input.credentialId,
          contract_id: input.contractId,
        },
        envelope.payload.digest,
      ) as Record<string, unknown>;
      plaintexts.set(envelope.payload.ciphertext_ref, projection);
    }

    const attestationDetail = {
      quote_digest: report.quote_digest ?? '',
      measurement: report.measurement,
      tcb: report.tcb,
    };
    this.deps.receipts.append({
      jobId: input.jobId,
      stage: input.stage.id,
      event: 'UNSEALED',
      opDigest: input.stage.op_digest,
      inputDigests: input.inputs
        .map((i) => i.rawEnvelope as { payload?: { digest?: string } })
        .map((e) => e?.payload?.digest ?? '')
        .filter((d) => /^sm3:[0-9a-f]{64}$/.test(d)),
      attestation: attestationDetail,
      detail: {
        inputs: input.inputs.length,
        warrant_digest: releases[releases.length - 1]?.warrant_digest ?? '',
        releases: releases.map((r) => r.warrant_digest),
      },
    });

    // ⑤ 节点内执行（算子仍走注册中心清单：未加白/已吊销即拒）
    const inputs = new Map<string, Record<string, unknown>>();
    for (const [ref, projection] of plaintexts) inputs.set(ref, projection);
    const output = await this.deps.executor.execute(
      { jobId: input.jobId, stage: input.stage, inputs, attempt: 1 },
      input.manifest,
    );
    this.deps.receipts.append({
      jobId: input.jobId,
      stage: input.stage.id,
      event: 'EXECUTED',
      opDigest: input.stage.op_digest,
      outputDigest: output.digest,
      label: output.label,
      attestation: attestationDetail,
      detail: { op: input.stage.op },
    });

    const localHandle = `art://${this.deps.node}/${input.jobId}/${input.stage.id}`;
    this.logger.log(
      `C2 阶段执行完成 job=${input.jobId} stage=${input.stage.id} label=${output.label} digest=${output.digest.slice(0, 16)}…`,
    );
    return {
      output: {
        label: output.label,
        schema: output.schema,
        payload: output.payload,
        digest: output.digest,
      },
      localHandle,
      jobId: input.jobId,
      credentialId: input.credentialId,
      contractId: input.contractId,
      node: this.deps.node,
      attestation: attestationDetail,
      report,
      releases,
      warrantDigest: releases[releases.length - 1]?.warrant_digest ?? '',
      // 出口守卫的 R5 判据：**信封签署方**就是原始持有方（不从消息声明里取）
      originHolders: input.inputs
        .map((i) => (i.rawEnvelope as { origin_sig?: { signer?: string } })?.origin_sig?.signer ?? '')
        .filter(Boolean),
      receiptsHead: this.deps.receipts.head(input.jobId),
    };
  }

  /**
   * **发布一个已审查的产物**（出口那一半）：记账 → 出口守卫 → C3 制品入库 → EXITED 回执。
   *
   * 顺序与单阶段路径一致（审查在调用方、记账在出口之前），因此发布审查清单里的
   * 「预算消耗」是本阶段**真实**消耗而不是预估。
   */
  async publish(input: C2PublicationInput): Promise<C2PublicationResult> {
    const now = input.now ?? new Date();
    const session = input.session ?? (await this.proveFresh());
    const budgetKey = input.budget.key;

    // 记账：**算成功后才扣**（拒了就不扣）
    const usage = this.deps.budget.charge({
      key: budgetKey,
      policy: input.budget.policy,
      cost: input.budget.cost,
      kind: input.budget.kind ?? 'query',
      applicant: input.budget.applicant,
    });

    // 出节点：只放 C3，且目标必须在合约接收方名单里
    // 随行**发布审查清单**（任务 7.3b）：汇总数出域、逐格明细留在节点本地与回执里
    const c3Payload = withReleaseManifest(
      input.reviewed.payload,
      // 单方清单＝多方合并的退化情形：载荷里永远是同一种可解析对象（前端与审计不必分叉）
      mergeReleaseManifests(
        [
          {
            node: this.deps.node,
            minCell: input.reviewed.review.minCell,
            suppressed: input.reviewed.review.suppressed,
            dp: input.reviewed.review.dp,
            budget: {
              dataset: budgetKey.dataset,
              snapshot: budgetKey.snapshot,
              unit: input.budget.policy.unit,
              spent: usage.spent,
              limit: usage.limit,
            },
            at: now.toISOString(),
          },
        ],
        { now },
      ),
    );
    const handle = `art://${this.deps.node}/${input.jobId}/${input.stage.id}`;
    this.deps.exitGuard.assertDeliverable({
      // 过闸门后的那一份就是 **C3 交付物**：节点内的降密由「发布审查」完成，
      // 出口守卫因此按 C3 判（等级检查把 C0/C1 挡在审查之前）。
      label: 'C3',
      target: input.target,
      originHolders: input.originHolders,
      contractRecipients: input.contractRecipients,
    });
    const digest = canonicalSm3(c3Payload);
    this.deps.artifacts.put({
      handle,
      jobId: input.jobId,
      label: 'C3',
      digest,
      payload: c3Payload,
      expiresAt: new Date(now.getTime() + 72 * 3_600_000).toISOString(),
    });
    this.deps.receipts.append({
      jobId: input.jobId,
      stage: input.stage.id,
      event: 'EXITED',
      opDigest: `component:node-exit@1`,
      outputDigest: digest,
      label: 'C3',
      attestation: session.attestation,
      detail: {
        handle,
        target: input.target,
        // 预算消耗随**签名回执**上报（规格：供审计与结算参照）——与 C3 载荷里的清单同一份口径
        budget: {
          dataset: budgetKey.dataset,
          snapshot: budgetKey.snapshot,
          unit: input.budget.policy.unit,
          kind: input.budget.kind ?? 'query',
          cost: input.budget.cost,
          spent: usage.spent,
          limit: usage.limit,
        },
        release_manifest: {
          suppressed: input.reviewed.review.suppressed,
          minCell: input.reviewed.review.minCell,
        },
      },
    });
    this.logger.log(`C2 发布完成 job=${input.jobId} stage=${input.stage.id} digest=${digest.slice(0, 16)}…`);
    return {
      c3: c3Payload,
      handle,
      digest,
      review: input.reviewed.review,
      budget: usage,
      attestation: session.attestation,
      receiptsHead: this.deps.receipts.head(input.jobId),
    };
  }

  /** 出口前**重新证明**一次（没有现成会话凭据时的发布路径）。 */
  private async proveFresh(): Promise<C2SessionCredential> {
    const report = await this.deps.attestation.prove();
    this.lastReport = report;
    return {
      report,
      attestation: {
        quote_digest: report.quote_digest ?? '',
        measurement: report.measurement,
        tcb: report.tcb,
      },
      releases: [],
    };
  }

  /** 销毁（作业终态收到 `PurgeOrder`）：出销毁回执并让制品不可再读。 */
  purge(input: {
    jobId: string;
    reason?: NodePurgeReceipt['reason'];
    idempotencyKey: string;
    now?: Date;
  }): NodePurgeReceipt {
    const receipt = this.deps.artifacts.purge({
      jobId: input.jobId,
      reason: input.reason ?? 'purge-order',
      idempotencyKey: input.idempotencyKey,
      now: input.now,
    });
    this.deps.receipts.append({
      jobId: input.jobId,
      stage: '__node__',
      event: 'PURGED',
      opDigest: 'component:node-purge@1',
      detail: { handles: receipt.handles, reason: receipt.reason },
    });
    return receipt;
  }

  /**
   * 释放凭据 → 会话凭据：先核对 KMS 签名与绑定（D13），再把「凭证里冻结的期望 ×
   * 本次证明 × 释放凭据」三者对起来（`verifyC2Execution`）。
   */
  private verifyWarrant(
    warrant: KeyReleaseWarrant,
    report: AttestationReport,
    context: { job_id: string; credential_id: string; contract_id: string; key_id: string },
    input: C2SessionInput,
    now: Date,
    /** 信封指定的 KMS（数据持有方的保管方）；凭据必须由它签发，否则拒。 */
    expectedKms: string,
  ): SessionWarrant {
    const session = verifyReleaseWarrant({
      warrant,
      kmsPublicKey: this.deps.kmsPublicKey,
      report,
      context,
      // KMS 归属逐份核对：信封写的保管方必须就是签发凭据的那个 KMS（D-TEE-1）
      expectedKms: expectedKms,
      now,
    });
    verifyC2Execution({
      expectation: input.expectation,
      report,
      policy: input.policy,
      ...(this.deps.verifier ? { verifier: this.deps.verifier } : {}),
      warrant: session,
      context,
      now,
    });
    return session;
  }
}
