import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FederationTrust, RemoteCatalogEntry } from "@medtrust/database";
import {
  CaService,
  Certificate,
  CertVerification,
} from "../participant-identity/ca.service";
import { DataProduct } from "../catalog/catalog.service";

// 跨空间互联(space-interconnect). Holds the federation trust list (other spaces'
// CAs) for cross-domain identity recognition, and a read-only index of remote
// data-product metadata pulled from trusted spaces. Raw data never enters here.
// 信任清单 + 远端目录缓存持久化在 control-plane 库。
@Injectable()
export class FederationService implements OnModuleInit {
  constructor(
    private readonly ca: CaService,
    @InjectRepository(FederationTrust, "controlplane")
    private readonly trustRepo: Repository<FederationTrust>,
    @InjectRepository(RemoteCatalogEntry, "controlplane")
    private readonly remoteRepo: Repository<RemoteCatalogEntry>,
  ) {}

  // demo seed: trust a peer medical space and discover one of its products (idempotent).
  async onModuleInit(): Promise<void> {
    await this.trustSpace("bj-med", "SM2:demo-bj-med-ca-public-key");
    if ((await this.remoteRepo.count({ where: { spaceId: "bj-med" } })) === 0) {
      await this.importRemoteCatalog("bj-med", [
        {
          id: "remote-1",
          urn: "urn:tds:bj-med:remote-1",
          homeSpace: "bj-med",
          providerId: "p-demohospd",
          title: "北京示范丁 · 心血管真实世界队列",
          classification: "敏感",
          rightsConfirmed: true,
          recordCount: 120_000,
        },
      ]);
    }
  }

  async trustSpace(spaceId: string, caPublicKey: string): Promise<void> {
    const existing = await this.trustRepo.findOne({ where: { spaceId } });
    if (existing) {
      existing.caPublicKey = caPublicKey;
      await this.trustRepo.save(existing);
    } else {
      await this.trustRepo.save(
        this.trustRepo.create({ spaceId, caPublicKey }),
      );
    }
  }

  async trustedSpaces(): Promise<string[]> {
    return (await this.trustRepo.find()).map((t) => t.spaceId);
  }

  // 9.2 — a foreign connector cert is recognized iff its issuing space is in the
  // trust list AND the signature/expiry verify against that space's CA.
  async recognizeForeignCert(cert: Certificate): Promise<CertVerification> {
    const trust = await this.trustRepo.findOne({
      where: { spaceId: cert.spaceId },
    });
    if (!trust)
      return { valid: false, reason: `空间 ${cert.spaceId} 不在联邦信任清单` };
    return this.ca.verifyWith(cert, trust.caPublicKey);
  }

  // 9.3 — pull a remote space's catalog metadata (read-only; no raw data).
  async importRemoteCatalog(
    spaceId: string,
    products: DataProduct[],
  ): Promise<void> {
    await this.remoteRepo.delete({ spaceId });
    await this.remoteRepo.save(
      products.map((p) =>
        this.remoteRepo.create({
          spaceId,
          productId: p.id,
          urn: p.urn,
          homeSpace: p.homeSpace,
          providerId: p.providerId,
          title: p.title,
          classification: p.classification,
          rightsConfirmed: p.rightsConfirmed,
          recordCount: p.recordCount,
        }),
      ),
    );
  }

  // Discoverable remote data products (metadata only).
  async discover(): Promise<DataProduct[]> {
    const rows = await this.remoteRepo.find();
    return rows.map((r) => ({
      id: r.productId,
      urn: r.urn,
      homeSpace: r.homeSpace,
      providerId: r.providerId,
      title: r.title,
      classification: r.classification,
      rightsConfirmed: r.rightsConfirmed,
      recordCount: r.recordCount,
    }));
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
  async relayPlan(urn: string): Promise<{
    urn: string;
    homeSpace: string | null;
    trusted: boolean;
    decision: "relay" | "reject";
    reason?: string;
  }> {
    const homeSpace = this.resolveHomeSpace(urn);
    if (!homeSpace)
      return {
        urn,
        homeSpace: null,
        trusted: false,
        decision: "reject",
        reason: "非法数据产品 URN",
      };
    const trusted =
      (await this.trustRepo.findOne({ where: { spaceId: homeSpace } })) != null;
    return {
      urn,
      homeSpace,
      trusted,
      decision: trusted ? "relay" : "reject",
      reason: trusted
        ? undefined
        : `空间 ${homeSpace} 未在联邦信任清单,不能跨空间下发`,
    };
  }
}
