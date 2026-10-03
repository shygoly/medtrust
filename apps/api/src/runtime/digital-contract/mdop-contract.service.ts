import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  Certificate as CertificateEntity,
  DigitalContractEntity,
  MdopOutboxEntity,
  type MdopContractTerms,
} from "@medtrust/database";
import {
  MdopError,
  parseMdopContract,
  participantUrn,
  sm2Verify,
  canonicalize,
} from "@medtrust/mdop";
import { CaService } from "../participant-identity/ca.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  buildCanonicalFromEntity,
  buildMdopContract,
  canonicalContractJson,
  isHolderSigned,
  withPlatformRecipient,
} from "./mdop-contract";

/**
 * 平台侧的 MDOP 合约流程（D-MDOP-4 / 规格「持有方签署的数字合约」，任务 5.2）。
 *
 *   医院网页批准（既有流程）→ 平台发 `ContractOffer` → 连接器本地确认并用本院私钥签
 *   `ContractAgree` → 平台验签 + 副署 → 激活。
 *
 * 只有**带有效持有方签名**的合约才能授权 MDOP 作业；没有签名的旧合约继续服务旧管线，
 * 但编译期会以 `E_CONTRACT_UNSIGNED` 拒绝（fail-closed，无宽限期）。
 */

export interface MdopOfferOptions {
  /** 平台作为接收方/合并方的 party id（缺省用 space 推导）。 */
  platformParty?: string;
  /** 接收方列表补充（药企等最终方）。 */
  extraRecipients?: MdopContractTerms["recipients"];
  /** 复核方式与时限；缺省人工复核 72 小时（合同缺省不自动放行）。 */
  review?: MdopContractTerms["review"];
  /** 伦理批件要求。 */
  ethics?: MdopContractTerms["ethics"];
  /** 允许的算子摘要（缺省取合约的 pinnedModules 摘要）。 */
  allowedOpDigests?: string[];
  /** 用途编码（缺省取合约 purpose）。 */
  purposeCode?: string;
  /**
   * 证明策略（C2 作业必需）。缺省不写进条款——即该合约**不允许任何可信空间节点目标**
   * （fail-closed）。给了就进入规范化与哈希，持有方签的就是这一版。
   */
  attestationPolicy?: MdopContractTerms["attestationPolicy"];
  /**
   * 服务计算协议标准（服务计算作业必需）。包含管道拓扑、算子白名单、参数空间与累积预算。
   */
  serviceProtocol?: MdopContractTerms["serviceProtocol"];
}

export interface MdopAgreeInput {
  contractId: string;
  /** 连接器签的规范化合约全文（JCS 串）——平台逐字节比对后验签。 */
  canonical: string;
  holderSignature: string;
  /** 本院声明用了哪种复核方式（如实留痕：auto 必须附策略名）。 */
  reviewNote?: string;
  /**
   * **消息层已认证的发送方 URN**（控制面消息路径传入；直连 REST 入口没有该上下文）。
   *
   * 给了就要求「发送方就是该合约的提供方」：签名只能证明「这份 canonical 是提供方签的」，
   * 不能证明「现在提交它的就是提供方」——不绑的话，任何拿到过这份签署全文的一方都能替它提交
   * （并让平台副署、把合约激活）。
   */
  senderUrn?: string;
}

@Injectable()
export class MdopContractService {
  readonly spaceId: string;

  constructor(
    private readonly gm: GMCryptoService,
    private readonly ca: CaService,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts: Repository<DigitalContractEntity>,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
    @InjectRepository(MdopOutboxEntity, "controlplane")
    private readonly outbox: Repository<MdopOutboxEntity>,
    @Optional() spaceId?: string,
  ) {
    this.spaceId = spaceId ?? process.env.SPACE_ID ?? "sh-med";
  }

  platformParty(): string {
    return participantUrn(this.spaceId, "platform");
  }

  private async mustGet(contractId: string): Promise<DigitalContractEntity> {
    const row = await this.contracts.findOne({ where: { id: contractId } });
    if (!row) throw new NotFoundException("数字合约不存在");
    return row;
  }

