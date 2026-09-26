import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MdopAttestationEntity } from "@medtrust/database";
import { AttestationService } from "../runtime/digital-contract/attestation.service";
import {
  MdopError,
  TEE_KINDS,
  compareTcb,
  resolveMeasurementWhitelist,
  verifyEndorsementPush,
  verifySessionWitness,
  type AttestationExpectation,
  type AttestationPolicy,
  type TeeKind,
} from "@medtrust/mdop";

/**
 * 可信空间节点的证明登记（任务 5.1、协议 §4.3 / §9.4、D-TEE-1）。
 *
 * **平台不自己验 quote**：平台没有 DCAP / 厂商证明服务，也不该把信任建在自己身上。
 * 因此这里登记的是「**已由配置白名单内的校验方**（KMS / 证明服务）校验通过的证明摘要」，
 * 校验方标识与度量白名单都来自**部署配置**，MUST NOT 来自随请求带来的字段。
 *
 * 与连接器侧的分工：
 *  - 平台（本服务）：`assertUsableForC2` —— 只判「有没有一份**被可信校验方**认定有效、
 *    未过期、且与合约策略相符的记录」，用于编译期放置与凭证冻结；
 *  - 连接器 / KMS：`verifyAttestationForC2` —— 拿原始 quote 自己验（那才是真正的证明校验）。
 */

export interface AttestationWarrant {
  node: string;
  kind: string;
  measurement: string;
  tcb?: string | null;
  quoteDigest: string;
  verifiedBy: string;
  verifiedAt: string;
  expiresAt: string;
  warrantDigest?: string | null;
  /**
   * 会话标识（**逐会话唯一**，如释放凭据摘要）：给了它，登记行就是「一次会话一条」，
   * 同一份证明的多次会话各留一行历史（任务 5.1 的要求）。
   * 不给则退回 `node#quoteDigest`（按证明去重的旧口径）。
   */
  sessionKey?: string | null;
  /** 见证本体（可验签对象；存在时与摘要一同落库，供持有方独立核验）。 */
  report?: Record<string, unknown> | null;
  warrant?: Record<string, unknown> | null;
  /** 会话上下文（任务 7.4）：作业 / 凭证 / 合约 / 密钥。摘要级旧口径可空。 */
  jobId?: string | null;
  credentialId?: string | null;
  contractId?: string | null;
  keyId?: string | null;
}

