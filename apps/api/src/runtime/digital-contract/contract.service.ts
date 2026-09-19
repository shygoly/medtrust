import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  DigitalContract,
  ContractStatus,
  ContractPreReview,
  ContractPreReviewAck,
  DigitalContractEntity,
  Pricing,
  OutputPolicy,
  resolveOutputPolicy,
  outputLabelFromPreset,
  buildOutputPolicy,
  presetFromOutputLabel,
} from "@medtrust/database";
import { CatalogService } from "../catalog/catalog.service";
import { participantMatches } from "./participant-aliases";
import { AttestationService } from "./attestation.service";
import { AlgorithmModuleRegistry } from "../connector-modules/algorithm-module.registry";
import { ComplianceService } from "../../capability/l2-compliance/compliance.service";
import { deriveDataSensitivity } from "../../capability/l2-compliance/dimensions";
import type { RiskDimensions } from "../../capability/l2-compliance/engine.types";

export interface ContractRequest {
  dataProductId: string;
  /** 引用的合规预审组合 ID（D-CMP-2）；request 必填，approve/种子按需。 */
  compositionId?: string;
  providerId: string;
  consumerId: string;
  purpose: string;
  retention: string;
  output: string;
  /** Optional override; otherwise derived from `output` label.
   *  放宽为 Partial：DTO 侧只提交 preset/minCell/dp，allowedArtifacts 由 resolveOutputPolicy 补全。 */
  outputPolicy?: Partial<OutputPolicy>;
  /** Convenience: set minCell on the derived/declared policy (floor 5). */
  minCell?: number;
  validDays: number;
  pricing?: Pricing; // 计价条款(10.1);无则该合约下的任务不产生结算
  /**
   * algorithm-sandbox「固定算法模块」条款:分析类型 → 模块 SM3。
   * 数据提供方批准合约即表示同意仅以该份模块代码执行该分析类型;计入合约哈希,
   * 改动只能新建合约(不得修改已存证合约)。
   */
  pinnedModules?: Record<string, string>;
}

/** Consumer applies against a catalog product; providerId is resolved server-side. */
export type ContractApplyInput = Omit<
  ContractRequest,
  "consumerId" | "providerId"
>;

export type ContractListItem = DigitalContract & {
  effectiveStatus: ContractStatus;
  canApprove: boolean;
};

export interface ContractViewer {
  role?: string;
  participantId?: string;
}

// 数字合约管理(digital-contract spec) + 使用控制策略生成(usage-control 4.1/4.2)。
// 数据提供方批准一次申请 → 生成生效的数字合约(含 SM3 哈希),供下发到连接器。
// 持久化在 control-plane 库。
@Injectable()
export class ContractService implements OnModuleInit {
  constructor(
    private readonly gm: GMCryptoService,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly repo: Repository<DigitalContractEntity>,
    private readonly catalog: CatalogService,
    @Optional() private readonly attestationService?: AttestationService,
    @Optional() private readonly algorithmModules?: AlgorithmModuleRegistry,
    // 预审服务（D-CMP-2）：合约申请重裁决 + 种子合约挂预审快照。DI 按类型注入；
    // 末位 @Optional 以兼容既有手工构造 new ContractService(gm, repo, catalog, ...)。
    @Optional() private readonly compliance?: ComplianceService,
  ) {}