  /**
   * 生成 MDOP 条款（不改库）。条款一进 `mdopTerms` 就进入签名范围，
   * 改动只能重新走要约——这正是「持有方审过的那一版」的含义。
   */
  buildTerms(
    contract: DigitalContractEntity,
    opts: MdopOfferOptions = {},
  ): MdopContractTerms {
    const platformParty = opts.platformParty ?? this.platformParty();
    const pinned = contract.pinnedModules ?? {};
    const allowedOpDigests =
      opts.allowedOpDigests ??
      Object.values(pinned).map((v) => (typeof v === "string" ? v : v.sm3));
    return {
      recipients: withPlatformRecipient(
        (opts.extraRecipients ?? []).filter((r) => r.party !== platformParty),
        platformParty,
      ),
      purposeCode: opts.purposeCode ?? contract.purpose,
      allowedOpDigests,
      review: opts.review ?? { mode: "manual", deadlineHours: 72 },
      ethics: opts.ethics ?? { required: false, ref: null, validUntil: null },
      // provider kid 由 offer() 填入（要先查到该院的在册证书）
      providerPublicKeyKid: "",
      platformPublicKeyKid: this.gm.publicKeyKid(this.ca.platformNodePublicKey),
      preReviewSnapshot: contract.preReview?.evaluationId ?? null,
      publication:
        contract.outputPolicy?.minCell === undefined
          ? {}
          : { minCell: contract.outputPolicy.minCell },
      dataProductId: contract.dataProductId,
      ...(opts.attestationPolicy
        ? { attestationPolicy: opts.attestationPolicy }
        : {}),
      ...(opts.serviceProtocol
        ? { serviceProtocol: opts.serviceProtocol }
        : {}),
    };
  }

  /**
   * 发起合约要约（任务 5.2 第 1-2 步）：把条款写进合约并落发件箱，
   * 由长轮询把 `ContractOffer` 送给该院的连接器。
   */
  async offer(
    contractId: string,
    opts: MdopOfferOptions = {},
  ): Promise<{ contractId: string; canonical: string; offerId: string }> {
    const row = await this.mustGet(contractId);
    if (row.status !== "active") {
      throw new BadRequestException("只有生效中的合约可发起 MDOP 要约");
    }
    const providerCert = await this.findProviderCert(row.providerId);
    if (!providerCert) {
      throw new BadRequestException(
        "提供方连接器尚未注册证书，无法发出合约要约（平台不代生成参与方密钥）",
      );
    }

    const terms = this.buildTerms(row, opts);
    terms.providerPublicKeyKid = this.gm.publicKeyKid(
      providerCert.subjectPublicKey,
    );
    const canonical = buildCanonicalFromEntity(row, terms);

    await this.contracts.update(
      { id: contractId },
      {
        mdopTerms: terms,
        mdopStatus: "offered",
        mdopOfferedAt: new Date().toISOString(),
        // 新一轮要约作废旧签名：条款可能变了，旧签名不再覆盖当前条款。
        holderSignature: null,
        platformCountersignature: null,
      },
    );
    const offerId = `offer:${contractId}:${randomUUID()}`;
    // 新一轮要约必须**作废发件箱里的旧要约**：否则长轮询会一直把旧条款的
    // `ContractOffer` 重投给连接器，连接器按旧条款回 `ContractAgree`，平台以
    // 「签署内容与平台条款不一致」拒绝，那条消息永远无法确认 → 无限重投、整条
    // 链路卡死（实测踩到过：重启后旧要约与新要约同时在发件箱里）。
    await this.dropSupersededOffers(contractId);
    await this.enqueue({
      msgType: "ContractOffer",
      receiver: this.participantFor(row.providerId),
      idempotencyKey: offerId,
      body: { offer_id: offerId, contract_id: contractId, canonical },
    });
    return { contractId, canonical, offerId };
  }

