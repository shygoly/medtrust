import { Injectable } from '@nestjs/common';
import { CaService, Certificate, CertVerification } from '../participant-identity/ca.service';
import { DataProduct } from '../catalog/catalog.service';

// 跨空间互联(space-interconnect). Holds the federation trust list (other spaces'
// CAs) for cross-domain identity recognition, and a read-only index of remote
// data-product metadata pulled from trusted spaces. Raw data never enters here.
@Injectable()
export class FederationService {
  private readonly trust = new Map<string, string>(); // spaceId -> that space's CA public key
  private readonly remoteCatalog = new Map<string, DataProduct[]>(); // spaceId -> products (metadata only)

  constructor(private readonly ca: CaService) {
    // demo seed: trust a peer medical space and discover one of its products
    this.trustSpace('bj-med', 'SM2:demo-bj-med-ca-public-key');
    this.importRemoteCatalog('bj-med', [
      {
        id: 'remote-1',
        urn: 'urn:tds:bj-med:remote-1',
        homeSpace: 'bj-med',
        providerId: 'p-xiehe',
        title: '北京协和 · 心血管真实世界队列',
        classification: '敏感',
        rightsConfirmed: true,
        recordCount: 120_000,
      },
    ]);
  }

  trustSpace(spaceId: string, caPublicKey: string): void {
    this.trust.set(spaceId, caPublicKey);
  }

  trustedSpaces(): string[] {
    return [...this.trust.keys()];
  }

  // 9.2 — a foreign connector cert is recognized iff its issuing space is in the
  // trust list AND the signature/expiry verify against that space's CA.
  recognizeForeignCert(cert: Certificate): CertVerification {
    const caPub = this.trust.get(cert.spaceId);
    if (!caPub) return { valid: false, reason: `空间 ${cert.spaceId} 不在联邦信任清单` };
    return this.ca.verifyWith(cert, caPub);
  }

  // 9.3 — pull a remote space's catalog metadata (read-only; no raw data).
  importRemoteCatalog(spaceId: string, products: DataProduct[]): void {
    this.remoteCatalog.set(spaceId, products.map((p) => ({ ...p })));
  }

  // Discoverable remote data products (metadata only).
  discover(): DataProduct[] {
    return [...this.remoteCatalog.values()].flat();
  }

  // 9.5 groundwork — a task referencing a remote product must route to that
  // product's home space; data stays at the source connector.
  resolveHomeSpace(urn: string): string | null {
    const m = /^urn:tds:([^:]+):/.exec(urn);
    return m ? m[1] : null;
  }

  // 9.4 互通网关 — relay decision for a cross-space task: resolve the product's
  // home space and check mutual trust before relaying. The actual relay to the
  // peer space's gateway (and DSP protocol/format adaptation for international
  // spaces) is deferred. Data is never relayed — only the task and the result.
  relayPlan(urn: string): { urn: string; homeSpace: string | null; trusted: boolean; decision: 'relay' | 'reject'; reason?: string } {
    const homeSpace = this.resolveHomeSpace(urn);
    if (!homeSpace) return { urn, homeSpace: null, trusted: false, decision: 'reject', reason: '非法数据产品 URN' };
    const trusted = this.trust.has(homeSpace);
    return {
      urn,
      homeSpace,
      trusted,
      decision: trusted ? 'relay' : 'reject',
      reason: trusted ? undefined : `空间 ${homeSpace} 未在联邦信任清单,不能跨空间下发`,
    };
  }
}