  // 幂等演示种子。写入 canonical seed:* 行,并清除旧版中文 ID 的遗留种子。
  async onModuleInit(): Promise<void> {
    const demos: ContractRequest[] = [
      {
        dataProductId: "dp-insulin-panc-huashan",
        providerId: "p-huashan",
        consumerId: "p-meddata",
        purpose: "胰岛素暴露·胰腺炎信号演示研究",
        retention: "阅后即焚",
        output: "聚合 + 模型参数",
        validDays: 90,
      },
      {
        dataProductId: "dp-ckd-imaging",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "肾脏影像多中心研究",
        retention: "阅后即焚",
        output: "仅模型增量",
        validDays: 90,
      },
      {
        dataProductId: "dp-ckd-imaging",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "肾脏影像联合建模",
        retention: "30 天",
        output: "仅模型增量",
        validDays: 60,
      },
      {
        dataProductId: "dp-ckd-lab",
        providerId: "p-huashan",
        consumerId: "p-smartmed",
        purpose: "检验指标异常筛查模型训练",
        retention: "阅后即焚",
        output: "仅聚合统计",
        validDays: 30,
      },
      // 瑞金胰岛素/胰腺炎演示队列 → p-meddata。RWS L1–L3 与 FL L4 的瑞金 provider
      // 均依赖此合约（parties: p-ruijin / dp-insulin-panc-ruijin）。此前未种子化，只能手工创建成
      // 一次性 UUID；Fly ephemeral 库每次重部署即被清空，导致 FL admission 报
      // “存在无效的数字合约引用”(403)。种子化后 ID 稳定、重部署幂等复现。
      {
        dataProductId: "dp-insulin-panc-ruijin",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "胰岛素暴露·胰腺炎信号演示研究",
        retention: "阅后即焚",
        output: "聚合 + 模型参数",
        validDays: 90,
      },
      // AMR Sentinel Q1 — 双院药敏分离株（合成 fallback）
      {
        dataProductId: "dp-amr-ast-huashan",
        providerId: "p-huashan",
        consumerId: "p-meddata",
        purpose: "抗菌药物耐药监测真实世界研究",
        retention: "阅后即焚",
        output: "仅聚合",
        validDays: 90,
      },
      {
        dataProductId: "dp-amr-ast-ruijin",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: "抗菌药物耐药监测真实世界研究",
        retention: "阅后即焚",
        output: "仅聚合",
        validDays: 90,
      },
    ];

    const legacy = await this.repo.find();
    const activeDemoIds = new Set(demos.map((d) => this.seedContractId(d)));
    for (const row of legacy) {
      if (!row.id.startsWith("seed:")) continue;
      const hasLegacyPartyId = /[\u4e00-\u9fff]/.test(
        `${row.id}|${row.providerId}|${row.consumerId}`,
      );
      const renamedProduct =
        row.dataProductId === "dp-ckd-ehr" ||
        row.dataProductId === "dp-dkd-cohort" ||
        row.id.includes("dp-ckd-ehr") ||
        row.id.includes("dp-dkd-cohort");
      const staleSeed = !activeDemoIds.has(row.id);
      if (hasLegacyPartyId || renamedProduct || staleSeed) {
        await this.repo.delete({ id: row.id });
      }
    }

    for (const d of demos) {
      const preReview = await this.seedPreReview(d.consumerId, d.dataProductId);
      await this.approve(d, this.seedContractId(d), preReview);
    }
  }

  // 演示种子合约的配套预审快照（D-CMP-2 / design D7）：medium 场景 + federated 协议 → auto_approve。
  // 需能力注册表已 seed（线上持久库已在；未 seed 时返回 null，合约无快照、不能建新任务）。
  private async seedPreReview(
    consumerId: string,
    dataProductId: string,
  ): Promise<ContractPreReview | null> {
    if (!this.compliance) return null;
    try {
      const compositionId = `seed-comp:${dataProductId}:${consumerId}`;
      await this.compliance.upsertSeedComposition(
        compositionId,
        {
          scenarioKey: "multi-center-clinical-research", // medium、已落地
          modelKeys: [
            "disproportionality-prr-ror",
            "mantel-haenszel-or",
            "logistic-regression",
            "cox-ph",
            "kaplan-meier-estimator",
          ],
          algorithmKeys: ["federated-learning"],
          protocolKeys: ["federated-local-compute"], // federated 保障级
        },
        consumerId,
      );
      const facts: Partial<RiskDimensions> = {};
      const level = (await this.catalog.get(dataProductId))?.classificationTag
        ?.level;
      const ds = deriveDataSensitivity(level);
      if (ds) facts.dataSensitivity = ds;
      const evaluation = await this.compliance.evaluate(compositionId, facts);
      if (evaluation.autoVerdict === "block") {
        console.warn(
          `种子预审被驳回(可能能力注册表未 seed)：${compositionId} → ${evaluation.blockingRulesMatched?.join(",") ?? ""}`,
        );
        return null;
      }
      return this.compliance.toSnapshot(
        evaluation,
      ) as unknown as ContractPreReview;
    } catch (err) {
      console.warn(
        `种子预审生成失败(可能能力注册表未 seed)：${dataProductId}/${consumerId}`,
        (err as Error)?.message,
      );
      return null;
    }
  }

