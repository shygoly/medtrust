import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash, randomBytes, randomUUID } from "crypto";
import { Certificate, OpenPlatformApp, SpaceEntity } from "@medtrust/database";
import { CaService } from "../runtime/participant-identity/ca.service";

// P2-6:平台管理员基础设施管理——空间、证书生命周期、开放平台应用。
// 全部 admin 门禁(由控制器统一 @ParticipantRoles("admin"))。
@Injectable()
export class InfraAdminService {
  constructor(
    @InjectRepository(SpaceEntity, "controlplane")
    private readonly spaces: Repository<SpaceEntity>,
    @InjectRepository(Certificate, "controlplane")
    private readonly certs: Repository<Certificate>,
    @InjectRepository(OpenPlatformApp, "controlplane")
    private readonly apps: Repository<OpenPlatformApp>,
    private readonly caService: CaService,
  ) {}

  // ---- 空间管理(只读) ----
  // 空间的创建/删除唯一入口在 SpaceController(/spaces,operator 门禁,INV-SPACE-01)。
  // 此处仅提供 admin 视角的只读列表,避免双入口角色口径冲突。
  listSpaces() {
    return this.spaces.find({ order: { createdAt: "DESC" } });
  }

  // ---- 证书生命周期 ----
  listCertificates() {
    return this.certs.find({
      order: { issuedAt: "DESC" },
      take: 200,
    });
  }

  async revokeCertificate(fingerprint: string) {
    await this.caService.revoke(fingerprint);
    return { ok: true, fingerprint };
  }

  async caInfo() {
    const issued = await this.certs.count();
    return {
      spaceId: this.caService.spaceId,
      caPublicKey: this.caService.caPublicKey,
      issuedCount: issued,
      revokedCount: await this.certs.count({ where: { revoked: true } }),
    };
  }

  // ---- 开放平台应用管理 ----
  listApps() {
    return this.apps.find({ order: { createdAt: "DESC" }, take: 200 });
  }

  async createApp(input: { name: string; scopes?: string[] }) {
    const appId = `app-${randomUUID().slice(0, 8)}`;
    const appSecret = randomBytes(32).toString("hex");
    const appKeyHash = createHash("sha256").update(appSecret).digest("hex");
    await this.apps.save(
      this.apps.create({
        appId,
        name: input.name,
        appKeyHash,
        scopes: input.scopes ?? [],
        status: "active",
      }),
    );
    // 密钥仅此一次明文返回。
    return { appId, appSecret, name: input.name, scopes: input.scopes ?? [] };
  }

  async revokeApp(id: string) {
    const app = await this.apps.findOne({ where: { id } });
    if (!app) throw new NotFoundException("应用不存在");
    app.status = "revoked";
    app.revokedAt = new Date();
    await this.apps.save(app);
    return { ok: true };
  }

  // 供未来西安节点集成迁移使用:校验应用密钥(不再硬编码 env)。
  async verifyAppKey(appId: string, appSecret: string): Promise<boolean> {
    const app = await this.apps.findOne({ where: { appId, status: "active" } });
    if (!app) return false;
    const hash = createHash("sha256").update(appSecret).digest("hex");
    return hash === app.appKeyHash;
  }
}
