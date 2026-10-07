import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  KriDefinitionEntity,
  KriObservationEntity,
  QtlBreachEntity,
  QtlThreshold,
  QtlLevel,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { SEED_KRI_DEFINITIONS, SEED_KRI_OBSERVATIONS } from "./kri-catalog";

const SEVERITY_RANK: Record<QtlLevel, number> = { warning: 1, critical: 2 };

/** 站点级聚合观测的入库载荷（连接器仅回传聚合三元组 + 元数据，无行级数据）。 */
export interface IngestObservation {
  id?: string;
  kriCode: string;
  siteId: string;
  siteName?: string;
  studyId?: string;
  periodStart?: string;
  periodEnd?: string;
  numerator: number;
  denominator: number;
  value?: number;
  cohortSize?: number;
  suppressed?: boolean;
  submittedAt?: string;
}

/**
 * RBQM 中心化监查（rbqm-central-monitoring）。质量信号层，复用既有闸门/存证/审计
 * 底座：只接收站点级聚合观测（永不含个体），入库即按 KRI 分层阈值检测越限，越限
 * 证据摘要经 AttestationService 上链（不可达降级本地回执，与合约存证同）。
 * 三张表全部持久化在 control-plane 库。
 */
@Injectable()
export class RbqmService implements OnModuleInit {
  private readonly logger = new Logger(RbqmService.name);

  constructor(
    @InjectRepository(KriDefinitionEntity, "controlplane")
    private readonly defs: Repository<KriDefinitionEntity>,
    @InjectRepository(KriObservationEntity, "controlplane")
    private readonly obs: Repository<KriObservationEntity>,
    @InjectRepository(QtlBreachEntity, "controlplane")
    private readonly breaches: Repository<QtlBreachEntity>,
    private readonly gm: GMCryptoService,
    private readonly attestation: AttestationService,
  ) {}

  // 幂等种子：KRI 定义（按 id）+ 观测（按 id，经 ingest 触发越限检测与存证）。
  async onModuleInit(): Promise<void> {
    for (const d of SEED_KRI_DEFINITIONS) {
      if (await this.defs.findOne({ where: { id: d.id } })) continue;
      await this.defs.save(this.defs.create(d));
    }
    for (const o of SEED_KRI_OBSERVATIONS) {
      if (o.id && (await this.obs.findOne({ where: { id: o.id } }))) continue;
      await this.ingest(o);
    }
  }

  /**
   * 接收一条站点级聚合观测：入库 → 按 KRI 阈值检测越限 → 越限则记录 + 上链。
   * 返回 { observation, breach? }。
   */
  async ingest(
    input: IngestObservation,
  ): Promise<{ observation: KriObservationEntity; breach?: QtlBreachEntity }> {
    const denominator = input.suppressed ? 0 : input.denominator;
    const numerator = input.suppressed ? 0 : input.numerator;
    const value =
      input.value ?? (denominator > 0 ? numerator / denominator : 0);
    const sourceDigest =
      "SM3:" +
      this.gm.sm3Hash(
        JSON.stringify({
          kriCode: input.kriCode,
          siteId: input.siteId,
          studyId: input.studyId ?? "",
          numerator,
          denominator,
        }),
      );

    const observation = await this.obs.save(
      this.obs.create({
        id: input.id,
        kriCode: input.kriCode,
        siteId: input.siteId,
        siteName: input.siteName ?? input.siteId,
        studyId: input.studyId ?? "",
        periodStart: input.periodStart ?? "",
        periodEnd: input.periodEnd ?? "",
        numerator,
        denominator,
        value: input.suppressed ? 0 : value,
        cohortSize: input.cohortSize ?? input.denominator,
        suppressed: !!input.suppressed,
        sourceDigest,
        submittedAt: input.submittedAt ?? new Date().toISOString(),
      }),
    );

    // 被抑制的观测不参与越限判定（无精确值可比）。
    if (observation.suppressed) return { observation };

    const def = await this.defs.findOne({
      where: { code: input.kriCode },
    });
    if (!def) return { observation };

    const hit = evaluateBreach(
      def.direction,
      def.thresholds,
      observation.value,
    );
    if (!hit) return { observation };

    const detectedAt = new Date().toISOString();
    const evidenceHash =
      "SM3:" +
      this.gm.sm3Hash(
        JSON.stringify({
          kriCode: observation.kriCode,
          siteId: observation.siteId,
          studyId: observation.studyId,
          observedValue: observation.value,
          thresholdLevel: hit.level,
          thresholdValue: hit.value,
          detectedAt,
        }),
      );
    let attestationTxHash = "";
    let attestationBlock = 0;
    try {
      const receipt = await this.attestation.anchor(evidenceHash, undefined, {
        kind: "evidence",
        subjectType: "qtl-breach",
      });
      attestationTxHash = receipt.txHash;
      attestationBlock = receipt.block;
    } catch (err) {
      this.logger.warn(
        `QTL 越限存证失败(不阻断记录): ${(err as Error).message}`,
      );
    }

    const breach = await this.breaches.save(
      this.breaches.create({
        kriCode: observation.kriCode,
        siteId: observation.siteId,
        studyId: observation.studyId,
        observedValue: observation.value,
        thresholdLevel: hit.level,
        thresholdValue: hit.value,
        severity: hit.level,
        status: "open",
        detectedAt,
        attestationTxHash,
        attestationBlock,
      }),
    );
    this.logger.log(
      `QTL 越限 kri=${observation.kriCode} site=${observation.siteId} ` +
        `value=${observation.value.toFixed(3)} level=${hit.level} tx=${attestationTxHash}`,
    );
    return { observation, breach };
  }

  listDefinitions(): Promise<KriDefinitionEntity[]> {
    return this.defs.find({ order: { riskTier: "ASC", code: "ASC" } });
  }

  listObservations(studyId?: string): Promise<KriObservationEntity[]> {
    return this.obs.find({
      where: studyId ? { studyId } : {},
      order: { siteId: "ASC", kriCode: "ASC" },
    });
  }

  listBreaches(status?: string): Promise<QtlBreachEntity[]> {
    return this.breaches.find({
      where: status ? { status: status as QtlBreachEntity["status"] } : {},
      order: { detectedAt: "DESC" },
    });
  }

  async acknowledgeBreach(id: string): Promise<QtlBreachEntity | null> {
    const b = await this.breaches.findOne({ where: { id } });
    if (!b) return null;
    b.status = "acknowledged";
    return this.breaches.save(b);
  }
}

/**
 * 越限判定：给定 KRI 方向与分层阈值，返回命中的最严重层级，未越限返回 null。
 * higher_worse 用 gte，lower_worse 用 lte；同时命中多层取最严重（critical > warning）。
 * 纯函数，便于单测。
 */
export function evaluateBreach(
  direction: "higher_worse" | "lower_worse",
  thresholds: QtlThreshold[] | null,
  value: number,
): { level: QtlLevel; value: number } | null {
  if (!thresholds || thresholds.length === 0) return null;
  let best: { level: QtlLevel; value: number } | null = null;
  for (const t of thresholds) {
    const op: "gte" | "lte" =
      t.op ?? (direction === "higher_worse" ? "gte" : "lte");
    const matched = op === "gte" ? value >= t.value : value <= t.value;
    if (!matched) continue;
    if (!best || SEVERITY_RANK[t.level] > SEVERITY_RANK[best.level]) {
      best = { level: t.level, value: t.value };
    }
  }
  return best;
}