  /**
   * 清掉发件箱里同一份合约的历史 `ContractOffer` / `ContractAgreeAck`：
   * 新一轮要约已取代它们的条款，旧要约会引出必然失败的旧签名，旧副署回执也会
   * 因为本地副本已换版而验签失败 —— 两者都会无限重投。
   */
  private async dropSupersededOffers(contractId: string): Promise<void> {
    for (const msgType of ["ContractOffer", "ContractAgreeAck"] as const) {
      const rows = await this.outbox.find({ where: { msg_type: msgType } });
      for (const row of rows) {
        const body = row.body as { contract_id?: string } | null;
        if (body?.contract_id === contractId)
          await this.outbox.delete({ id: row.id });
      }
    }
  }

  /**
   * 收到 `ContractAgree`（任务 5.2 第 3-5 步）：逐字节比对规范化合约 → 用**提供方连接器
   * 证书里的公钥**验签 → 平台节点密钥副署 → 激活。
   */
  async agree(input: MdopAgreeInput): Promise<DigitalContractEntity> {
    const row = await this.mustGet(input.contractId);
    const terms = row.mdopTerms;
    if (!terms)
      throw new BadRequestException("该合约没有 MDOP 条款，无法接受签署");
    if (row.mdopStatus === "terminated")
      throw new BadRequestException("合约已终止，不接受新的签署");

    // 0) 身份绑定（消息路径）：提交者必须就是该合约的提供方
    if (
      input.senderUrn !== undefined &&
      input.senderUrn !== this.participantFor(row.providerId)
    )
      throw new ForbiddenException(
        `合约 ${input.contractId} 的提供方是 ${this.participantFor(row.providerId)}，但提交方是 ${input.senderUrn}`,
      );

    // 1) 平台发布的条款与我们手上的一致（防「连接器签了另一版」）
    const expected = buildCanonicalFromEntity(row, terms);
    let signedContract: unknown;
    try {
      signedContract = parseMdopContract(JSON.parse(input.canonical));
    } catch {
      throw new BadRequestException(
        "签署的合约结构非法（缺字段或含未定义字段）",
      );
    }
    if (canonicalize(signedContract) !== canonicalize(JSON.parse(expected))) {
      throw new BadRequestException(
        "签署的合约内容与平台发布的条款不一致（字段被改动）",
      );
    }

    // 2) 用提供方连接器**登记在册**的公钥验签（不接受调用方自带的公钥）
    const cert = await this.findProviderCert(row.providerId);
    if (!cert)
      throw new BadRequestException("提供方连接器证书不在册，无法验签");
    const holderPublicKey = cert.subjectPublicKey;
    if (this.gm.publicKeyKid(holderPublicKey) !== terms.providerPublicKeyKid) {
      throw new ForbiddenException("连接器公钥与合约条款登记的指纹不符");
    }
    if (!sm2Verify(input.canonical, input.holderSignature, holderPublicKey)) {
      throw new ForbiddenException(
        "持有方签名验证失败（合约被改动或签名不匹配）",
      );
    }

    // 3) 平台副署 + 激活
    const countersignature = this.ca.signWith("platform-node", input.canonical);
    await this.contracts.update(
      { id: input.contractId },
      {
        holderSignature: input.holderSignature,
        platformCountersignature: countersignature,
        mdopStatus: "active",
        mdopAgreedAt: new Date().toISOString(),
      },
    );
    // 副署必须**回传连接器**：本地副本要带着平台副署才算生效（复核只认本地副本）。
    // 少了这一步，连接器的本地合约永远停在 pending，无法授权任何片段。
    await this.enqueue({
      msgType: "ContractAgreeAck",
      receiver: this.participantFor(row.providerId),
      idempotencyKey: `agree-ack:${input.contractId}`,
      body: {
        contract_id: input.contractId,
        canonical: input.canonical,
        holder_signature: input.holderSignature,
        platform_countersignature: countersignature,
      },
    });
    return this.mustGet(input.contractId);
  }

