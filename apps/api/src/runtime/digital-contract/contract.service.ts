import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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
import {
  isPinnedModuleClause,
  pinnedModuleSm3,
  validatePinnedModuleClause,
  type PinnedModuleClause,
  type PinnedModuleSpec,
} from "@medtrust/wasm-algorithms";
import { ComplianceService } from "../../capability/l2-compliance/compliance.service";
import { deriveDataSensitivity } from "../../capability/l2-compliance/dimensions";
import type { RiskDimensions } from "../../capability/l2-compliance/engine.types";
import { isHolderSigned } from "./mdop-contract";
import { MdopContractService } from "./mdop-contract.service";
import { SpaceContextService } from "../space-context/space-context.service";
import { DataAccessService } from "../data-access/data-access.service";
import { AuditAction } from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import { NotificationService } from "../notifications/notification.service";
import { rowVisibleInSpace } from "../space-context/space-visibility";

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
  pinnedModules?: Record<string, PinnedModuleSpec>;
}

/** Consumer applies against a catalog product; providerId is resolved server-side. */
export type ContractApplyInput = Omit<
  ContractRequest,
  "consumerId" | "providerId"
>;

export type ContractListItem = DigitalContract & {
  effectiveStatus: ContractStatus;
  canApprove: boolean;
  /** 待审批且尚未知悉时，当前使用方可确认规则（P0-7）。 */
  canAcknowledge: boolean;
  /**
   * 能否授权 MDOP 作业。需要 MDOP 条款、持有方签名、平台副署三者同时在。
   * 列表上的「已生效」只表示医院同意了条款。
   */
  holderSigned: boolean;
};

/** 签发后自动发出的签署要约结果。失败不回滚已生效的合约。 */
export type HolderOfferDispatch = {
  offered: boolean;
  offerId?: string;
  reason?: string;
};

export interface ContractViewer {
  role?: string;
  participantId?: string;
}

const PRIVILEGED_CONTRACT_ROLES = new Set(["compliance", "operator", "admin"]);

function isPrivilegedContractViewer(role?: string): boolean {
  return Boolean(role && PRIVILEGED_CONTRACT_ROLES.has(role));
}

