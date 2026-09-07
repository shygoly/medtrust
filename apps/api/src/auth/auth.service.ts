import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { createHash, randomBytes, randomInt } from "crypto";
import * as bcrypt from "bcryptjs";
import {
  User,
  RefreshToken,
  SsoTicket,
  VerificationCode,
  OrgCertificationApplication,
} from "@medtrust/database";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { MailService } from "./mail.service";
import { SmsService } from "./sms.service";
import { TotpService } from "./totp.service";
import { getJwtSecret } from "./jwt-secret.util";
import { DEFAULT_TENANT_ID } from "./auth.constants";

const REFRESH_TTL_MS =
  (Number(process.env.REFRESH_EXPIRES_DAYS) || 7) * 86_400_000;
const RESET_CODE_TTL_MS = 10 * 60_000; // P0-6:10 分钟有效
const RESET_CODE_PURPOSE = "reset_password";

// P1-2 手机快捷登录:验证码 5min 有效、60s 重发间隔、5 次错误作废。
const SMS_CODE_TTL_MS = 5 * 60_000;
const SMS_CODE_PURPOSE = "sms_login";
const SMS_RESET_PURPOSE = "sms_reset";
const SMS_RESEND_MS = 60_000;
const SMS_MAX_ATTEMPTS = 5;

// P0-4 登录防爆破:同账号连续失败 5 次锁定 15 分钟。
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;

// P2-1 CA 证书登录:挑战 5min 有效。内存挑战表(多实例部署需换共享存储)。
const CA_CHALLENGE_TTL_MS = 5 * 60_000;

