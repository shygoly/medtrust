import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  DigitalContract,
  ContractStatus,
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

export interface ContractRequest {
  dataProductId: string;
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
      await this.approve(d, this.seedContractId(d));
    }
  }

  private seedContractId(d: ContractRequest): string {
    const purposeKey = d.purpose.replace(/\s+/g, "-").slice(0, 32);
    return `seed:${d.dataProductId}:${d.consumerId}:${purposeKey}`;
  }

  async approve(
    req: ContractRequest,
    id: string = randomUUID(),
  ): Promise<DigitalContract> {
    const validUntil = new Date(
      Date.now() + req.validDays * 86_400_000,
    ).toISOString();
    const outputPolicy = this.materializePolicy(req);
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
    };
    await this.repo.save(this.repo.create(draft));
    return draft;
  }

  /** 医院审批 draft 申请 → active（重算有效期 + SM3 哈希） */
  async approveDraft(
    id: string,
    providerParticipantId: string,
  ): Promise<DigitalContract> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException("数字合约不存在");
    if (existing.status !== "draft")
      throw new BadRequestException("仅待审批申请可签发");
    if (!participantMatches(providerParticipantId, existing.providerId)) {
      throw new ForbiddenException("仅数据提供方可审批本机构合约申请");
    }

    const remainingDays = Math.max(
      1,
      Math.ceil(
        (new Date(existing.validUntil).getTime() - Date.now()) / 86_400_000,
      ),
    );
    const validUntil = new Date(
      Date.now() + remainingDays * 86_400_000,
    ).toISOString();
    const outputPolicy = resolveOutputPolicy(existing);
    const base: Omit<DigitalContract, "hash"> = {
      ...existing,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      validUntil,
      status: "active",
    };
    const contract: DigitalContract = {
      ...base,
      hash: "SM3:" + this.gm.sm3Hash(this.canonical(base)),
    };
    await this.repo.save(contract);
    return contract;
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

  async revoke(id: string): Promise<void> {
    await this.repo.update({ id }, { status: "revoked" });
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
    });
  }
}
