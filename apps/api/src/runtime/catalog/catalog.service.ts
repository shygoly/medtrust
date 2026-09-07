import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  DataProduct as DataProductEntity,
  ProductType,
} from "@medtrust/database";
import { CATALOG_PRODUCTS, SPACE_ID } from "@medtrust/demo-scenario";

// A data product = catalog metadata only. The raw data stays on the provider's
// connector; the catalog never holds rows (data-product spec). This is the
// DTO/transport shape; the persisted form is the DataProduct entity.
export interface ClassificationTag {
  level: string; // 1|2|3|4 (NDI-TR-2025-06 级别)
  categoryCode: string; // 类别编码,如 MEDICAL / SENSITIVE / IMPORTANT / GENERAL
  version?: string; // 标签版本,默认 NDI-TR-2025-06
}

export interface DataProduct {
  id: string;
  urn: string; // global identifier urn:tds:<spaceId>:<productId> (9.1)
  homeSpace: string; // the space this product belongs to
  providerId: string;
  title: string;
  productType?: ProductType; // data=数据产品 / service=数据服务(P0-2)
  classification?: string; // 分级分类(展示用)
  classificationTag?: ClassificationTag | null; // NDI-TR-2025-06 结构化标签(P1-8)
  status?: "active" | "archived"; // P1-1 目录生命周期
  rightsConfirmed: boolean; // 确权
  recordCount: number;
  fhirSchema?: Record<string, unknown> | null;
}

export { SPACE_ID };

export interface PublishInput {
  providerId: string;
  title: string;
  productType?: ProductType;
  classification?: string;
  classificationTag?: ClassificationTag;
  rightsConfirmed: boolean;
  recordCount?: number;
  fhirSchema?: Record<string, unknown> | null;
}

export interface UpdateInput {
  title?: string;
  productType?: ProductType;
  classification?: string;
  classificationTag?: ClassificationTag;
  rightsConfirmed?: boolean;
  recordCount?: number;
  fhirSchema?: Record<string, unknown> | null;
}

const LEGACY_CLASSIFICATION: Record<string, ClassificationTag> = {
  一般: { level: "1", categoryCode: "GENERAL", version: "NDI-TR-2025-06" },
  重要: { level: "2", categoryCode: "IMPORTANT", version: "NDI-TR-2025-06" },
  敏感: { level: "3", categoryCode: "SENSITIVE", version: "NDI-TR-2025-06" },
};