  private seedContractId(d: ContractRequest): string {
    const purposeKey = d.purpose.replace(/\s+/g, "-").slice(0, 32);
    return `seed:${d.dataProductId}:${d.consumerId}:${purposeKey}`;
  }

  async approve(
    req: ContractRequest,
    id: string = randomUUID(),
    preReview?: ContractPreReview | null,
  ): Promise<DigitalContract> {
    const validUntil = new Date(
      Date.now() + req.validDays * 86_400_000,
    ).toISOString();
    const outputPolicy = this.materializePolicy(req);
    const pinnedModules = this.validatePinnedModules(req.pinnedModules);
    const base: Omit<DigitalContract, "hash"> = {
      id,
      dataProductId: req.dataProductId,
      providerId: req.providerId,
      consumerId: req.consumerId,
      purpose: req.purpose,
      retention: req.retention,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      validUntil,
      status: "active",
      ...(req.pricing ? { pricing: req.pricing } : {}),
      ...(pinnedModules ? { pinnedModules } : {}),
      ...(preReview ? { preReview } : {}),
    };
    const contract: DigitalContract = {
      ...base,
      hash: "SM3:" + this.gm.sm3Hash(this.canonical(base)),
    };
    await this.repo.save(this.repo.create(contract));
    return contract;
  }

  /** 药企发起合约申请 → draft，待医院审批（providerId 由目录产品决定） */
  async request(
    req: ContractApplyInput,
    consumerId: string,
  ): Promise<DigitalContract> {
    if (!consumerId) throw new BadRequestException("未绑定参与方身份");
    const product = await this.catalog.get(req.dataProductId);
    if (!product) throw new BadRequestException("数据产品不存在");
    // P1-1:已下架(archived)目录产品不可新申请;存量合约不受影响。
    if (product.status === "archived") {
      throw new BadRequestException("数据产品已下架,不可发起新申请");
    }

    // D-CMP-2 预审绑定：必须引用一份属于本方的预审 → 按当前规则 + 推导维度重裁决 → 驳回则拒 → 快照入草稿。
    if (!this.compliance) {
      throw new BadRequestException("合规预审服务不可用,无法申请合约");
    }
    if (!req.compositionId) {
      throw new BadRequestException(
        "合约申请必须引用一份合规预审(compositionId)",
      );
    }
    const composition = await this.compliance.getComposition(req.compositionId);
    if (!composition) {
      throw new BadRequestException("引用的合规预审不存在");
    }
    if (
      !composition.ownerParticipantId ||
      !participantMatches(consumerId, composition.ownerParticipantId)
    ) {
      throw new ForbiddenException("只能引用属于本方的合规预审");
    }
    const facts: Partial<RiskDimensions> = {};
    const ds = deriveDataSensitivity(product.classificationTag?.level);
    if (ds) facts.dataSensitivity = ds;
    const evaluation = await this.compliance.evaluate(req.compositionId, facts);
    if (evaluation.autoVerdict === "block") {
      throw new BadRequestException(
        `合规预审驳回:命中 ${evaluation.blockingRulesMatched.join("、") || "阻断规则"}`,
      );
    }
    const preReview = this.compliance.toSnapshot(
      evaluation,
    ) as unknown as ContractPreReview;

    const validUntil = new Date(
      Date.now() + req.validDays * 86_400_000,
    ).toISOString();
    const outputPolicy = this.materializePolicy(req);
    const draft: DigitalContract = {
      id: randomUUID(),
      dataProductId: req.dataProductId,
      providerId: product.providerId,
      consumerId,
      purpose: req.purpose,
      retention: req.retention,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      validUntil,
      status: "draft",
      preReview,
    };
    await this.repo.save(this.repo.create(draft));
    return draft;
  }

