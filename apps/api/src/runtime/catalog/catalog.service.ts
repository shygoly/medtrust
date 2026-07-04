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
  dataPath?: string;
}

// 目录管理(对齐《技术架构》"目录管理" + data-product spec)。替代旧 data-asset
// 的元数据职责;只登记数据产品元数据,绝不汇聚原始数据。持久化在 control-plane 库。
@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    @InjectRepository(DataProductEntity, 'controlplane')
    private readonly repo: Repository<DataProductEntity>,
  ) {}

  // 幂等演示种子(以 urn 为自然键)。缺失时插入;已有行仅补全 seed 中的 dataPath(不覆盖其它字段)。
  async onModuleInit(): Promise<void> {
    for (const p of CATALOG_PRODUCTS) {
      const urn = `urn:tds:${SPACE_ID}:${p.id}`;
      const seedDataPath = (p.fhirSchema as { dataPath?: string } | undefined)?.dataPath;
      const existing = await this.repo.findOne({ where: { urn } });
      if (existing) {
        if (
          seedDataPath &&
          !(existing.fhirSchema as { dataPath?: string } | null)?.dataPath
        ) {
          existing.fhirSchema = { ...(existing.fhirSchema ?? {}), dataPath: seedDataPath };
          await this.repo.save(existing);
        }
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
    const fhirSchema = {
      ...(input.fhirSchema ?? {}),
      ...(input.dataPath ? { dataPath: input.dataPath } : {}),
    };
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
        fhirSchema: Object.keys(fhirSchema).length ? fhirSchema : null,
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
