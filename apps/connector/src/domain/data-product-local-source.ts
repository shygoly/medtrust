import { Injectable, Optional } from '@nestjs/common';
import { AuditService } from './audit';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';
import { extractLocalDataPath } from './local-data-path';
import { LocalDataLoader, LocalDataLoadResult } from './local-data-loader';
import { LocalStore } from './local-store';
import { ContractView } from './contract-view';

export interface ProductIngestResult extends LocalDataLoadResult {
  productId?: string;
}

/**
 * Binds catalog data-product metadata to connector-local storage.
 * Reads fhirSchema.localDataPath generically — any product with that field can load.
 */
@Injectable()
export class DataProductLocalSource {
  private loadedProductId: string | null = null;
  private readonly productRegistry = new Map<string, CatalogProduct>();

  constructor(
    private readonly store: LocalStore,
    private readonly loader: LocalDataLoader,
    private readonly audit: AuditService,
    @Optional() private readonly catalogResolver?: CatalogProductResolver,
  ) {}

  /** Dev / test override: register product metadata without HTTP. */
  registerProduct(product: CatalogProduct): void {
    this.productRegistry.set(product.id, product);
  }

  resolveProduct(productId: string): CatalogProduct | null {
    return this.productRegistry.get(productId) ?? this.catalogResolver?.(productId) ?? null;
  }

  loadFromDeclaredPath(declaredPath: string): ProductIngestResult {
    const result = this.loader.loadFromDeclaredPath(declaredPath);
    this.store.replaceAll(result.records);
    this.audit.record({
      action: 'ingest',
      actor: 'data-product-local-source',
      allowed: true,
      detail: `${result.records.length} 条 @ ${result.resolvedPath} (${result.format})`,
    });
    this.loadedProductId = null;
    return result;
  }

  loadFromProduct(product: CatalogProduct): ProductIngestResult {
    const declaredPath = extractLocalDataPath(product.fhirSchema);
    if (!declaredPath) {
      throw new Error(`数据产品 ${product.id} 未配置 fhirSchema.localDataPath`);
    }
    const result = this.loader.loadFromDeclaredPath(declaredPath);
    this.store.replaceAll(result.records);
    this.loadedProductId = product.id;
    this.audit.record({
      action: 'ingest',
      actor: 'data-product-local-source',
      allowed: true,
      detail: `product=${product.id} ${result.records.length} 条 @ ${result.resolvedPath}`,
    });
    return { ...result, productId: product.id };
  }

  /** Idempotent: skip reload if the same product is already materialized. */
  ensureForContract(contract: ContractView): ProductIngestResult | null {
    if (!contract.dataProductId) return null;
    if (this.loadedProductId === contract.dataProductId && this.store.count() > 0) {
      return null;
    }

    const product = this.resolveProduct(contract.dataProductId);
    if (!product) {
      throw new Error(`无法解析数据产品元数据: ${contract.dataProductId}`);
    }
    return this.loadFromProduct(product);
  }

  loadedProduct(): string | null {
    return this.loadedProductId;
  }
}