  /** 医院审批 draft 申请 → active（重算有效期 + SM3 哈希） */
  async approveDraft(
    id: string,
    providerParticipantId: string,
    pinnedModulesInput?: Record<string, string>,
    preReviewAckInput?: { reason?: string },
  ): Promise<DigitalContract> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException("数字合约不存在");
    if (existing.status !== "draft")
      throw new BadRequestException("仅待审批申请可签发");
    if (!participantMatches(providerParticipantId, existing.providerId)) {
      throw new ForbiddenException("仅数据提供方可审批本机构合约申请");
    }
    // 8.1 真实性最小闭环(P0-7):消费方须先确认规则知悉,方可签发。
    if (!existing.consumerAcknowledgedAt) {
      throw new BadRequestException("消费方尚未确认规则知悉");
    }
    // D-CMP-2 需审批确认:预审裁决为 manual_review 时医院签发须显式确认并填理由;
    // 裁决为 auto_approve 时不接受该入参;确认记录计入合约哈希。
    let preReviewAck: ContractPreReviewAck | undefined;
    const verdict = existing.preReview?.verdict;
    if (verdict === "manual_review") {
      const reason = preReviewAckInput?.reason?.trim();
      if (!reason) {
        throw new BadRequestException(
          "预审裁决为「需审批」,签发须显式确认并填写理由(preReviewAck.reason)",
        );
      }
      preReviewAck = {
        by: providerParticipantId,
        reason,
        at: new Date().toISOString(),
      };
    } else if (preReviewAckInput !== undefined) {
      throw new BadRequestException(
        "预审裁决非「需审批」,不接受确认入参(preReviewAck)",
      );
    }

