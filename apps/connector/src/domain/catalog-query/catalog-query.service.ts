import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogProduct } from '../catalog-product';
import { ControlPlaneClient } from '../control-plane-client';

/** 对外只暴露这些字段：产品标识、提供方、标题、字段清单。 */
export interface CatalogProductView {
  productId: string;
  providerId: string;
  title?: string;
  profile?: string;
  fields?: Array<{ name: string; type?: string; description?: string }>;
}

export interface CatalogQueryOptions {
  limit?: number;
  offset?: number;
  q?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 连接器侧只读目录服务（NDI-TR-2025-05 §6.3.4 / §7.2）。
 *
 * 三条硬约束：
 * 1. **默认关闭**（`CONNECTOR_CATALOG_SERVICE` 未设置即 off），关闭时路由返回 404；
 * 2. **只回元数据**：字段白名单 + 不含数据行、不含精确记录数（避免用行数反推规模）；
 * 3. **对端白名单**：配置了 `CONNECTOR_CATALOG_PEERS` 时，未登记对端一律拒绝。
 */
@Injectable()
export class CatalogQueryService {
  constructor(private readonly controlPlane: ControlPlaneClient) {}

  isEnabled(): boolean {
    return (process.env.CONNECTOR_CATALOG_SERVICE ?? 'off').trim().toLowerCase() === 'on';
  }

  assertEnabled(): void {
    if (!this.isEnabled()) {
      // 关闭时不注册语义：对外表现为 404，避免暴露「有这个接口但没开」。
      throw new NotFoundException('连接器目录服务未启用');
    }
  }

  assertPeerAllowed(participantId: string): void {
    const raw = (process.env.CONNECTOR_CATALOG_PEERS ?? '').trim();
    if (!raw) return;
    const peers = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!peers.includes(participantId)) {
      throw new ForbiddenException('该对端未在本院目录服务白名单内');
    }
  }

  list(options: CatalogQueryOptions = {}): { total: number; items: CatalogProductView[] } {
    const all = this.controlPlane.listCachedCatalogProducts().map(toView);
    const keyword = (options.q ?? '').trim().toLowerCase();
    const filtered = keyword
      ? all.filter(
          (item) =>
            item.productId.toLowerCase().includes(keyword) ||
            (item.title ?? '').toLowerCase().includes(keyword),
        )
      : all;
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
  }

  get(productId: string): CatalogProductView {
    const found = this.controlPlane
      .listCachedCatalogProducts()
      .find((item) => item.id === productId);
    if (!found) throw new NotFoundException('本院没有该产品');
    return toView(found);
  }
}

function clampLimit(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(value), 1), MAX_LIMIT);
}

/**
 * 字段白名单：只保留标识与字段清单。
 * `recordCount` 之类的规模信息**不出**（服务/产品规模不通过目录泄露）。
 */
export function toView(product: CatalogProduct): CatalogProductView {
  const schema = (product.fhirSchema ?? {}) as {
    profile?: unknown;
    fields?: unknown;
  };
  const fields = Array.isArray(schema.fields)
    ? schema.fields
        .map((field) => {
          const item = field as { name?: unknown; type?: unknown; description?: unknown };
          if (typeof item?.name !== 'string' || !item.name) return null;
          return {
            name: item.name,
            ...(typeof item.type === 'string' ? { type: item.type } : {}),
            ...(typeof item.description === 'string' ? { description: item.description } : {}),
          };
        })
        .filter((item): item is { name: string; type?: string; description?: string } => !!item)
    : undefined;
  return {
    productId: product.id,
    providerId: product.providerId,
    ...(product.title ? { title: product.title } : {}),
    ...(typeof schema.profile === 'string' ? { profile: schema.profile } : {}),
    ...(fields ? { fields } : {}),
  };
}
