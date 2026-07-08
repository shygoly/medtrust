import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DataProduct as DataProductEntity } from '@medtrust/database';
import { CATALOG_PRODUCTS, SPACE_ID } from '@medtrust/demo-scenario';

// A data product = catalog metadata only. The raw data stays on the provider's
// connector; the catalog never holds rows (data-product spec). This is the
// DTO/transport shape; the persisted form is the DataProduct entity.
export interface DataProduct {
  id: string;
  urn: string; // global identifier urn:tds:<spaceId>:<productId> (9.1)
  homeSpace: string; // the space this product belongs to
  providerId: string;
  title: string;
  classification?: string; // 分级分类
  rightsConfirmed: boolean; // 确权
  recordCount: number;
  fhirSchema?: Record<string, unknown> | null;
}

export { SPACE_ID };

export interface PublishInput {
  providerId: string;
  title: string;
  classification?: string;
  rightsConfirmed: boolean;
  recordCount?: number;
  fhirSchema?: Record<string, unknown> | null;
}

// 目录管理(对齐《技术架构》"目录管理" + data-product spec)。替代旧 data-asset
// 的元数据职责;只登记数据产品元数据,绝不汇聚原始数据。持久化在 control-plane 库。
@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    @InjectRepository(DataProductEntity, 'controlplane')
    private readonly repo: Repository<DataProductEntity>,
  ) {}

  // 幂等演示种子(以 urn 为自然键)。缺失则插入;已有则同步种子元数据(便于 ID 统一后刷新)。
  async onModuleInit(): Promise<void> {
    for (const p of CATALOG_PRODUCTS) {
      const urn = `urn:tds:${SPACE_ID}:${p.id}`;
      const existing = await this.repo.findOne({ where: { urn } });
      if (existing) {
        existing.providerId = p.providerId;
        existing.title = p.title;
        existing.classification = p.classification;
        existing.rightsConfirmed = p.rightsConfirmed;
        existing.recordCount = p.recordCount;
        existing.fhirSchema = p.fhirSchema ?? null;
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
          classification: p.classification,
          rightsConfirmed: p.rightsConfirmed,
          recordCount: p.recordCount,
          fhirSchema: p.fhirSchema ?? null,
        }),
      );
    }
  }

  async publish(input: PublishInput): Promise<DataProduct> {
    // 未确权 / 未分类不可发布
    if (!input.rightsConfirmed) throw new BadRequestException('数据产品未确权,不可发布');
    if (!input.classification) throw new BadRequestException('数据产品未分级分类,不可发布');
    const id = randomUUID();
    return this.repo.save(
      this.repo.create({
        id,
        urn: `urn:tds:${SPACE_ID}:${id}`,
        homeSpace: SPACE_ID,
        providerId: input.providerId,
        title: input.title,
        classification: input.classification,
        rightsConfirmed: input.rightsConfirmed,
        recordCount: input.recordCount ?? 0,
        fhirSchema: input.fhirSchema ?? null,
      }),
    );
  }

  list(): Promise<DataProduct[]> {
    return this.repo.find();
  }

  get(id: string): Promise<DataProduct | null> {
    return this.repo.findOne({ where: { id } });
  }
}