    // P1-7:保留知悉时的 validUntil,避免签发重算时间戳导致 acknowledgedHash 失配。
    // 若申请已过期,再给最少 1 天宽限以便签发后仍可演示解除/履行。
    const validUntil =
      new Date(existing.validUntil).getTime() > Date.now()
        ? existing.validUntil
        : new Date(Date.now() + 86_400_000).toISOString();
    const outputPolicy = resolveOutputPolicy(existing);
    const pinnedModules =
      this.validatePinnedModules(pinnedModulesInput) ??
      existing.pinnedModules ??
      undefined;
    const base: Omit<DigitalContract, "hash"> = {
      ...existing,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      validUntil,
      status: "active",
      ...(pinnedModules ? { pinnedModules } : {}),
      ...(preReviewAck ? { preReviewAck } : {}),
    };
    const contract: DigitalContract = {
      ...base,
      hash: "SM3:" + this.gm.sm3Hash(this.canonical(base)),
    };
    await this.repo.save(contract);
    // P1-2:签发成功后自动备案(异步补偿,不阻塞签发);回执回写合约表。
    void this.autoAttest(contract);
    return contract;
  }

  /** P1-2 手动/自动备案回执回写合约表。 */
  async writeAttestationReceipt(
    id: string,
    txHash: string,
    block: number,
  ): Promise<void> {
    await this.repo.update(
      { id },
      {
        attestationTxHash: txHash,
        attestationBlock: block,
        attestedAt: new Date().toISOString(),
      },
    );
  }

  /** P1-2:异步锚定合约哈希并把链上/本地回执回写合约表。 */
  private async autoAttest(contract: DigitalContract): Promise<void> {
    if (!this.attestationService) return;
    try {
      const receipt = await this.attestationService.attestContract(contract);
      await this.repo.update(
        { id: contract.id },
        {
          attestationTxHash: receipt.txHash,
          attestationBlock: receipt.block,
          attestedAt: new Date().toISOString(),
        },
      );
      console.log(
        `合约已备案 contract=${contract.id.slice(0, 8)} tx=${receipt.txHash}`,
      );
    } catch (err) {
      // 备案失败不阻塞签发;补偿重试可通过 POST /contracts/:id/attest 手动触发。
      console.warn(`合约自动备案失败 contract=${contract.id}`, err);
    }
  }

  /** P1-7:合约完整性校验——重算 canonical SM3 与存储哈希、链上回执三方比对。 */
  async verifyIntegrity(id: string): Promise<{
    id: string;
    valid: boolean;
    storedHash?: string;
    recomputedHash: string;
    hashMatch: boolean;
    acknowledgedValid: boolean | null;
    chain: {
      valid: boolean;
      attestation?: {
        dataHash: string;
        timestamp: number;
        signer: string;
      } | null;
    } | null;
  }> {
    const contract = await this.get(id);
    if (!contract) throw new NotFoundException("数字合约不存在");
    const recomputedHash = "SM3:" + this.gm.sm3Hash(this.canonical(contract));
    const hashMatch = !!contract.hash && contract.hash === recomputedHash;
    const acknowledgedValid = contract.consumerAcknowledgedAt
      ? contract.acknowledgedHash ===
        "SM3:" +
          this.gm.sm3Hash(this.canonical(contract) + "|" + contract.consumerId)
      : null;
    const chain = this.attestationService
      ? await this.attestationService.verify(recomputedHash)
      : null;
    return {
      id,
      valid: hashMatch && (chain ? chain.valid : true),
      storedHash: contract.hash,
      recomputedHash,
      hashMatch,
      acknowledgedValid,
      chain,
    };
  }

  /** 消费方确认规则知悉(P0-7):记录确认时间 + 合约哈希 + 用户身份。 */
  async acknowledge(id: string, consumerId: string): Promise<DigitalContract> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException("数字合约不存在");
    if (!participantMatches(consumerId, existing.consumerId)) {
      throw new ForbiddenException("仅数据使用方可确认规则知悉");
    }
    const consumerAcknowledgedAt = new Date().toISOString();
    const acknowledgedHash =
      "SM3:" + this.gm.sm3Hash(this.canonical(existing) + "|" + consumerId);
    const updated: DigitalContract = {
      ...existing,
      consumerAcknowledgedAt,
      acknowledgedHash,
    };
    await this.repo.save(updated);
    return updated;
  }

  /** 医院驳回 draft 申请 */
  async rejectDraft(
    id: string,
    providerParticipantId: string,
  ): Promise<DigitalContract> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException("数字合约不存在");
    if (existing.status !== "draft")
      throw new BadRequestException("仅待审批申请可驳回");
    if (!participantMatches(providerParticipantId, existing.providerId)) {
      throw new ForbiddenException("仅数据提供方可驳回本机构合约申请");
    }
    await this.repo.update({ id }, { status: "revoked" });
    return { ...existing, status: "revoked" };
  }

  // 生效状态(惰性计算过期)。PEP 与编排都应以此为准。
  effectiveStatus(contract: DigitalContract, now = Date.now()): ContractStatus {
    if (contract.status === "revoked") return "revoked";
    if (contract.status === "draft") return "draft";
    if (new Date(contract.validUntil).getTime() < now) return "expired";
    return contract.status;
  }

  async revoke(
    id: string,
    providerParticipantId: string,
    reason?: string,
  ): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException("数字合约不存在");
    if (!participantMatches(providerParticipantId, existing.providerId)) {
      throw new ForbiddenException("仅数据提供方可解除本机构合约");
    }
    if (this.effectiveStatus(existing) !== "active") {
      throw new BadRequestException("仅生效中的合约可解除");
    }
    await this.repo.update(
      { id },
      { status: "revoked", revokeReason: reason ?? null },
    );
  }

  async get(id: string): Promise<DigitalContract | undefined> {
    return (await this.repo.findOne({ where: { id } })) ?? undefined;
  }

  // Lists contracts with effective status + whether the current viewer may approve.
  async list(viewer: ContractViewer = {}): Promise<ContractListItem[]> {
    const all = await this.repo.find();
    return all.map((c) => {
      const effectiveStatus = this.effectiveStatus(c);
      const canApprove =
        viewer.role === "provider" &&
        effectiveStatus === "draft" &&
        participantMatches(viewer.participantId, c.providerId);
      const outputPolicy = resolveOutputPolicy(c);
      return {
        ...c,
        output: outputLabelFromPreset(outputPolicy.preset),
        outputPolicy,
        effectiveStatus,
        canApprove,
      };
    });
  }

  /** Normalize request → structured outputPolicy (preset from label or body). */
  private materializePolicy(
    req: Pick<ContractRequest, "output" | "outputPolicy" | "minCell">,
  ): OutputPolicy {
    if (req.outputPolicy) {
      return resolveOutputPolicy({
        output: req.output,
        outputPolicy: {
          ...req.outputPolicy,
          minCell: req.minCell ?? req.outputPolicy.minCell,
        },
      });
    }
    const preset = presetFromOutputLabel(req.output);
    return buildOutputPolicy(preset, { minCell: req.minCell });
  }

  private canonical(c: Omit<DigitalContract, "hash">): string {
    const outputPolicy = resolveOutputPolicy(c);
    return JSON.stringify({
      dataProductId: c.dataProductId,
      providerId: c.providerId,
      consumerId: c.consumerId,
      purpose: c.purpose,
      retention: c.retention,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      validUntil: c.validUntil,
      // 计价进入哈希 → 计价随合约哈希上链(10.1);改金额即改哈希,事后调价不可抵赖
      pricing: c.pricing ?? null,
      // algorithm-sandbox:固定算法模块条款计入哈希 —— 改模块即改哈希,
      // 已存证合约不可修改,只能新建(design D5)。
      pinnedModules: normalizePinnedModules(c.pinnedModules),
      // D-CMP-2:预审裁决快照 + 需审批确认计入合约哈希 → 改快照/确认即验哈希失败,随合约存证上链。
      preReview: c.preReview ?? null,
      preReviewAck: c.preReviewAck ?? null,
    });
  }

  /**
   * 校验「固定算法模块」条款:分析类型 → 模块 SM3。
   * 只接受平台模块注册表里已登记、且分析类型与该模块一致的 SM3(CTL 双重校验第一半)。
   */
  private validatePinnedModules(
    input?: Record<string, string>,
  ): Record<string, string> | undefined {
    if (input === undefined || input === null) return undefined;
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException(
        "pinnedModules 须为 分析类型 → 模块 SM3 的对象",
      );
    }
    const normalized = normalizePinnedModules(input)!;
    for (const [analysisType, sm3] of Object.entries(normalized)) {
      if (!/^[0-9a-f]{64}$/.test(sm3)) {
        throw new BadRequestException(
          `固定模块的 SM3 非法(须为 64 hex 小写):${analysisType} → ${sm3}`,
        );
      }
      if (!this.algorithmModules) continue;
      const manifest = this.algorithmModules.manifest(sm3);
      if (!manifest) {
        throw new BadRequestException(
          `模块 ${sm3.slice(0, 16)}… 不在平台算法模块注册表内,不可固定`,
        );
      }
      if (manifest.analysisType !== analysisType) {
        throw new BadRequestException(
          `模块分析类型不符:条款声明 ${analysisType},注册表登记 ${manifest.analysisType}`,
        );
      }
    }
    return Object.keys(normalized).length ? normalized : undefined;
  }
}

/** 归一化固定模块条款:键排序 + SM3 小写 → 合约哈希稳定可复现。 */
export function normalizePinnedModules(
  input?: Record<string, string> | null,
): Record<string, string> | null {
  if (!input) return null;
  const out: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    out[key] = String(input[key]).toLowerCase();
  }
  return Object.keys(out).length ? out : null;
}