@Injectable()
export class AuthService implements OnModuleInit {
  // P2-1:CA 登录挑战(内存态,多实例部署需换共享存储,见整改计划 P2-1)。
  private readonly caChallenges = new Map<
    string,
    { userId: number; challenge: string; expiresAt: number }
  >();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    private smsService: SmsService,
    private readonly totp: TotpService,
    private readonly gm: GMCryptoService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(SsoTicket)
    private readonly ssoTickets: Repository<SsoTicket>,
    @InjectRepository(VerificationCode)
    private readonly verificationCodes: Repository<VerificationCode>,
    @InjectRepository(OrgCertificationApplication, "controlplane")
    private readonly orgCerts: Repository<OrgCertificationApplication>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.shouldSeedDemoUsers()) {
      await this.initDemoUsers();
    }
  }

  // POC 后门关闭(P0-1):生产环境默认不播种演示账号,仅显式
  // SEED_DEMO_USERS=true 时执行;开发/测试保持原行为(默认播种)。
  private shouldSeedDemoUsers(): boolean {
    const flag = process.env.SEED_DEMO_USERS?.trim().toLowerCase();
    if (flag === "true") return true;
    if (flag === "false") return false;
    return process.env.NODE_ENV !== "production";
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
        status: "active",
        lastPasswordChangedAt: new Date(),
      }),
    );
    return this.session(user);
  }

  async login(loginDto: LoginDto) {
    const { account, password } = loginDto;
    // L-3:账号不限于邮箱——支持邮箱或已绑定手机号。
    const user = await this.users.findOne({
      where: [{ email: account }, { phone: account }],
    });
    if (!user) {
      throw new UnauthorizedException("账号或密码错误");
    }

    // P0-4:命中锁定时直接拒绝,不校验密码也不重置计数。
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException("账号已锁定,请 15 分钟后再试");
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      await this.registerLoginFailure(user);
      throw new UnauthorizedException("账号或密码错误");
    }

    this.assertAccountUsable(user);

    // P2-4:启用 MFA 的账号必须校验 6 位 TOTP,否则拒绝签发会话。
    if (user.mfaEnabled) {
      const code = (loginDto.mfaCode || "").trim();
      if (!user.mfaSecret || !this.totp.verify(user.mfaSecret, code)) {
        throw new UnauthorizedException("MFA 验证码错误或已过期");
      }
    }

    // 登录成功:清零失败计数与锁定。
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return this.session(user);
  }

  // P0-4:连续失败计数;达到阈值锁定 15 分钟。失败计数不清零,
  // 用户即使拿到正确密码也需等锁定窗口过后(或由运营/重置密码解锁)。
  private async registerLoginFailure(user: User): Promise<void> {
    user.failedLoginCount = (user.failedLoginCount || 0) + 1;
    if (user.failedLoginCount >= LOGIN_MAX_FAILURES) {
      user.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
    }
    await this.users.save(user);
  }

  // P0-2:统一账号可用性校验(软删除/运营禁用)。pending 用户允许登录,
  // 由前端 AuthGate 引导完善机构认证。
  private assertAccountUsable(user: User): void {
    if (user.deletedAt) {
      throw new UnauthorizedException("账号已注销");
    }
    if (user.status === "disabled") {
      throw new UnauthorizedException("账号已被禁用,请联系运营方");
    }
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
    this.assertAccountUsable(user);
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
    const ttlMs =
      Number(this.configService.get("XIAN_LOGIN_TICKET_TTL_MS")) || 60_000;
    await this.ssoTickets.save(
      this.ssoTickets.create({
        ticketHash: this.hashToken(raw),
        userId,
        expiresAt: new Date(Date.now() + ttlMs),
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
    if (!user) throw new UnauthorizedException("Invalid SSO ticket");
    this.assertAccountUsable(user);
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

  // P0-6:发送密码重置验证码。无论邮箱是否存在都返回 ok(防账号枚举);
  // 验证码只存哈希,一次性,10min 有效。
  async sendPasswordResetCode(email: string): Promise<void> {
    const user = await this.users.findOne({ where: { email } });
    // 静默吞掉,不泄露账号是否存在;禁用/注销账号同样不发码。
    if (!user || user.deletedAt || user.status === "disabled") return;

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.verificationCodes.save(
      this.verificationCodes.create({
        target: email,
        purpose: RESET_CODE_PURPOSE,
        codeHash: this.hashToken(code),
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      }),
    );
    await this.mailService.sendPasswordResetCode(email, code);
  }

  // P0-6:校验验证码并重置密码。成功后退还所有 refresh token。
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const codeOk = await this.consumeVerificationCode(
      email,
      RESET_CODE_PURPOSE,
      code,
    );
    if (!codeOk) throw new UnauthorizedException("验证码错误或已过期");

    const user = await this.users.findOne({ where: { email } });
    if (!user || user.deletedAt || user.status === "disabled") {
      throw new UnauthorizedException("账号不存在或已停用");
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.lastPasswordChangedAt = new Date();
    // 重置密码即解锁(运营解锁/自助找回)。
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    // 重置密码后旧 refresh token 全部作废(access token 由短 TTL 兜底)。
    await this.refreshTokens.update(
      { userId: user.id, revoked: false },
      { revoked: true },
    );
  }

  // P1-2:发送手机登录验证码。60s 重发间隔;答案只存哈希;短信抽象由 SmsService 提供。
  async sendSmsLoginCode(phone: string): Promise<void> {
    const latest = await this.verificationCodes.findOne({
      where: { target: phone, purpose: SMS_CODE_PURPOSE, usedAt: IsNull() },
      order: { createdAt: "DESC" },
    });
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < SMS_RESEND_MS
    ) {
      throw new BadRequestException("发送太频繁,请 60 秒后再试");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.verificationCodes.save(
      this.verificationCodes.create({
        target: phone,
        purpose: SMS_CODE_PURPOSE,
        codeHash: this.hashToken(code),
        expiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
        attempts: 0,
      }),
    );
    await this.smsService.sendLoginCode(phone, code);
  }

  // P1-2:验证码登录;未注册手机号首次登录自动建 pending 账号(无角色,
  // 由前端 AuthGate 引导完善机构认证)。
  async loginWithSmsCode(phone: string, code: string) {
    const codeOk = await this.consumeVerificationCode(
      phone,
      SMS_CODE_PURPOSE,
      code,
    );
    if (!codeOk) throw new UnauthorizedException("验证码错误或已过期");

    let user = await this.users.findOne({ where: { phone } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          email: `sms-${phone}@medtrust.local`,
          phone,
          name: `用户${phone.slice(-4)}`,
          passwordHash: await bcrypt.hash(randomBytes(16).toString("hex"), 10),
          status: "pending",
        }),
      );
    }
    this.assertAccountUsable(user);
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return this.session(user);
  }

  // P1-8:发送手机找回密码验证码。无论手机号是否注册都返回 ok(防枚举);
  // 60s 重发间隔;验证码只存哈希。
  async sendSmsPasswordResetCode(phone: string): Promise<void> {
    const user = await this.users.findOne({ where: { phone } });
    if (!user || user.deletedAt || user.status === "disabled") return;

    const latest = await this.verificationCodes.findOne({
      where: { target: phone, purpose: SMS_RESET_PURPOSE, usedAt: IsNull() },
      order: { createdAt: "DESC" },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < SMS_RESEND_MS) {
      throw new BadRequestException("发送太频繁,请 60 秒后再试");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.verificationCodes.save(
      this.verificationCodes.create({
        target: phone,
        purpose: SMS_RESET_PURPOSE,
        codeHash: this.hashToken(code),
        expiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
        attempts: 0,
      }),
    );
    await this.smsService.sendPasswordResetCode(phone, code);
  }

  // P1-8:手机验证码重置密码。
  async resetPasswordByPhone(
    phone: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const codeOk = await this.consumeVerificationCode(
      phone,
      SMS_RESET_PURPOSE,
      code,
    );
    if (!codeOk) throw new UnauthorizedException("验证码错误或已过期");

    const user = await this.users.findOne({ where: { phone } });
    if (!user || user.deletedAt || user.status === "disabled") {
      throw new UnauthorizedException("账号不存在或已停用");
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.lastPasswordChangedAt = new Date();
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    await this.refreshTokens.update(
      { userId: user.id, revoked: false },
      { revoked: true },
    );
  }

  // P2-1:CA 证书登录第一步——为账号生成随机挑战。挑战 5min 有效;
  // 客户端本地 SM2 私钥对挑战签名,平台用其 CA 凭证公钥验签。
  async createCaChallenge(account: string) {
    const user = await this.users.findOne({
      where: [{ email: account }, { phone: account }],
    });
    if (!user) throw new UnauthorizedException("账号或密码错误");
    this.assertAccountUsable(user);

    const challengeId = randomBytes(24).toString("hex");
    const challenge = randomBytes(32).toString("hex");
    this.caChallenges.set(challengeId, {
      userId: user.id,
      challenge,
      expiresAt: Date.now() + CA_CHALLENGE_TTL_MS,
    });
    return {
      challengeId,
      challenge,
      expiresInSeconds: Math.floor(CA_CHALLENGE_TTL_MS / 1000),
    };
  }

  // P2-1:CA 证书登录第二步——验签。私钥永不上传;平台只验签并检查吊销。
  async loginWithCa(account: string, challengeId: string, signature: string) {
    const pending = this.caChallenges.get(challengeId);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new UnauthorizedException("登录挑战已过期,请重新获取");
    }
    this.caChallenges.delete(challengeId); // 一次性,防重放

    const user = await this.users.findOne({
      where: [{ email: account }, { phone: account }],
    });
    if (!user || user.id !== pending.userId) {
      throw new UnauthorizedException("账号与挑战不匹配");
    }
    this.assertAccountUsable(user);

    const app = await this.orgCerts.findOne({ where: { userId: user.id } });
    if (!app?.caCertFingerprint || !app.caPublicKey) {
      throw new UnauthorizedException("该账号未生成 CA 身份凭证,请先在用户中心完成机构认证");
    }

    const ok = this.gm.sm2Verify(
      pending.challenge,
      signature,
      app.caPublicKey,
    );
    if (!ok) throw new UnauthorizedException("签名验证失败");

    user.lastLoginAt = new Date();
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    return this.session(user);
  }

  // P2-4:发起 MFA 绑定——生成 TOTP 密钥与 otpauth URL,暂不启用。
  async setupMfa(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (user.mfaEnabled) throw new UnauthorizedException("MFA 已启用");
    const secret = this.totp.generateSecret();
    user.mfaSecret = secret;
    await this.users.save(user);
    return {
      secret,
      otpauthUrl: this.totp.otpauthUrl(secret, user.email),
    };
  }

  // P2-4:校验 TOTP 后启用 MFA。
  async enableMfa(userId: number, code: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (!user.mfaSecret) throw new UnauthorizedException("请先发起 MFA 绑定");
    if (!this.totp.verify(user.mfaSecret, code)) {
      throw new UnauthorizedException("验证码错误,请确认客户端时间同步");
    }
    user.mfaEnabled = true;
    await this.users.save(user);
    return { ok: true };
  }

  // P2-4:禁用 MFA(需校验当前 TOTP)。
  async disableMfa(userId: number, code: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    if (!user.mfaEnabled) throw new UnauthorizedException("MFA 未启用");
    if (!user.mfaSecret || !this.totp.verify(user.mfaSecret, code)) {
      throw new UnauthorizedException("验证码错误,请确认客户端时间同步");
    }
    user.mfaEnabled = false;
    user.mfaSecret = null;
    await this.users.save(user);
    return { ok: true };
  }

  // 原子占用验证码:答案正确才置 used_at,用 usedAt IS NULL 抢占防重放。
  // 错误尝试累计 5 次即作废(P1-2);答案正确才消耗。
  private async consumeVerificationCode(
    target: string,
    purpose: string,
    code: string,
  ): Promise<boolean> {
    if (!target || !purpose || !code) return false;
    const row = await this.verificationCodes.findOne({
      where: { target, purpose, usedAt: IsNull() },
      order: { createdAt: "DESC" },
    });
    if (!row || row.expiresAt.getTime() < Date.now()) return false;
    if (row.attempts >= SMS_MAX_ATTEMPTS) {
      await this.verificationCodes.update(
        { id: row.id },
        { usedAt: new Date() },
      );
      return false;
    }
    if (row.codeHash !== this.hashToken(code.trim())) {
      const attempts = row.attempts + 1;
      await this.verificationCodes.update(
        { id: row.id },
        attempts >= SMS_MAX_ATTEMPTS
          ? { attempts, usedAt: new Date() }
          : { attempts },
      );
      return false;
    }
    const claimed = await this.verificationCodes.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    return claimed.affected === 1;
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
