import { Injectable } from '@nestjs/common';
import { CatalogProduct, CatalogProductResolver } from './catalog-product';

export interface CatalogResolverOptions {
  baseUrl?: string;
  bearerToken?: string;
  participantId?: string;
  connectorToken?: string;
}

/**
 * HTTP catalog cache for connector outbound fetch.
 * Prefer ControlPlaneClient.prefetchCatalogProduct (connector token auth).
 */
@Injectable()
export class HttpCatalogProductCache {
  private readonly cache = new Map<string, CatalogProduct>();
  private readonly baseUrl: string;
  private readonly bearerToken?: string;
  private readonly participantId: string;
  private readonly connectorToken: string;

  constructor(opts: CatalogResolverOptions = {}) {
    const root = opts.baseUrl ?? process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1';
    this.baseUrl = root.replace(/\/$/, '');
    this.bearerToken = opts.bearerToken ?? process.env.CONNECTOR_CATALOG_TOKEN;
    this.participantId = opts.participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
    this.connectorToken = opts.connectorToken ?? process.env.CONNECTOR_PULL_TOKEN ?? 'dev-connector-token';
  }

  asResolver(): CatalogProductResolver {
    return (productId) => this.cache.get(productId) ?? null;
  }

  async prefetch(productId: string): Promise<CatalogProduct | null> {
    const cached = this.cache.get(productId);
    if (cached) return cached;

    if (this.participantId) {
      const connectorRes = await fetch(
        `${this.baseUrl}/connector/catalog/${productId}?participantId=${encodeURIComponent(this.participantId)}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Connector-Token': this.connectorToken,
            'X-Connector-Participant': this.participantId,
          },
        },
      );
      if (connectorRes.ok) {
        const product = (await connectorRes.json()) as CatalogProduct;
        this.cache.set(productId, product);
        return product;
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;

    const res = await fetch(`${this.baseUrl}/catalog/${productId}`, { headers });
    if (!res.ok) return null;

    const product = (await res.json()) as CatalogProduct;
    this.cache.set(productId, product);
    return product;
  }

  put(product: CatalogProduct): void {
    this.cache.set(product.id, product);
  }
}
