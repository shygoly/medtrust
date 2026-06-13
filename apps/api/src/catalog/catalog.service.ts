import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

// A data product = catalog metadata only. The raw data stays on the provider's
// connector; the catalog never holds rows (data-product spec).
export interface DataProduct {
  id: string;
  providerId: string;
  title: string;
  classification?: string; // 分级分类
  rightsConfirmed: boolean; // 确权
  recordCount: number;
  fhirSchema?: Record<string, unknown> | null;
}

export interface PublishInput {
  providerId: string;
  title: string;
  classification?: string;
  rightsConfirmed: boolean;
  recordCount?: number;
  fhirSchema?: Record<string, unknown> | null;
}

// 目录管理(对齐《技术架构》"目录管理" + data-product spec)。替代旧 data-asset
// 的元数据职责;只登记数据产品元数据,绝不汇聚原始数据。
@Injectable()
export class CatalogService {
  private readonly products = new Map<string, DataProduct>();

  publish(input: PublishInput): DataProduct {
    // 未确权 / 未分类不可发布
    if (!input.rightsConfirmed) throw new BadRequestException('数据产品未确权,不可发布');
    if (!input.classification) throw new BadRequestException('数据产品未分级分类,不可发布');
    const product: DataProduct = {
      id: randomUUID(),
      providerId: input.providerId,
      title: input.title,
      classification: input.classification,
      rightsConfirmed: input.rightsConfirmed,
      recordCount: input.recordCount ?? 0,
      fhirSchema: input.fhirSchema ?? null,
    };
    this.products.set(product.id, product);
    return product;
  }

  list(): DataProduct[] {
    return [...this.products.values()];
  }

  get(id: string): DataProduct | undefined {
    return this.products.get(id);
  }
}
