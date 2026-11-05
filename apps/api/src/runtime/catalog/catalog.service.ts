import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  CoverageReportError,
  DATA_SOURCE_LABEL_PATTERN,
  DataProduct as DataProductEntity,
  DataProductCoverage,
  DataSourceDeclaration,
  DataSourceDeclarationError,
  mergeCoverage,
  parseDataSourceDeclaration,
  ProductType,
  validateCoverageReport,
} from "@medtrust/database";
import {
  type ListingConsent,
  type ListingScope,
  type ProductProvenance,
  type ServiceSpec,
} from "@medtrust/database";
import { CATALOG_PRODUCTS, SPACE_ID } from "@medtrust/demo-scenario";
import { SpaceContextService } from "../space-context/space-context.service";

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
  status?: "active" | "archived" | "draft"; // P1-1 目录生命周期；draft 未上架
  rightsConfirmed: boolean; // 确权
  recordCount: number;
  fhirSchema?: Record<string, unknown> | null;
  productRoles?: string[];
  /** CDM 数据产品的覆盖元数据:连接器从库内统计上报(omop-data-source-access)。 */
  coverage?: DataProductCoverage | null;
  /** 对外上报范围（ndi-catalog-upstream-listing）；缺省 internal。 */
  listingScope?: ListingScope;
  listingConsent?: ListingConsent | null;
  serviceSpec?: ServiceSpec | null;
  serviceCapacity?: number | null;
  provenance?: ProductProvenance | null;
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
  productRoles?: string[];
  /** ndi-catalog-upstream-listing：默认 internal，不自动外发。 */
  listingScope?: ListingScope;
  listingConsent?: ListingConsent | null;
  serviceSpec?: ServiceSpec | null;
  serviceCapacity?: number | null;
  provenance?: ProductProvenance | null;
}

