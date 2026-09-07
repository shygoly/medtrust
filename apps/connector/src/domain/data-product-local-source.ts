import { Injectable, Optional } from '@nestjs/common';
import { AuditService } from './audit';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';
import { extractLocalDataPath } from './local-data-path';
import { LocalDataLoader, LocalDataLoadResult } from './local-data-loader';
import { LocalStore } from './local-store';
import { ContractView } from './contract-view';
import { LocalGoldStandardStore } from './local-gold-standard-store';
import { loadSyntheticGoldBeside } from './injected-truth-gold';

export interface ProductIngestResult extends LocalDataLoadResult {
  productId?: string;
  /** Synthetic gold rows ingested from sibling truth.json (demo / CTL-12). */
  goldIngested?: number;
}

/**
 * Binds catalog data-product metadata to connector-local storage.
 * Reads fhirSchema.localDataPath generically — any product with that field can load.
 * When the path has a sibling truth.json (injected demo slices), also materializes
 * synthetic gold into LocalGoldStandardStore for L0 (§7.3 / CTL-12).
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
    @Optional() private readonly goldStore?: LocalGoldStandardStore,
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
    const goldIngested = this.ingestSiblingGold(result.resolvedPath);
    this.audit.record({
      action: 'ingest',
      actor: 'data-product-local-source',
      allowed: true,
      detail: `${result.records.length} 条 @ ${result.resolvedPath} (${result.format})` +
        (goldIngested ? `; gold=${goldIngested}` : ''),
    });
    this.loadedProductId = null;
    return { ...result, goldIngested };
  }

  loadFromProduct(product: CatalogProduct): ProductIngestResult {
    const declaredPath = extractLocalDataPath(product.fhirSchema);
    if (!declaredPath) {
      throw new Error(`数据产品 ${product.id} 未配置 fhirSchema.localDataPath`);
    }
    const result = this.loader.loadFromDeclaredPath(declaredPath);
    this.store.replaceAll(result.records);
    const goldIngested = this.ingestSiblingGold(result.resolvedPath);
    this.loadedProductId = product.id;
    this.audit.record({
      action: 'ingest',
      actor: 'data-product-local-source',
      allowed: true,
      detail: `product=${product.id} ${result.records.length} 条 @ ${result.resolvedPath}` +
        (goldIngested ? `; gold=${goldIngested}` : ''),
    });
    return { ...result, productId: product.id, goldIngested };
  }

  private ingestSiblingGold(resolvedPath: string): number | undefined {
    if (!this.goldStore) return undefined;
    const rows = loadSyntheticGoldBeside(resolvedPath);
    if (!rows?.length) return undefined;
    this.goldStore.replaceAll(rows);
    return rows.length;
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