// 目录管理(对齐《技术架构》"目录管理" + data-product spec)。替代旧 data-asset
// 的元数据职责;只登记数据产品元数据,绝不汇聚原始数据。持久化在 control-plane 库。
@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    @InjectRepository(DataProductEntity, "controlplane")
    private readonly repo: Repository<DataProductEntity>,
  ) {}

  // 幂等演示种子(以 urn 为自然键)。缺失则插入;已有则同步种子元数据(便于 ID 统一后刷新)。
  async onModuleInit(): Promise<void> {
    for (const p of CATALOG_PRODUCTS) {
      const urn = `urn:tds:${SPACE_ID}:${p.id}`;
      const existing = await this.repo.findOne({ where: { urn } });
      const tag = this.normalizeClassification(p.classification);
      if (existing) {
        existing.providerId = p.providerId;
        existing.title = p.title;
        existing.productType = existing.productType ?? "data";
        existing.classification = p.classification;
        existing.classificationTag = existing.classificationTag ?? tag;
        existing.status = existing.status ?? "active";
        existing.rightsConfirmed = p.rightsConfirmed;
        existing.recordCount = p.recordCount;
        existing.fhirSchema = p.fhirSchema ?? null;
        existing.updatedAt = new Date();
        await this.repo.save(existing);
        continue;
      }
      await this.repo.save(
        this.repo.create({
          id: p.id,
          urn,
          homeSpace: SPACE_ID,
          providerId: p.providerId,
          title: p.title,
          productType: "data",
          classification: p.classification,
          classificationTag: tag,
          status: "active",
          rightsConfirmed: p.rightsConfirmed,
          recordCount: p.recordCount,
          fhirSchema: p.fhirSchema ?? null,
        }),
      );
    }

    // Drop renamed demo products so catalog UI does not keep stale CKD/DKD IDs.
    for (const legacyId of ["dp-ckd-ehr", "dp-dkd-cohort"] as const) {
      await this.repo.delete({ id: legacyId });
    }
  }

  async publish(input: PublishInput): Promise<DataProduct> {
    // 未确权 / 未分类不可发布
    if (!input.rightsConfirmed)
      throw new BadRequestException("数据产品未确权,不可发布");
    const tag = this.normalizeClassification(
      input.classification,
      input.classificationTag,
    );
    const id = randomUUID();
    return this.repo.save(
      this.repo.create({
        id,
        urn: `urn:tds:${SPACE_ID}:${id}`,
        homeSpace: SPACE_ID,
        providerId: input.providerId,
        title: input.title,
        productType: input.productType ?? "data",
        classification: input.classification,
        classificationTag: tag,
        status: "active",
        rightsConfirmed: input.rightsConfirmed,
        recordCount: input.recordCount ?? 0,
        fhirSchema: input.fhirSchema ?? null,
      }),
    );
  }

  // P1-1 目录生命周期:更新(provider 侧字段级更新)与下架(archived 软删)。
  async update(id: string, input: UpdateInput): Promise<DataProduct> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new BadRequestException("数据产品不存在");

    if (input.title !== undefined) existing.title = input.title;
    if (input.productType !== undefined)
      existing.productType = input.productType;
    if (input.rightsConfirmed !== undefined)
      existing.rightsConfirmed = input.rightsConfirmed;
    if (input.recordCount !== undefined)
      existing.recordCount = input.recordCount;
    if (input.fhirSchema !== undefined)
      existing.fhirSchema = input.fhirSchema ?? null;
    if (input.classification !== undefined || input.classificationTag) {
      const tag = this.normalizeClassification(
        input.classification ?? existing.classification,
        input.classificationTag ?? existing.classificationTag ?? undefined,
      );
      existing.classification = input.classification ?? existing.classification;
      existing.classificationTag = tag;
    }
    existing.updatedAt = new Date();
    return this.repo.save(existing);
  }

  async archive(id: string): Promise<DataProduct> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new BadRequestException("数据产品不存在");
    existing.status = "archived";
    existing.updatedAt = new Date();
    return this.repo.save(existing);
  }

  list(
    productType?: ProductType,
    includeArchived = false,
  ): Promise<DataProduct[]> {
    const where = includeArchived
      ? productType
        ? { productType }
        : {}
      : productType
        ? { productType, status: "active" as const }
        : { status: "active" as const };
    return this.repo.find({ where });
  }

  get(id: string): Promise<DataProduct | null> {
    return this.repo.findOne({ where: { id } });
  }

  // P1-8:发布校验合法枚举;兼容既有自由文本(一般/重要/敏感)并向 NDI-TR-2025-06 迁移。
  private normalizeClassification(
    classification?: string,
    tag?: ClassificationTag,
  ): ClassificationTag {
    if (tag) {
      const level = String(tag.level);
      if (!["1", "2", "3", "4"].includes(level)) {
        throw new BadRequestException(
          "分类分级标签 level 须为 1|2|3|4 (NDI-TR-2025-06)",
        );
      }
      if (!tag.categoryCode?.trim()) {
        throw new BadRequestException("分类分级标签 categoryCode 不可为空");
      }
      return {
        level,
        categoryCode: tag.categoryCode.trim(),
        version: tag.version || "NDI-TR-2025-06",
      };
    }
    if (!classification) {
      throw new BadRequestException("数据产品未分级分类,不可发布");
    }
    const legacy = LEGACY_CLASSIFICATION[classification];
    if (legacy) return legacy;
    // 兼容既有中文标签(如 二级 · 重要数据 / 三级 · 敏感影像)→ 结构化标签。
    const chinese = this.parseChineseClassification(classification);
    if (chinese) return chinese;
    throw new BadRequestException(
      "分类分级标签需符合 NDI-TR-2025-06 结构化格式(级别+类别编码+标签版本)",
    );
  }

  private parseChineseClassification(
    classification: string,
  ): ClassificationTag | null {
    const text = classification.trim();
    const levelMap: Array<[RegExp, string]> = [
      [/一级|1级|1/, "1"],
      [/二级|2级|2/, "2"],
      [/三级|3级|3/, "3"],
      [/四级|4级|4/, "4"],
    ];
    let level = "";
    for (const [re, lv] of levelMap) {
      if (re.test(text)) {
        level = lv;
        break;
      }
    }
    if (!level) return null;
    let categoryCode = "GENERAL";
    if (/影像/.test(text)) categoryCode = "IMAGING";
    else if (/敏感/.test(text)) categoryCode = "SENSITIVE";
    else if (/重要/.test(text)) categoryCode = "IMPORTANT";
    return { level, categoryCode, version: "NDI-TR-2025-06" };
  }
}
