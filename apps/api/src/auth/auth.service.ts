import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { createHash, randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import { User, RefreshToken, SsoTicket } from "@medtrust/database";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { getJwtSecret } from "./jwt-secret.util";
import { DEFAULT_TENANT_ID } from "./auth.constants";

const REFRESH_TTL_MS =
  (Number(process.env.REFRESH_EXPIRES_DAYS) || 7) * 86_400_000;

const SSO_TICKET_TTL_MS =
  (Number(process.env.XIAN_LOGIN_TICKET_TTL_MS) || 60) * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(SsoTicket)
    private readonly ssoTickets: Repository<SsoTicket>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initDemoUsers();
  }

  // 幂等演示账号(以 email 为自然键,仅缺失时插入)。
  private async initDemoUsers(): Promise<void> {
    const demoUsers: Array<{
      email: string;
      password: string;
      name: string;
      participantId: string;
      participantRole: User["participantRole"];
    }> = [
      {
        email: "admin@huashan-hospital.com",
        password: "demo123456",
        name: "华山医院管理员",
        participantId: "p-huashan",
        participantRole: "provider",
      },
      {
        email: "admin@rjh.com.cn",
        password: "demo123456",
        name: "瑞金医院管理员",
        participantId: "p-ruijin",
        participantRole: "provider",
      },
      {
        email: "research@meddata-inst.edu.cn",
        password: "demo123456",
        name: "研究院研究员",
        participantId: "p-meddata",
        participantRole: "consumer",
      },
      {
        email: "pv@hengrui-pharma.com",
        password: "demo123456",
        name: "恒瑞医药 PV 研究员",
        participantId: "pharma-hengrui",
        participantRole: "consumer",
      },
      {
        email: "contact@smartmed-ai.com",
        password: "demo123456",
        name: "智慧医疗AI科技",
        participantId: "p-smartmed",
        participantRole: "consumer",
      },
      {
        email: "data-governance@health.gov.cn",
        password: "demo123456",
        name: "区域卫健委监管员",
        participantId: "p-health-gov",
        participantRole: "operator",
      },
      {
        email: "compliance@medtrust.org",
        password: "demo123456",
        name: "数据合规审查官",
        participantId: "p-compliance",
        participantRole: "compliance",
      },
    ];
    for (const d of demoUsers) {
      if (await this.users.findOne({ where: { email: d.email } })) continue;
      const passwordHash = await bcrypt.hash(d.password, 10);
      await this.users.save(
        this.users.create({
          email: d.email,
          name: d.name,
          passwordHash,
          participantId: d.participantId,
          participantRole: d.participantRole,
        }),
      );
    }
  }

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;
    if (await this.users.findOne({ where: { email } })) {
      throw new UnauthorizedException("User already exists");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    // Self-registered users have no participant binding yet — an operator assigns it later.
    const user = await this.users.save(
      this.users.create({
        email,
        name: name || email.split("@")[0],
        passwordHash,
      }),
    );
    return this.session(user);
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    const user = await this.users.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return this.session(user);
  }

  // Rotate: validate the presented refresh token, revoke it, issue a fresh pair.
  async refresh(rawToken: string) {
    const row = await this.refreshTokens.findOne({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    row.revoked = true;
    await this.refreshTokens.save(row);
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) throw new UnauthorizedException("Invalid refresh token");
    return this.session(user);
  }

  async logout(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await this.refreshTokens.update(
      { tokenHash: this.hashToken(rawToken) },
      { revoked: true },
    );
  }

  // 免登一次性 ticket（PDF §7）：只给 hash，原文只在 loginUrl 出现一次。
  async createSsoTicket(userId: number): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    await this.ssoTickets.save(
      this.ssoTickets.create({
        ticketHash: this.hashToken(raw),
        userId,
        expiresAt: new Date(Date.now() + SSO_TICKET_TTL_MS),
      }),
    );
    return raw;
  }

  // 用一次性 ticket 兑换本地会话（access + refresh）。原子占用，防并发重放。
  async exchangeSsoTicket(rawTicket: string) {
    if (!rawTicket) throw new UnauthorizedException("Invalid SSO ticket");
    const row = await this.ssoTickets.findOne({
      where: { ticketHash: this.hashToken(rawTicket) },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invalid SSO ticket");
    }
    const claimed = await this.ssoTickets.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!claimed.affected)
      throw new UnauthorizedException("Invalid SSO ticket");
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException("Invalid SSO ticket");
    }
    return this.session(user);
  }

  async validateUser(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      participantId: user.participantId,
      role: user.participantRole,
    };
  }

  // login/register response: user identity + short-lived access token + refresh token.
  private async session(user: User) {
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        participantId: user.participantId,
        role: user.participantRole,
      },
      access_token: this.generateAccessToken(user),
      refresh_token: await this.issueRefreshToken(user.id),
    };
  }

  private generateAccessToken(user: User): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        participantId: user.participantId,
        role: user.participantRole,
        tenantId: DEFAULT_TENANT_ID,
      },
      {
        secret: getJwtSecret(),
        expiresIn: this.configService.get("JWT_EXPIRES_IN") || "15m",
      },
    );
  }

  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private async issueRefreshToken(userId: number): Promise<string> {
    const raw = randomBytes(48).toString("hex");
    await this.refreshTokens.save(
      this.refreshTokens.create({
        tokenHash: this.hashToken(raw),
        userId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        revoked: false,
      }),
    );
    return raw;
  }
}