  /** 平台侧撤销/终止：向该院连接器发 `ContractTerminate`（任务 5.5）。 */
  async terminate(contractId: string, reason: string): Promise<void> {
    const row = await this.mustGet(contractId);
    if (row.mdopStatus === "unsigned") return; // 旧合约不涉 MDOP
    await this.contracts.update(
      { id: contractId },
      {
        mdopStatus: "terminated",
        mdopTerminatedAt: new Date().toISOString(),
        mdopTerminateReason: reason,
      },
    );
    await this.enqueue({
      msgType: "ContractTerminate",
      receiver: this.participantFor(row.providerId),
      idempotencyKey: `terminate:${contractId}`,
      body: { contract_id: contractId, reason },
    });
  }

  /**
   * MDOP 编译期的合约校验（规格「编译期标签、能力与合约校验」）：
   * 无持有方签名 → `E_CONTRACT_UNSIGNED`；非生效 → `E_CONTRACT_EXPIRED`；用途不符 → `E_PURPOSE_MISMATCH`。
   */
  async assertUsableForJob(
    contractId: string,
    purpose: string,
    now: Date = new Date(),
  ): Promise<DigitalContractEntity> {
    const row = await this.contracts.findOne({ where: { id: contractId } });
    if (!row) throw new MdopError("E_CONTRACT_UNSIGNED", {}, "合约不存在");
    if (!isHolderSigned(row))
      throw new MdopError(
        "E_CONTRACT_UNSIGNED",
        {},
        "合约没有持有方签名（旧合约仅服务旧管线）",
      );
    if (row.mdopStatus !== "active")
      throw new MdopError("E_CONTRACT_EXPIRED", {}, "合约已终止");
    if (new Date(row.validUntil).getTime() < now.getTime())
      throw new MdopError("E_CONTRACT_EXPIRED", {}, "合约已过期");
    const purposeCode = row.mdopTerms?.purposeCode ?? row.purpose;
    if (purposeCode !== purpose)
      throw new MdopError("E_PURPOSE_MISMATCH", {}, "用途编码与合约不符");
    return row;
  }

  /** 供连接器本地副本比对与第三方核验：某合约的规范化条款。 */
  async canonicalFor(contractId: string): Promise<string> {
    const row = await this.mustGet(contractId);
    if (!row.mdopTerms) throw new BadRequestException("该合约没有 MDOP 条款");
    return buildCanonicalFromEntity(row, row.mdopTerms);
  }

  /** 连接器可核验的合约对象（含双签名状态）。 */
  async describeForNode(contractId: string) {
    const row = await this.mustGet(contractId);
    if (!row.mdopTerms) throw new BadRequestException("该合约没有 MDOP 条款");
    const contract = buildMdopContract(row, row.mdopTerms);
    return {
      contract,
      canonical: canonicalContractJson(contract),
      holderSignature: row.holderSignature ?? null,
      platformCountersignature: row.platformCountersignature ?? null,
      mdopStatus: row.mdopStatus,
      recipients: contract.recipients.map((r) => r.party),
      /** 数据持有方（合约提供方）的 URN。它**不在** recipients 里（接收方是拿结果的一方）。 */
      holder: this.participantFor(contract.provider),
    };
  }

  private participantFor(participantId: string): string {
    return participantId.startsWith("urn:")
      ? participantId
      : participantUrn(this.spaceId, participantId);
  }

  private async findProviderCert(
    participantId: string,
  ): Promise<CertificateEntity | null> {
    const rows = await this.certs.find({ where: { participantId } });
    const active = rows.filter(
      (r) => !r.revoked && new Date(r.validUntil).getTime() >= Date.now(),
    );
    return active[0] ?? null;
  }

  /** 写发件箱（信封在投递时构造并签名，见 §7 消息通道）。 */
  private async enqueue(input: {
    msgType: string;
    receiver: string;
    idempotencyKey: string;
    body: Record<string, unknown>;
  }): Promise<void> {
    await this.outbox.save(
      this.outbox.create({
        id: `${input.msgType}:${input.idempotencyKey}`,
        msg_id: randomUUID(),
        msg_type: input.msgType,
        job_id: null,
        receiver: input.receiver,
        sender: this.platformParty(),
        idempotency_key: input.idempotencyKey,
        body: input.body,
      }),
    );
  }
}
