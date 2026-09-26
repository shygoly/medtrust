import { Injectable, Optional } from '@nestjs/common';
import { parseDataSourceDeclaration, type DataSourceDeclaration } from '@medtrust/database';
import { AuditService } from './audit';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';
import { LocalDataLoader, LocalDataLoadResult } from './local-data-loader';
import { InternalRecord } from './types';
import { LocalStore } from './local-store';
import { ContractView } from './contract-view';
import { LocalGoldStandardStore } from './local-gold-standard-store';
import { loadSyntheticGoldBeside } from './injected-truth-gold';

/**
 * omop-data-source-access D8：CDM 类型的数据产品在本变更里一律不派发。
 * 这里交付的是 CDM 取数**机制**；队列定义与时间窗（「暴露后多久内发生」）属 Circe 变更，
 * 在那之前把「全部诊断当不良事件」放进生产，会产出看似正常、实则误导的结果。
 */
export class CdmAnalysisNotOpenError extends Error {
  constructor(
    readonly productId: string,
    readonly label: string,
  ) {
    super(
      `数据产品 ${productId} 声明为 CDM 数据源（${label}）：` +
        'CDM 数据源的分析语义（队列定义 / 时间窗）由 Circe 变更提供，当前未开放。' +
        '任务失败，且不会改用本地文件数据',
    );
    this.name = 'CdmAnalysisNotOpenError';
  }
}

export interface ProductIngestResult extends LocalDataLoadResult {
  productId?: string;
  /** Synthetic gold rows ingested from sibling truth.json (demo / CTL-12). */
  goldIngested?: number;
}

/**
 * Binds catalog data-product metadata to connector-local storage.
 * Dispatches on the product's declared data source (`fhirSchema.dataSource`, or the
 * legacy `localDataPath` which means file). Only file sources materialize here.
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
    /**
     * 按需拉取目录元数据（异步）。启动预热失败（平台正在重启）时，
     * 只有缓存查表的同步解析器会永远为空——这里给一次自愈机会。
     */
    @Optional() private readonly catalogPrefetch?: (productId: string) => Promise<CatalogProduct | null>,
  ) {}

  /** Dev / test override: register product metadata without HTTP. */
  registerProduct(product: CatalogProduct): void {
    this.productRegistry.set(product.id, product);
  }

  resolveProduct(productId: string): CatalogProduct | null {
    return this.productRegistry.get(productId) ?? this.catalogResolver?.(productId) ?? null;
  }

  /** 先查本地，再**按需向平台拉一次**目录元数据（拉到即登记，后续同步解析可用）。 */
  async resolveProductAsync(productId: string): Promise<CatalogProduct | null> {
    const cached = this.resolveProduct(productId);
    if (cached) return cached;
    if (!this.catalogPrefetch) return null;
    const fetched = await this.catalogPrefetch(productId);
    if (fetched) this.productRegistry.set(fetched.id ?? productId, fetched);
    return fetched ?? null;
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

  /**
   * 按数据产品**声明的**数据源类型分派（spec: 数据源类型不得静默切换）。
   * CDM 产品永远不读文件——哪怕库不可用、哪怕元数据里残留着路径（解析器已拒绝这种歧义）。
   */
  loadFromProduct(product: CatalogProduct): ProductIngestResult {
    const declaration = this.declarationOf(product);
    if (declaration.type === 'omop-cdm') {
      const refusal = new CdmAnalysisNotOpenError(product.id, declaration.label);
      this.audit.record({
        action: 'ingest',
        actor: 'data-product-local-source',
        allowed: false,
        detail: `product=${product.id} source=omop-cdm:${declaration.label} 拒绝派发（CDM 分析语义未开放）`,
      });
      throw refusal;
    }
    const result = this.loader.loadFromDeclaredPath(declaration.path);
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

  private declarationOf(product: CatalogProduct): DataSourceDeclaration {
    let declaration: DataSourceDeclaration | null;
    try {
      declaration = parseDataSourceDeclaration(product.fhirSchema);
    } catch (e) {
      throw new Error(`数据产品 ${product.id} 的数据源声明无效：${(e as Error).message}`);
    }
    if (!declaration) {
      throw new Error(
        `数据产品 ${product.id} 未声明数据源（fhirSchema.dataSource 或 localDataPath）`,
      );
    }
    return declaration;
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

  /**
   * 按合约的数据产品取记录做一次**内部**推导（omop-data-source-access 4.3）：与 ensureForContract
   * 同一套按声明类型分派（CDM 拒绝、不读文件），但记录只在这次调用里存在，**不替换**共享的
   * LocalStore——执行队列有并发（CONNECTOR_TASK_CONCURRENCY），训练轮次不能把别的任务正在用的
   * 本地数据换掉。返回的只能是 derive 的推导结果，记录本身不外流。
   */
  withProductRecords<T>(
    contract: ContractView,
    actor: string,
    derive: (records: readonly InternalRecord[]) => T,
  ): T {
    if (!contract.dataProductId) {
      throw new Error('合约未指向数据产品：连接器无从确定数据来源（fail-closed）');
    }
    const product = this.resolveProduct(contract.dataProductId);
    if (!product) {
      throw new Error(`无法解析数据产品元数据: ${contract.dataProductId}`);
    }
    const declaration = this.declarationOf(product);
    if (declaration.type === 'omop-cdm') {
      this.audit.record({
        action: 'ingest',
        actor,
        allowed: false,
        detail: `product=${product.id} source=omop-cdm:${declaration.label} 拒绝派发（CDM 分析语义未开放）`,
      });
      throw new CdmAnalysisNotOpenError(product.id, declaration.label);
    }
    const { records, resolvedPath } = this.loader.loadFromDeclaredPath(declaration.path);
    this.audit.record({
      action: 'compute',
      actor,
      allowed: true,
      detail: `product=${product.id} 内部推导 ${records.length} 条 @ ${resolvedPath}（不替换本地存储）`,
    });
    return derive(records);
  }
}