export interface AttestationDeps {
  /** 允许的校验方标识（部署配置）。缺省读 `MDOP_ATTESTATION_VERIFIERS`。 */
  trustedVerifiers?: readonly string[];
  /** 注册中心认可的度量白名单。缺省读 `MDOP_ATTESTATION_MEASUREMENTS`。 */
  registryMeasurements?: readonly string[];
  /** KMS 释放凭据的验签（部署注入；缺省视为不可验，即 fail-closed）。 */
  verifyWarrant?: (w: AttestationWarrant) => boolean;
  /**
   * KMS 公钥（**部署配置**；缺省读 `MDOP_KMS_PUBKEY`）。
   * 会话见证的验签只认它——MUST NOT 取自消息，否则控制面被攻破即可连公钥一起换。
   */
  kmsPublicKey?: string;
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class MdopAttestationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MdopAttestationService.name);
  private anchorTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(MdopAttestationEntity, "controlplane")
    private readonly rows: Repository<MdopAttestationEntity>,
    @Optional()
    @Inject("MDOP_ATTESTATION_DEPS")
    private readonly deps: AttestationDeps = {},
    /** 证明摘要上链（任务 5.6）。链不可达时降级为本地回执，**不写假交易号**。 */
    @Optional() private readonly chain?: AttestationService,
  ) {}

  /**
   * 补锚节拍：**链不可达时留下的未锚登记必须有人去补**。
   *
   * 与回执链服务同一套路（那边 30 分钟一次）：没有定时器，`chainTx` 空着的登记只会躺在库里，
   * 「补锚」就成了一句无人执行的话。链恢复后由这里补上；补不上就继续等，**不写假交易号**。
   */
  onModuleInit(): void {
    this.anchorTimer = setInterval(() => {
      void this.retryPendingAnchors().catch((err) =>
        this.logger.warn(`证明摘要补锚失败：${(err as Error).message}`),
      );
    }, 30 * 60_000);
    this.anchorTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.anchorTimer) clearInterval(this.anchorTimer);
  }

  private trustedVerifiers(): readonly string[] {
    return this.deps.trustedVerifiers ?? envList("MDOP_ATTESTATION_VERIFIERS");
  }

  private registryMeasurements(): readonly string[] {
    return (
      this.deps.registryMeasurements ?? envList("MDOP_ATTESTATION_MEASUREMENTS")
    );
  }

  private kmsPublicKey(): string | undefined {
    return this.deps.kmsPublicKey ?? process.env.MDOP_KMS_PUBKEY;
  }

  /**
   * **会话见证的落库与转发入口**（任务 6.7 / D13）。
   *
   * 平台在这里只做三件事：严格解析（不受信输入）、用**部署配置里的 KMS 公钥**验签并核对
   * 证明声明与合约策略、把**本体**存下来并存进登记表。平台**不**声称自己验过厂商 quote——
   * 那需要厂商证明根（PCCS / trustee / VCD 等），属 KMS 或具备证明根的部署方。
   *
   * 校验委托给 `verifySessionWitness`（协议核里唯一一份判据），因此换链、换 KMS 实现都不影响这里。
   */
  async ingestWitness(input: {
    witness: unknown;
    /** 生效的证明策略（合约 ∩ 注册中心度量白名单，由调用方算好）。 */
    policy: AttestationPolicy;
    /** 凭证里为**该节点**冻结的执行环境期望（有就一并核对）。 */
    expectation?: AttestationExpectation;
    now?: Date;
  }): Promise<MdopAttestationEntity> {
    const kmsPublicKey = this.kmsPublicKey();
    if (!kmsPublicKey)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        {},
        "未配置 KMS 公钥（MDOP_KMS_PUBKEY）——不得在没有验签凭据的情况下登记见证",
      );

    const { witness, session } = verifySessionWitness({
      witness: input.witness,
      kmsPublicKey,
      policy: input.policy,
      ...(input.expectation ? { expectation: input.expectation } : {}),
      ...(input.now ? { now: input.now } : {}),
    });

    const measurements = this.registryMeasurements();
    if (
      measurements.length > 0 &&
      !measurements.includes(witness.report.measurement)
    )
      throw new MdopError(
        "E_MEASUREMENT_NOT_ALLOWED",
        { node: witness.node },
        "度量不在注册中心白名单内",
      );

    // 见证路径的验签已经做完（`verifySessionWitness`：KMS 签名 + 绑定 + 一次性公钥指纹 + 有效期 +
    // 证明声明 + 期望），因此这里不再要求部署方注入摘要级的 `verifyWarrant` 钩子——
    // 那个钩子是给「只上报摘要」的旧口径用的；两处判据不重复造。
    const row = await this.register(
      {
        node: witness.node,
        kind: witness.report.kind ?? "software",
        measurement: witness.report.measurement,
        tcb: witness.report.tcb,
        quoteDigest: witness.report.quote_digest ?? "",
        verifiedBy: witness.warrant.kms,
        verifiedAt: witness.warrant.issued_at,
        expiresAt: witness.report.expires_at,
        warrantDigest: witness.warrant.warrant_digest,
        sessionKey: witness.warrant.warrant_digest,
        report: witness.report as unknown as Record<string, unknown>,
        warrant: witness.warrant as unknown as Record<string, unknown>,
        // 会话上下文（任务 7.4）：没有它就无法回答「这个作业的会话证明是哪几条」
        jobId: witness.job_id,
        credentialId: witness.credential_id,
        contractId: witness.contract_id,
        keyId: witness.key_id,
      },
      input.now ?? new Date(),
      { witnessVerified: true },
    );
    this.logger.log(
      `会话见证已登记 node=${witness.node} kms=${witness.warrant.kms} warrant=${session.digest.slice(0, 16)}…`,
    );
    return row;
  }

  /**
   * **作业之前的证明登记**（部署侧推送，D-TEE-6）。
   *
   * 为什么需要它：编译期放置 C2 要求目标节点有一份**未过期**的登记，而会话见证来自一次
   * **作业绑定**的 KMS 密钥释放——作业还没编译就不存在释放（先有鸡还是先有蛋）。因此由
   * 白名单内的校验方（KMS / 证明服务）在**作业之前**推送一份签名的证明摘要：
   *
   *   校验方（部署密钥签名）→ `{verifier, endorsement}` → 平台用**部署配置的 KMS 公钥**验签
   *   → 走既有 `register`（白名单 / 链型 / 度量清单 / 有效期 / 幂等）
   *
   * 平台**仍然不自己验 quote**：它检的是「配置白名单内的校验方已验过」这件事本身。
   * 校验方公钥取自部署配置（`MDOP_KMS_PUBKEY`），MUST NOT 取自推送体。
   */
  async acceptEndorsement(
    push: unknown,
    now: Date = new Date(),
  ): Promise<MdopAttestationEntity> {
    const kmsPublicKey = this.kmsPublicKey();
    if (!kmsPublicKey)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        {},
        "未配置 KMS 公钥（MDOP_KMS_PUBKEY）——不得在无法验签的情况下登记背书",
      );
    const { verifier, endorsement } = verifyEndorsementPush({
      push,
      verifierPublicKey: kmsPublicKey,
      trustedVerifiers: this.trustedVerifiers(),
      now,
    });
    // 验签已在上一步完成（含校验方身份），因此这里按「已校验」入库；白名单与度量清单仍在 register 里判
    return this.register(
      {
        node: endorsement.node,
        kind: endorsement.kind,
        measurement: endorsement.measurement,
        tcb: endorsement.tcb,
        quoteDigest: endorsement.quoteDigest,
        // 背书没有会话凭据：以节点 + quote 摘要为去重键，历史保留
        verifiedBy: verifier,
        verifiedAt: endorsement.verifiedAt,
        expiresAt: endorsement.expiresAt,
        sessionKey: `endorsement:${endorsement.node}:${endorsement.quoteDigest}`,
      },
      now,
      { witnessVerified: true },
    );
  }

  /**
   * 登记一份**已由可信校验方校验通过**的证明。任一项不过即拒：
   *  - 链型不在受支持集合 → `E_ATTESTATION_FAILED`
   *  - 校验方不在部署白名单 → `E_ATTESTATION_FAILED`（防止自报「我已校验」）
   *  - 释放凭据验不过（或没有验签器）→ `E_ATTESTATION_FAILED`
   *  - 度量不在注册中心白名单 → `E_MEASUREMENT_NOT_ALLOWED`
   *  - 已过期 → `E_ATTESTATION_FAILED`
   * 幂等：同一 `node#quoteDigest` 重复登记返回原记录（不覆盖历史）。
   */
  async register(
    input: AttestationWarrant,
    now: Date = new Date(),
    // `witnessVerified`：调用方（会话见证路径）已经用 KMS 公钥**完整验签**过这份见证，
    // 因此不再要求部署方额外注入摘要级钩子；默认（旧口径）仍然要求它，缺即拒（fail-closed）。
    opts: { witnessVerified?: boolean } = {},
  ): Promise<MdopAttestationEntity> {
    if (!(TEE_KINDS as readonly string[]).includes(input.kind))
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node: input.node },
        "不支持的证明链型",
      );

    const verifiers = this.trustedVerifiers();
    if (verifiers.length === 0 || !verifiers.includes(input.verifiedBy))
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node: input.node },
        "校验方不在部署配置的证明白名单内",
      );

    if (!opts.witnessVerified) {
      if (!this.deps.verifyWarrant || !this.deps.verifyWarrant(input))
        throw new MdopError(
          "E_ATTESTATION_FAILED",
          { node: input.node },
          "释放凭据验签未通过",
        );
    }
    if (input.kind !== "software" && !input.quoteDigest)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node: input.node },
        "硬件证明缺 quote 摘要",
      );

    const measurements = this.registryMeasurements();
    if (!measurements.includes(input.measurement))
      throw new MdopError(
        "E_MEASUREMENT_NOT_ALLOWED",
        { node: input.node },
        "度量不在注册中心白名单内",
      );

    const expires = Date.parse(input.expiresAt);
    if (!Number.isFinite(expires) || expires <= now.getTime())
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node: input.node },
        "证明已过期",
      );

    // 一次会话一条：会话见证按 `sessionKey`（释放凭据摘要）分行，历史保留；
    // 仅有个摘要的旧口径（会话内没有凭据）仍按 `node#quoteDigest` 去重。
    const id = `${input.node}#${input.sessionKey ?? input.quoteDigest}`;
    const existing = await this.rows.findOne({ where: { id } });
    if (existing) return existing; // 幂等：同一份证明不重复登记

    const row = this.rows.create({
      id,
      node: input.node,
      kind: input.kind,
      measurement: input.measurement,
      tcb: input.tcb ?? null,
      quoteDigest: input.quoteDigest,
      verifiedAt: input.verifiedAt,
      expiresAt: input.expiresAt,
      verifiedBy: input.verifiedBy,
      warrantDigest: input.warrantDigest ?? null,
      report: input.report ?? null,
      warrant: input.warrant ?? null,
      jobId: input.jobId ?? null,
      credentialId: input.credentialId ?? null,
      contractId: input.contractId ?? null,
      keyId: input.keyId ?? null,
      chainTx: null,
      chainBlock: null,
    });
    await this.rows.save(row);
    this.logger.log(
      `证明已登记 node=${input.node} kind=${input.kind} tcb=${input.tcb ?? "-"} by=${input.verifiedBy}`,
    );
    // 证明摘要上链：与回执链头同一条通道（复用存证适配器），失败降级、不阻断登记。
    // 失败时 chainTx 留空 —— 这条登记随即进补偿队列（`retryPendingAnchors`），不是「放弃锚定」。
    await this.anchorQuoteDigest(row);
    return row;
  }

  /** 该节点**最新且未过期**的一条登记（编译期放置用）。 */
  async latestFor(
    node: string,
    now: Date = new Date(),
  ): Promise<MdopAttestationEntity | null> {
    const rows = await this.rows.find({
      where: { node },
      order: { verifiedAt: "DESC" },
    });
    return rows.find((r) => Date.parse(r.expiresAt) > now.getTime()) ?? null;
  }

  /**
   * 编译期判定：该节点能否作为 C2 目标。
   * 返回登记记录（供凭证冻结 `{tee, measurement, min_tcb}` 用）。
   */
  async assertUsableForC2(
    node: string,
    policy: AttestationPolicy,
    now: Date = new Date(),
  ): Promise<MdopAttestationEntity> {
    const row = await this.latestFor(node, now);
    if (!row)
      throw new MdopError(
        "E_ATTESTATION_FAILED",
        { node },
        "该节点没有有效的证明登记（未登记或已过期）",
      );

    if (!policy.tee.includes(row.kind))
      throw new MdopError(
        "E_CAPABILITY_MISMATCH",
        { node },
        "该节点的证明链型不在合约允许范围内",
      );

    // 合约只能更严：注册中心白名单是上限（交集为空即拒，不退化成「不限」）
    const effective = resolveMeasurementWhitelist({
      registryWhitelist: this.registryMeasurements(),
      policy,
      where: { node },
    });
    if (!effective.includes(row.measurement))
      throw new MdopError(
        "E_MEASUREMENT_NOT_ALLOWED",
        { node },
        "该节点的度量不在生效白名单内",
      );

    const threshold =
      typeof policy.min_tcb === "string"
        ? policy.min_tcb
        : policy.min_tcb?.[row.kind];
    if (threshold !== undefined) {
      if (!row.tcb)
        throw new MdopError(
          "E_TCB_TOO_OLD",
          { node },
          "登记未给出可信基版本，无法满足下限",
        );
      const cmp = compareTcb(row.tcb, threshold);
      if (cmp === null)
        throw new MdopError(
          "E_TCB_TOO_OLD",
          { node },
          "可信基版本与该链的下限不可比（不同链的版本体系不可互比）",
        );
      if (cmp < 0)
        throw new MdopError(
          "E_TCB_TOO_OLD",
          { node },
          "可信基版本低于合约下限",
        );
    }

    return row;
  }

  /** 记录证明摘要的链上锚定（链不可达时留空，MUST NOT 伪造交易号）。 */
  async recordAnchor(
    id: string,
    chainTx: string,
    chainBlock?: number,
  ): Promise<void> {
    if (!chainTx || chainTx.startsWith("0xLOCAL:")) return; // 降级回执不上链，也不记假号
    await this.rows.update({ id }, { chainTx, chainBlock: chainBlock ?? null });
  }

  /**
   * 待补锚的登记（`chainTx` 为空即视为未锚）。
   *
   * 注意「未锚」**不等于「登记无效」**：登记本身已生效（编译期放置照走、凭证照冻结），
   * 补偿只影响**可核验性**——第三方拿不到交易号就没法独立确认「这份证明摘要确实被锚过」。
   */
  async pendingAnchors(): Promise<MdopAttestationEntity[]> {
    const rows = await this.rows.find();
    return rows.filter((r) => !r.chainTx);
  }

  /**
   * 补偿队列：把链不可达时未锚上的证明摘要补锚。幂等——已锚的跳过；补锚仍失败则保持空值
   * （**不写假交易号**），等下一轮节拍再试。
   */
  async retryPendingAnchors(): Promise<number> {
    if (!this.chain) return 0;
    let anchored = 0;
    for (const row of await this.pendingAnchors()) {
      const receipt = await this.anchorQuoteDigest(row);
      if (receipt) anchored += 1;
    }
    if (anchored > 0)
      this.logger.log(`证明摘要补锚 ${anchored} 条（补偿队列）`);
    return anchored;
  }

  /**
   * 证明摘要上链的**唯一实现**：登记与补锚共用同一段 payload 与同一条通道。
   *
   * 为什么不让两处各写一遍：payload 是链上留痕的对外形状，两处漂移会让「同一份证明」
   * 在链上出现两种记录，第三方核验时无从对齐。成功返回回执；降级回执（`0xLOCAL:`）与异常
   * 一律返回 `null`，调用方据此把该行留在补偿队列里。
   */
  private async anchorQuoteDigest(row: {
    id: string;
    node: string;
    kind: string;
    measurement: string;
    quoteDigest: string;
  }): Promise<{ txHash: string; block?: number } | null> {
    if (!this.chain) return null;
    try {
      const receipt = await this.chain.anchor(
        `SM3:${row.quoteDigest.replace(/^sm3:/i, "")}`,
        {
          source: "mdop-attestation",
          node: row.node,
          kind: row.kind,
          measurement: row.measurement,
        } as never,
      );
      // 降级回执（链不可达）不是交易号：留空等补锚
      if (!receipt?.txHash || receipt.txHash.startsWith("0xLOCAL:"))
        return null;
      await this.rows.update(
        { id: row.id },
        { chainTx: receipt.txHash, chainBlock: receipt.block ?? null },
      );
      return {
        txHash: receipt.txHash,
        ...(receipt.block !== undefined ? { block: receipt.block } : {}),
      };
    } catch (err) {
      this.logger.warn(
        `证明摘要上链失败（进补偿队列）：${(err as Error).message}`,
      );
      return null;
    }
  }
}

/** 便于测试与调用方使用：把链型收窄成协议枚举。 */
export function asTeeKind(kind: string): TeeKind {
  if (!(TEE_KINDS as readonly string[]).includes(kind))
    throw new MdopError("E_ATTESTATION_FAILED", {}, "不支持的证明链型");
  return kind as TeeKind;
}