// 数字合约管理(digital-contract spec) + 使用控制策略生成(usage-control 4.1/4.2)。
// 数据提供方批准一次申请 → 生成生效的数字合约(含 SM3 哈希),供下发到连接器。
// 持久化在 control-plane 库。
@Injectable()
export class ContractService implements OnModuleInit {
  private readonly logger = new Logger(ContractService.name);

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
    /**
     * MDOP 合约流程（D-MDOP-4）。末位 @Optional 以兼容既有手工构造
     * `new ContractService(gm, repo, catalog, ...)`；缺失时平台侧撤销不向连接器发
     * `ContractTerminate`（连接器本地撤销仍然独立生效）。
     */
    @Optional() private readonly mdopContracts?: MdopContractService,
    @Optional() private readonly spaces?: SpaceContextService,
    /**
     * 产品级 ACL（D-ACL-1）：预授权自动推进的**前置判据**（提供方是否已授权该使用方访问该产品）。
     * @Optional 兼容既有手工构造。
     */
    @Optional() private readonly dataAccess?: DataAccessService,
    /** 平台审计链：自动推进是平台侧动作，必须留痕（D-MDOP-9）。 */
    @Optional() private readonly audit?: AuditService,
    /**
     * 站内信（D-NOTIF-1）：合约申请要**通知到机构**（医院要有人知道"有人申请了你的数据"），
     * 审批/驳回结果要回到申请方。只有站内信这一条通道（不假装发邮件）。
     */
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  // 幂等演示种子。写入 canonical seed:* 行,并清除旧版中文 ID 的遗留种子。
  async onModuleInit(): Promise<void> {
    const demos: ContractRequest[] = [
      // 疫苗接种后不良反应主动监测（SCRI，C2 演示）：疾控的接种记录 + 医院的就诊结局，各一份合约
      {
        dataProductId: "dp-aefi-immunization-cdc",
        providerId: "p-cdc-demo",
        consumerId: "p-meddata",
        purpose: "疫苗接种后不良反应主动监测演示研究",
        retention: "阅后即焚",
        output: "聚合",
        validDays: 90,
      },
      {
        dataProductId: "dp-aefi-events-demohospb",
        providerId: "p-demohospb",
        consumerId: "p-meddata",
        purpose: "疫苗接种后不良反应主动监测演示研究",
        retention: "阅后即焚",
        output: "聚合",
        validDays: 90,
      },
      {
        dataProductId: "dp-insulin-panc-demohospa",
        providerId: "p-demohospa",
        consumerId: "p-meddata",
        purpose: "胰岛素暴露·胰腺炎信号演示研究",
        retention: "阅后即焚",
        output: "聚合 + 模型参数",
        validDays: 90,
      },
      // 旧版演示世界的三条种子（dp-ckd-imaging ×2、dp-ckd-lab）已于 2026-10-13 删除：
      // 这三个产品在当前 packages/demo-scenario/src/ckd-scenario.json 的 catalogProducts 里**不存在**
      //（现役：dp-renal-us@demohospa、dp-biopsy-wsi@demohospc、dp-neph-text@demohospb、dp-ckd-meds@demohospc），
      // provider 侧也对不上（p-demohospa / p-demohospb 都没有这两个影像/检验产品），因此**永远无法建成合约**。
      // 它们自 1f5f71a「seed demo contracts」引入时就是旧 demo 的产品 id，机构 id 迁移时被漏掉。
      // 若不删：onModuleInit 的 approve 会抛「数据产品不存在」，缺 try/catch 时会让**整个 API 启动失败**
      //（2026-10-13 本机实测，见 docs/test-cases/ 的执行记录）。
      // 示范乙胰岛素/胰腺炎演示队列 → p-meddata。RWS L1–L3 与 FL L4 的示范乙 provider
      // 均依赖此合约（parties: p-demohospb / dp-insulin-panc-demohospb）。此前未种子化，只能手工创建成
      // 一次性 UUID；Fly ephemeral 库每次重部署即被清空，导致 FL admission 报
      // “存在无效的数字合约引用”(403)。种子化后 ID 稳定、重部署幂等复现。
      {
        dataProductId: "dp-insulin-panc-demohospb",
        providerId: "p-demohospb",
        consumerId: "p-meddata",
        purpose: "胰岛素暴露·胰腺炎信号演示研究",
        retention: "阅后即焚",
        output: "聚合 + 模型参数",
        validDays: 90,
      },
      // AMR Sentinel Q1 — 双院药敏分离株（合成 fallback）
      {
        dataProductId: "dp-amr-ast-demohospa",
        providerId: "p-demohospa",
        consumerId: "p-meddata",
        purpose: "抗菌药物耐药监测真实世界研究",
        retention: "阅后即焚",
        output: "仅聚合",
        validDays: 90,
      },
      {
        dataProductId: "dp-amr-ast-demohospb",
        providerId: "p-demohospb",
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
      // **规范种子 id 一律不删**：种子 id 里嵌的就是中文用途（`seed:<产品>:<消费方>:<用途>`），
      // 若让下面「含中文即遗留」的判据先跑，每次启动都会把种子合约删掉重建，
      // 持签状态（mdopTerms/签名）随之静默丢失——这正是 MDOP 要约签署反复失效的根因。
      if (activeDemoIds.has(row.id)) continue;
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
      // mdop-kernel(D-MDOP-4)：**已由持有方签署（有 mdopTerms）的合约不得被重播种覆盖** ——
      // 否则一次 API 重启就会静默抹掉医院的签名，持签合约退回「未签署」。
      const existing = await this.repo.findOne({
        where: { id: this.seedContractId(d) },
      });
      if (existing?.mdopTerms) continue;
      try {
        const preReview = await this.seedPreReview(
          d.consumerId,
          d.dataProductId,
        );
        await this.approve(d, this.seedContractId(d), preReview);
      } catch (e) {
        // **演示种子不得阻止控制面启动**：历史种子合约引用的数据产品可能与 catalog 漂移
        //（见 docs/demo/rws-analytics-ladder-fly-e2e.md 的排障条目）。跳过该条并告警即可——
        // 2026-10-13 实测：dp-ckd-imaging / dp-ckd-lab 在本机 catalog 缺失，曾让整个 API 起不来。
        this.logger.warn(
          "[seed] 演示合约 " +
            this.seedContractId(d) +
            " 跳过（" +
            (e as Error).message +
            "）；数据产品 " +
            d.dataProductId +
            " 缺失或不可用，请核对本空间的 catalog",
        );
      }
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
      // composition.id 是 uuid 列（Postgres 严格校验，SQLite 宽松）；用种子键的 SM3
      // 派生一个稳定的 uuid 形状（幂等：同一种子合约每次同一 id），避免非 uuid 字符串被 PG 拒。
      const h = this.gm.sm3Hash(`seed-comp:${dataProductId}:${consumerId}`);
      const compositionId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
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
  ): Promise<DigitalContract & { mdopOffer: HolderOfferDispatch }> {
    const product = await this.requireConfirmedProduct(req.dataProductId);
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
    await this.repo.save(
      this.repo.create({ ...contract, spaceId: product.homeSpace }),
    );
    const mdopOffer = await this.dispatchHolderOffer(contract.id);
    await this.notifyConsumer(
      contract,
      {
        type: "contract.approved",
        title: "合约已签发",
        body: this.approvalNotice(contract.id, mdopOffer),
      },
      product.homeSpace,
    );
    return { ...contract, mdopOffer };
  }

  /** 药企发起合约申请 → draft，待医院审批（providerId 由目录产品决定） */
  async request(
    req: ContractApplyInput,
    consumerId: string,
  ): Promise<DigitalContract> {
    if (!consumerId) throw new BadRequestException("未绑定参与方身份");
    const product = await this.requireConfirmedProduct(req.dataProductId);

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
    const savedDraft = await this.repo.save(
      this.repo.create({ ...draft, spaceId: product.homeSpace }),
    );
    // 站内信（D-NOTIF-1）：申请是**机构待办**，必须让提供方有人知道（而不是只躺在列表里）
    await this.notifyProvider(savedDraft, {
      type: "contract.request",
      title: "新的数据合约申请",
      body:
        `${consumerId} 申请使用数据产品 ${draft.dataProductId}` +
        `（用途：${draft.purpose}；有效期至 ${draft.validUntil.slice(0, 10)}）。` +
        "在「数字合约」页行内签发即可。",
    });
    return draft;
  }

  /**
   * 给合约提供方发一条站内信（D-NOTIF-1）。
   *
   * 通知是**旁路**：服务自己吞掉失败（`NotificationService.notify` 不抛），
   * 所以这里不需要 try/catch——通知丢了不该让合约申请失败。
   */
  private async notifyProvider(
    contract: DigitalContract,
    message: {
      type: string;
      title: string;
      body?: string;
      details?: Record<string, unknown>;
    },
    spaceId?: string | null,
  ): Promise<void> {
    if (!this.notifications) return;
    await this.notifications.notify({
      recipientParticipantId: contract.providerId,
      spaceId:
        spaceId ?? (contract as { spaceId?: string | null }).spaceId ?? null,
      type: message.type,
      title: message.title,
      ...(message.body ? { body: message.body } : {}),
      resourceType: "contract",
      resourceId: contract.id,
      actorParticipantId: contract.consumerId,
      details: {
        contractId: contract.id,
        dataProductId: contract.dataProductId,
        consumerId: contract.consumerId,
        purpose: contract.purpose,
        ...(message.details ?? {}),
      },
    });
  }

  /** 给合约使用方发一条结果通知（审批/驳回/自动生效）。 */
  private async notifyConsumer(
    contract: DigitalContract,
    message: {
      type: string;
      title: string;
      body?: string;
      details?: Record<string, unknown>;
    },
    spaceId?: string | null,
  ): Promise<void> {
    if (!this.notifications) return;
    await this.notifications.notify({
      recipientParticipantId: contract.consumerId,
      spaceId:
        spaceId ?? (contract as { spaceId?: string | null }).spaceId ?? null,
      type: message.type,
      title: message.title,
      ...(message.body ? { body: message.body } : {}),
      resourceType: "contract",
      resourceId: contract.id,
      actorParticipantId: contract.providerId,
      details: {
        contractId: contract.id,
        dataProductId: contract.dataProductId,
        providerId: contract.providerId,
        ...(message.details ?? {}),
      },
    });
  }

  /** 医院审批 draft 申请 → active（重算有效期 + SM3 哈希） */
  async approveDraft(
    id: string,
    providerParticipantId: string,
    pinnedModulesInput?: Record<string, PinnedModuleSpec>,
    preReviewAckInput?: { reason?: string },
  ): Promise<DigitalContract & { mdopOffer: HolderOfferDispatch }> {
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
    // D-MDOP-4：签发只表示医院同意条款。随后把签署要约发给该院连接器；
    // 要约失败不回滚已生效合约，持有方签名仍只由连接器给出。
    const mdopOffer = await this.dispatchHolderOffer(contract.id);
    await this.notifyConsumer(contract, {
      type: "contract.approved",
      title: "合约已签发",
      body: this.approvalNotice(contract.id, mdopOffer),
      details: {
        waitSeconds: approvalWaitSeconds(
          contract as { createdAt?: Date | string },
        ),
        mdopOffered: mdopOffer.offered,
        ...(mdopOffer.offerId ? { offerId: mdopOffer.offerId } : {}),
        ...(mdopOffer.reason ? { offerError: mdopOffer.reason } : {}),
      },
    });
    return { ...contract, mdopOffer };
  }

  /**
   * 签发成功后发出 MDOP 签署要约（不含 C2 证明策略）。
   * 连接器未注册证书、或发送失败时只记录原因，不把已生效的合约打回去。
   */
  private async dispatchHolderOffer(
    contractId: string,
  ): Promise<HolderOfferDispatch> {
    if (!this.mdopContracts) {
      return { offered: false, reason: "MDOP 合约服务不可用，未发出签署要约" };
    }
    try {
      const offer = await this.mdopContracts.offer(contractId, {});
      return { offered: true, offerId: offer.offerId };
    } catch (error) {
      const reason = (error as Error).message;
      this.logger.warn(`签署要约未发出 contract=${contractId}：${reason}`);
      return { offered: false, reason };
    }
  }

  private approvalNotice(
    contractId: string,
    offer: HolderOfferDispatch,
  ): string {
    if (offer.offered) {
      return (
        `数据提供方已签发合约 ${contractId}，签署要约已发给医院连接器。` +
        "连接器完成持有方签名、平台副署之后，才能提交作业。"
      );
    }
    return (
      `数据提供方已签发合约 ${contractId}，但签署要约未能发出` +
      `（${offer.reason ?? "未知原因"}）。持有方签名完成前不能提交作业。`
    );
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

  /**
   * **预授权自动推进**（Phase 3 / D-MDOP-9）：平台把申请推进到"已发出要约"，
   * 剩下的签名仍由提供方连接器按**院内本地策略**决定（D-MDOP-4 不变——平台不代签）。
   *
   * 前置条件（任一不满足即拒，fail-closed）：
   * 1. 合约处于 `draft`，且调用者就是该申请的**使用方**（只有申请方能推进自己的申请）；
   * 2. 提供方已通过产品级 ACL 授权该使用方 `compute` 该数据产品（这是"预授权"的载体）；
   * 3. 预审裁决**不是** `manual_review`——那是医院必须逐条显式确认的场合（D-CMP-2），
   *    自动推进 MUST NOT 绕过它；
   * 4. 消费方规则知悉（P0-7）缺失时，由本次调用代记（调用者就是消费方，
   *    且他在审批卡上确认过条款——卡片展示的就是这份条款）。
   *
   * 成功后的状态：`status=active`（条款定稿 + SM3 哈希）+ `mdopStatus=offered` + 要约入发件箱；
   * 同时记 `autoOfferGrantId` / `autoOfferedAt` 与一条审计（`UPDATE / contract`）。
   */
  async autoOffer(
    id: string,
    consumerId: string,
    actor: { userId?: number | string | null; tenantId?: number | null } = {},
  ): Promise<{
    contract: DigitalContract;
    grantId: string;
    offered: boolean;
    offerId?: string;
  }> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException("数字合约不存在");
    if (existing.status !== "draft") {
      throw new BadRequestException("仅待审批申请可自动推进");
    }
    if (!participantMatches(consumerId, existing.consumerId)) {
      throw new ForbiddenException("仅该申请的数据使用方可触发自动推进");
    }
    if (existing.preReview?.verdict === "manual_review") {
      throw new BadRequestException(
        "预审裁决为「需审批」：必须由数据提供方显式确认（D-CMP-2），不能自动推进",
      );
    }
    if (!this.dataAccess) {
      throw new BadRequestException("产品级授权服务不可用，无法判定预授权");
    }
    const access = await this.dataAccess.check({
      dataProductId: existing.dataProductId,
      participantId: existing.consumerId,
      permission: "compute",
      ...(existing.purpose ? { purpose: existing.purpose } : {}),
    });
    if (!access.allowed) {
      throw new BadRequestException(
        `提供方尚未预授权该使用方访问该数据产品（${access.reason}），自动推进不适用`,
      );
    }
    const grantId =
      access.grantId ??
      (access.reason === "provider-self" ? "provider-self" : "");
    if (!grantId) {
      throw new BadRequestException("预授权判定缺少授权 id，拒绝自动推进");
    }

    // 消费方规则知悉：缺则由本次调用代记（同一 canonical + consumerId 的哈希口径）
    let draft = existing;
    if (!draft.consumerAcknowledgedAt) {
      draft = await this.acknowledge(id, consumerId);
    }

    // 条款定稿（与 approveDraft 同一套：outputPolicy / validUntil / SM3 哈希）
    const outputPolicy = resolveOutputPolicy(draft);
    const validUntil =
      new Date(draft.validUntil).getTime() > Date.now()
        ? draft.validUntil
        : new Date(Date.now() + 86_400_000).toISOString();
    const base: Omit<DigitalContract, "hash"> = {
      ...draft,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      validUntil,
      status: "active",
      autoOfferGrantId: grantId,
      autoOfferedAt: new Date().toISOString(),
    };
    const contract: DigitalContract = {
      ...base,
      hash: "SM3:" + this.gm.sm3Hash(this.canonical(base)),
    };
    await this.repo.save(contract);

    // 发出要约（提供方连接器据本地策略决定自动签或转人工）
    let offerId: string | undefined;
    if (this.mdopContracts) {
      const offer = await this.mdopContracts.offer(id, {});
      offerId = offer.offerId;
    }

    // 审计要求 (userId, tenantId) 归属——来自调用者 JWT（controller 传入）。
    // 拿不到归属就不写"无主"记录（与 data-access / audit 端点同一口径）。
    if (this.audit && actor.tenantId) {
      try {
        await this.audit.create(Number(actor.userId ?? 0), actor.tenantId, {
          action: AuditAction.UPDATE,
          resource: "contract",
          details: {
            op: "auto-offer",
            contractId: id,
            dataProductId: contract.dataProductId,
            consumerId: contract.consumerId,
            providerId: contract.providerId,
            grantId,
            offerId: offerId ?? null,
            mdopStatus: offerId ? "offered" : "unsigned",
          },
        });
      } catch (error) {
        this.logger.warn(
          `自动推进审计写入失败：${(error as Error).message}（动作已完成）`,
        );
      }
    }
    await this.notifyProvider(contract, {
      type: "contract.auto-offered",
      title: "有申请已按预授权自动推进",
      body:
        `${contract.consumerId} 的申请已按你方的产品级预授权自动发出要约；` +
        "是否自动签署由你方连接器的本地策略决定（未命中则需人工确认）。",
      details: {
        grantId,
        offerId: offerId ?? null,
        autoOfferedAt: contract.autoOfferedAt,
      },
    });
    return {
      contract,
      grantId,
      offered: Boolean(offerId),
      ...(offerId ? { offerId } : {}),
    };
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
    await this.notifyConsumer(existing, {
      type: "contract.rejected",
      title: "合约申请被驳回",
      body: `数据提供方驳回了合约申请 ${id}。可以联系对方了解原因，或调整条款后重新申请。`,
    });
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
    // D-MDOP-4：平台撤销要让该院连接器同步终止本地副本，并让在途 MDOP 作业 ABORTED。
    await this.mdopContracts?.terminate(id, reason ?? "平台撤销");
  }

  async get(id: string): Promise<DigitalContract | undefined> {
    const row = (await this.repo.findOne({ where: { id } })) ?? undefined;
    if (!row || !this.visibleInCurrentSpace(row)) return undefined;
    return row;
  }

  // Lists contracts with effective status + whether the current viewer may approve.
  async list(viewer: ContractViewer = {}): Promise<ContractListItem[]> {
    const all = (await this.repo.find()).filter(
      (c) =>
        this.visibleInCurrentSpace(c) &&
        (isPrivilegedContractViewer(viewer.role) ||
          !viewer.participantId ||
          participantMatches(viewer.participantId, c.providerId) ||
          participantMatches(viewer.participantId, c.consumerId)),
    );
    return all.map((c) => {
      const effectiveStatus = this.effectiveStatus(c);
      const canApprove =
        viewer.role === "provider" &&
        effectiveStatus === "draft" &&
        participantMatches(viewer.participantId, c.providerId);
      const canAcknowledge =
        viewer.role === "consumer" &&
        effectiveStatus === "draft" &&
        !c.consumerAcknowledgedAt &&
        participantMatches(viewer.participantId, c.consumerId);
      const outputPolicy = resolveOutputPolicy(c);
      return {
        ...c,
        output: outputLabelFromPreset(outputPolicy.preset),
        outputPolicy,
        effectiveStatus,
        canApprove,
        canAcknowledge,
        holderSigned: isHolderSigned(c),
      };
    });
  }

  /**
   * 未确权、或不属于当前空间的产品不能签合约。
   * 无请求空间时仍按产品自身的 homeSpace 落库，不把别的空间的产品签进当前空间。
   */
  private async requireConfirmedProduct(dataProductId: string) {
    const product = await this.catalog.get(dataProductId);
    if (!product) throw new BadRequestException("数据产品不存在");
    if (!product.rightsConfirmed) {
      throw new BadRequestException("数据产品未确权,不可发起合约");
    }
    if (product.status === "draft" || product.status === "archived") {
      throw new BadRequestException("数据产品未上架,不可发起合约");
    }
    const current = this.spaces?.current()?.spaceId;
    if (current && product.homeSpace !== current) {
      throw new ForbiddenException("数据产品不属于当前空间");
    }
    return product;
  }

  /** 无空间上下文时不过滤（单测与启动种子）。空 spaceId 的旧行只属于默认空间。 */
  private visibleInCurrentSpace(row: { spaceId?: string | null }): boolean {
    return rowVisibleInSpace(row, this.spaces?.current()?.spaceId);
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
   * 校验「固定算法模块」条款。
   *
   * 两道判据:
   *  1. 条款本身完整 —— 新口径必须带**准入层级 + 平台审查背书**
   *     (third-party-module-admission:不得固定一个来路不明的模块);
   *  2. SM3 在平台模块注册表内登记,且分析类型一致(CTL-20 双重校验第一半)。
   */
  private validatePinnedModules(
    input?: Record<string, PinnedModuleSpec>,
  ): Record<string, PinnedModuleSpec> | undefined {
    if (input === undefined || input === null) return undefined;
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException(
        "pinnedModules 须为 分析类型 → 模块 SM3(或 {sm3,tier,review} 条款)的对象",
      );
    }
    const normalized = normalizePinnedModules(input)!;
    for (const [analysisType, spec] of Object.entries(normalized)) {
      const clauseErr = validatePinnedModuleClause(analysisType, spec);
      if (clauseErr) throw new BadRequestException(clauseErr);
      const sm3 = pinnedModuleSm3(spec);
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

/**
 * 归一化固定模块条款:键排序 + SM3 小写 → 合约哈希稳定可复现。
 *
 * third-party-module-admission:条款有两种形态 —— 旧的纯 SM3 字符串(平台自研
 * Tier A)与新的 {sm3, tier, review}(第三方 Tier B 必须带层级 + 平台审查背书)。
 * 两种形态都**整体**计入合约哈希:改层级或改背书同样改哈希,事后不可篡改。
 * 背书内部字段也按键排序,保证同一份条款在任何机器上算出同一个哈希。
 */
export function normalizePinnedModules(
  input?: Record<string, PinnedModuleSpec> | null,
): Record<string, PinnedModuleSpec> | null {
  if (!input) return null;
  const out: Record<string, PinnedModuleSpec> = {};
  for (const key of Object.keys(input).sort()) {
    const spec = input[key];
    out[key] = isPinnedModuleClause(spec)
      ? {
          sm3: spec.sm3.toLowerCase(),
          tier: spec.tier,
          review: sortKeys(
            spec.review as unknown as Record<string, unknown>,
          ) as unknown as PinnedModuleClause["review"],
        }
      : String(spec).toLowerCase();
  }
  return Object.keys(out).length ? out : null;
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out as T;
}

/**
 * 审批时延（秒）：申请创建 → 现在。
 *
 * Phase 4 的成功指标是"审批响应时间 < 24 小时"——口径必须有唯一出处，
 * 所以放在这里算一次，写进通知与审计的 details（由消费方聚合，不另建统计表）。
 * 拿不到 createdAt 就返回 null（未知，不编 0）。
 */
export function approvalWaitSeconds(
  contract: { createdAt?: Date | string | null },
  now: Date = new Date(),
): number | null {
  const created = contract.createdAt;
  if (!created) return null;
  const time = new Date(created).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((now.getTime() - time) / 1000));
}
