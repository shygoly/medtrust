import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { User, XianUserLink } from "@medtrust/database";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AuthService } from "../../auth/auth.service";
import { XianApiError } from "./xian-api-error";

interface EnterpriseInfo {
  enterpriseName?: string;
  unifiedSocialCreditCode?: string;
}

@Injectable()
export class XianOpenApiService {
  private readonly logger = new Logger(XianOpenApiService.name);
  private readonly privateKeyHex: string;

  constructor(
    private readonly config: ConfigService,
    private readonly gm: GMCryptoService,
    private readonly auth: AuthService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(XianUserLink)
    private readonly links: Repository<XianUserLink>,
  ) {
    const pkcs8 = this.config.get<string>("XIAN_SM2_PRIVATE_KEY_PKCS8_B64");
    this.privateKeyHex = pkcs8
      ? this.gm.extractSm2PrivateKeyHexFromPkcs8(pkcs8)
      : "";
  }

  async userSync(body: any) {
    this.assertConfigured();
    const requestId = this.str(body?.requestId);
    const tenantId = this.str(body?.tenantId);
    const userId = this.str(body?.userId);
    const userName = this.str(body?.userName);
    if (!requestId || !tenantId || !userId || !userName) {
      throw new XianApiError("SYSTEM_ERROR", "missing required fields");
    }

    const mobile = this.decryptField(body?.mobile);
    const email = this.decryptField(body?.email);
    const passwordPlain = this.decryptField(body?.password);
    const enterprise: EnterpriseInfo = body?.enterpriseInfo ?? {};

    const link = await this.links.findOne({ where: { tenantId, userId } });
    let user: User | null = null;

    if (link) {
      user = await this.users.findOne({ where: { id: link.localUserId } });
    } else {
      const emailToUse =
        email || `xian-${tenantId}-${userId}@xian-node.local`;
      user = await this.users.findOne({ where: { email: emailToUse } });
      if (!user) {
        const passwordHash = await bcrypt.hash(
          passwordPlain || randomBytes(12).toString("hex"),
          10,
        );
        user = await this.users.save(
          this.users.create({
            email: emailToUse,
            name: userName,
            passwordHash,
            participantId: `xian-${tenantId}`,
            participantRole: this.resolveRole(tenantId),
          }),
        );
      }
      await this.links.save(
        this.links.create({
          tenantId,
          userId,
          localUserId: user.id,
          enterpriseName: enterprise.enterpriseName ?? null,
          unifiedSocialCreditCode:
            enterprise.unifiedSocialCreditCode ?? null,
        }),
      );
    }

    if (user) {
      if (user.name !== userName) {
        user.name = userName;
      }
      if (passwordPlain) {
        user.passwordHash = await bcrypt.hash(passwordPlain, 10);
      }
      await this.users.save(user);
    }

    this.logger.log(
      `xian user sync ok: requestId=${requestId} tenant=${tenantId} user=${userId}`,
    );
    return { code: "SUCCESS", message: "user synchronized" };
  }

  async login(body: any) {
    this.assertConfigured();
    const tenantId = this.str(body?.tenantId);
    const userId = this.str(body?.userId);
    if (!tenantId || !userId) {
      throw new XianApiError("SYSTEM_ERROR", "missing required fields");
    }

    const link = await this.links.findOne({ where: { tenantId, userId } });
    if (!link) throw new XianApiError("INVALID_USER");
    const user = await this.users.findOne({ where: { id: link.localUserId } });
    if (!user || user.deletedAt) throw new XianApiError("ACCOUNT_DISABLED");

    const rawTicket = await this.auth.createSsoTicket(user.id);
    const base =
      this.config.get<string>("XIAN_WEB_BASE_URL") || "http://localhost:5020";
    return {
      code: "SUCCESS",
      message: "login success",
      data: {
        loginUrl: `${base}/login/sso?ticket=${encodeURIComponent(rawTicket)}`,
      },
    };
  }

  private assertConfigured(): void {
    if (!this.privateKeyHex) {
      throw new XianApiError(
        "SYSTEM_ERROR",
        "XIAN_SM2_PRIVATE_KEY_PKCS8_B64 not configured",
      );
    }
  }

  private decryptField(value: string | undefined): string {
    if (!value) return "";
    return this.gm.sm2DecryptC1C2C3Base64(value, this.privateKeyHex);
  }

  private str(value: unknown): string {
    return String(value ?? "").trim();
  }

  private resolveRole(tenantId: string): User["participantRole"] {
    const raw = this.config.get<string>("XIAN_TENANT_ROLE_MAP");
    try {
      const map = raw ? JSON.parse(raw) : {};
      const role = map[tenantId];
      return ["provider", "consumer", "operator", "compliance"].includes(role)
        ? role
        : "consumer";
    } catch {
      return "consumer";
    }
  }
}