export interface UpdateInput {
  title?: string;
  productType?: ProductType;
  classification?: string;
  classificationTag?: ClassificationTag;
  rightsConfirmed?: boolean;
  recordCount?: number;
  fhirSchema?: Record<string, unknown> | null;
  productRoles?: string[];
  listingScope?: ListingScope;
  listingConsent?: ListingConsent | null;
  serviceSpec?: ServiceSpec | null;
  serviceCapacity?: number | null;
  provenance?: ProductProvenance | null;
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
    @Optional() private readonly spaces?: SpaceContextService,
  ) {}

  /** 发布落入当前请求的空间；无请求上下文时仍归默认空间（单空间零变更）。 */
  private homeSpaceForWrite(): string {
    return this.spaces?.current()?.spaceId || SPACE_ID;
  }

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
        existing.productRoles = existing.productRoles ?? p.productRoles ?? null;
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
          productRoles: p.productRoles ?? null,
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
    // 数据源声明发布时就校验:类型唯一、CDM 只带 label(凭据只在连接器侧,D-CN-6)。
    this.declarationOf(input.fhirSchema);
    const tag = this.normalizeClassification(
      input.classification,
      input.classificationTag,
    );
    this.validateListing(input, { isNew: true });
    if ((input.productType ?? "data") === "service" && (input.recordCount ?? 0) > 0)
      throw new BadRequestException(
        "数据服务不得用 recordCount 表达规模，请用 serviceCapacity",
      );
    const id = randomUUID();
    return this.repo.save(
      this.repo.create({
        id,
        urn: `urn:tds:${this.homeSpaceForWrite()}:${id}`,
        homeSpace: this.homeSpaceForWrite(),
        providerId: input.providerId,
        title: input.title,
        productType: input.productType ?? "data",
        classification: input.classification,
        classificationTag: tag,
        status: "active",
        rightsConfirmed: input.rightsConfirmed,
        recordCount: input.recordCount ?? 0,
        fhirSchema: input.fhirSchema ?? null,
        productRoles: input.productRoles ?? null,
        listingScope: input.listingScope ?? "internal",
        listingConsent: input.listingConsent ?? null,
        serviceSpec: input.serviceSpec ?? null,
        serviceCapacity: input.serviceCapacity ?? null,
        provenance: input.provenance ?? null,
      }),
    );
  }

  // P1-1 目录生命周期:更新(provider 侧字段级更新)与下架(archived 软删)。
  async update(id: string, input: UpdateInput): Promise<DataProduct> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new BadRequestException("数据产品不存在");

    // ndi-catalog-upstream-listing：新增校验对**存量**产品保持宽容——
    // 只有在本次更新涉及服务规格或转 regional 时才强制补全（grandfather）。
    this.validateListing(input, {
      isNew: false,
      existing: {
        productType: existing.productType,
        listingScope: existing.listingScope,
        serviceSpec: existing.serviceSpec ?? null,
      },
    });
    if (
      (input.productType ?? existing.productType) === "service" &&
      input.recordCount !== undefined &&
      input.recordCount > 0
    )
      throw new BadRequestException(
        "数据服务不得用 recordCount 表达规模，请用 serviceCapacity",
      );

    if (input.title !== undefined) existing.title = input.title;
    if (input.productType !== undefined)
      existing.productType = input.productType;
    if (input.rightsConfirmed !== undefined) {
      existing.rightsConfirmed = input.rightsConfirmed;
      if (input.rightsConfirmed && existing.status === "draft") {
        existing.status = "active";
      }
      if (!input.rightsConfirmed && existing.status === "active") {
        existing.status = "draft";
      }
    }
    if (input.recordCount !== undefined)
      existing.recordCount = input.recordCount;
    if (input.productRoles !== undefined) {
      existing.productRoles = [
        ...new Set(
          input.productRoles.map((role) => role.trim()).filter(Boolean),
        ),
      ];
    }
    if (input.fhirSchema !== undefined) {
      const declaration = this.declarationOf(input.fhirSchema);
      existing.fhirSchema = input.fhirSchema ?? null;
      // 改了数据源(换 label / 不再是 CDM),旧数据源的覆盖元数据不能挂在新声明上。
      if (
        existing.coverage &&
        !(
          declaration?.type === "omop-cdm" &&
          declaration.label === existing.coverage.label
        )
      ) {
        existing.coverage = null;
      }
    }
    if (input.classification !== undefined || input.classificationTag) {
      const tag = this.normalizeClassification(
        input.classification ?? existing.classification,
        input.classificationTag ?? existing.classificationTag ?? undefined,
      );
      existing.classification = input.classification ?? existing.classification;
      existing.classificationTag = tag;
    }
    if (input.listingScope !== undefined) existing.listingScope = input.listingScope;
    if (input.listingConsent !== undefined)
      existing.listingConsent = input.listingConsent;
    if (input.serviceSpec !== undefined) existing.serviceSpec = input.serviceSpec;
    if (input.serviceCapacity !== undefined)
      existing.serviceCapacity = input.serviceCapacity;
    if (input.provenance !== undefined) existing.provenance = input.provenance;
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
    const spaceId = this.spaces?.current()?.spaceId;
    const where = includeArchived
      ? productType
        ? { productType }
        : {}
      : productType
        ? { productType, status: "active" as const, rightsConfirmed: true }
        : { status: "active" as const, rightsConfirmed: true };
    if (spaceId) (where as { homeSpace?: string }).homeSpace = spaceId;
    return this.repo.find({ where });
  }

  async get(id: string): Promise<DataProduct | null> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return null;
    const spaceId = this.spaces?.current()?.spaceId;
    if (spaceId && row.homeSpace !== spaceId) return null;
    return row;
  }

  /**
   * omop-data-source-access 5.3 / 5.4:连接器按 label 上报 CDM 覆盖元数据,
   * 挂到**该机构**声明引用这个 label 的在架数据产品上。报文先过共享校验器(只收统计量),
   * 再按「版本变了而统计没跟上 / 校验没过 → 标待刷新」合并,陈旧的版本不以新鲜面目呈现。
   */
  async applyCoverageReport(
    providerId: string,
    label: string,
    raw: unknown,
    now: Date = new Date(),
  ): Promise<{ matched: number; updated: number }> {
    if (!DATA_SOURCE_LABEL_PATTERN.test(label)) {
      throw new BadRequestException(`数据源 label 非法:${label}`);
    }
    let report;
    try {
      report = validateCoverageReport(raw);
    } catch (e) {
      if (e instanceof CoverageReportError)
        throw new BadRequestException(e.message);
      throw e;
    }
    const products = await this.repo.find({
      where: { providerId, status: "active" as const },
    });
    let matched = 0;
    let updated = 0;
    for (const product of products) {
      let declaration: DataSourceDeclaration | null;
      try {
        declaration = parseDataSourceDeclaration(product.fhirSchema);
      } catch {
        continue; // 存量里声明不合法的产品不认领任何上报
      }
      if (declaration?.type !== "omop-cdm" || declaration.label !== label)
        continue;
      matched += 1;
      const merged = mergeCoverage(product.coverage, label, report, now);
      if (merged === undefined) continue;
      product.coverage = merged;
      await this.repo.save(product);
      updated += 1;
    }
    return { matched, updated };
  }

  /**
   * ndi-catalog-upstream-listing 的发布校验（step 1）。
   *
   * 兼容策略（grandfather）：存量 `service` 产品没有 `serviceSpec` 时，
   * 只要本次更新不涉及服务规格、也不转 `regional`，就**不拦**普通字段更新；
   * 避免该变更让老目录「改不动」。
   */
  private validateListing(
    input: {
      productType?: ProductType;
      listingScope?: ListingScope;
      listingConsent?: ListingConsent | null;
      serviceSpec?: ServiceSpec | null;
      serviceCapacity?: number | null;
      provenance?: ProductProvenance | null;
    },
    ctx: {
      isNew: boolean;
      existing?: {
        productType?: ProductType;
        listingScope?: ListingScope;
        serviceSpec?: ServiceSpec | null;
      };
    },
  ): void {
    const type = input.productType ?? ctx.existing?.productType ?? "data";
    const scope = input.listingScope ?? ctx.existing?.listingScope ?? "internal";
    const spec =
      input.serviceSpec !== undefined
        ? input.serviceSpec
        : (ctx.existing?.serviceSpec ?? null);
    const becomingRegional =
      scope === "regional" &&
      (ctx.isNew || ctx.existing?.listingScope !== "regional");
    const declaringSpec = input.serviceSpec !== undefined;

    if (type === "service" && (ctx.isNew || becomingRegional || declaringSpec)) {
      if (!spec)
        throw new BadRequestException(
          "数据服务必须提供 serviceSpec（统计口径/最小样本/出域闸门）",
        );
      assertServiceSpec(spec);
    } else if (spec) {
      assertServiceSpec(spec);
    }

    if (becomingRegional) {
      const consent = input.listingConsent ?? null;
      if (!consent)
        throw new BadRequestException(
          "转 regional 前必须提供 listingConsent（公开授权留痕：授权人/时间/依据）",
        );
      assertListingConsent(consent);
    }

    if (input.serviceCapacity !== undefined && input.serviceCapacity !== null) {
      if (
        !Number.isInteger(input.serviceCapacity) ||
        input.serviceCapacity < 0
      )
        throw new BadRequestException("serviceCapacity 必须是非负整数");
    }

    if (
      input.provenance?.namedParties &&
      input.provenance.namedParties.some((item) => !item.trim())
    )
      throw new BadRequestException("provenance.namedParties 不能含空值");
  }

  private declarationOf(
    fhirSchema?: Record<string, unknown> | null,
  ): DataSourceDeclaration | null {
    try {
      return parseDataSourceDeclaration(fhirSchema);
    } catch (e) {
      if (e instanceof DataSourceDeclarationError) {
        throw new BadRequestException(`数据源声明无效:${e.message}`);
      }
      throw e;
    }
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

/** 出域闸门参数允许区间（与合约 outputPolicy 一致：5–20）。 */
export const SERVICE_MIN_CELL_RANGE = [5, 20] as const;
export const SERVICE_DEFAULT_MIN_CELL_RARE = 10;

export function assertServiceSpec(spec: ServiceSpec): void {
  if (!spec || typeof spec !== "object")
    throw new BadRequestException("serviceSpec 必须是对象");
  if (typeof spec.statistic !== "string" || !spec.statistic.trim())
    throw new BadRequestException("serviceSpec.statistic 必须是非空字符串");
  if (!Number.isInteger(spec.minSample) || spec.minSample <= 0)
    throw new BadRequestException("serviceSpec.minSample 必须是正整数");
  const gate = spec.gate ?? {};
  const [min, max] = SERVICE_MIN_CELL_RANGE;
  if (gate.minCell !== undefined) {
    if (!Number.isInteger(gate.minCell) || gate.minCell < min || gate.minCell > max)
      throw new BadRequestException(
        `serviceSpec.gate.minCell 必须在 [${min}, ${max}] 区间内`,
      );
  }
  const rare = gate.minCellRare ?? SERVICE_DEFAULT_MIN_CELL_RARE;
  if (!Number.isInteger(rare) || rare < min)
    throw new BadRequestException(
      `serviceSpec.gate.minCellRare 必须 ≥ ${min}`,
    );
  if (gate.minCell !== undefined && rare < gate.minCell)
    throw new BadRequestException(
      "serviceSpec.gate.minCellRare 不得小于 minCell（放宽即拒）",
    );
}

export function assertListingConsent(consent: ListingConsent): void {
  if (!consent || typeof consent !== "object")
    throw new BadRequestException("listingConsent 必须是对象");
  for (const key of ["grantedBy", "grantedAt", "basis"] as const) {
    if (typeof consent[key] !== "string" || !consent[key].trim())
      throw new BadRequestException(`listingConsent.${key} 不能为空`);
  }
  const at = new Date(consent.grantedAt);
  if (Number.isNaN(at.getTime()))
    throw new BadRequestException("listingConsent.grantedAt 必须是可解析的时间");
}
