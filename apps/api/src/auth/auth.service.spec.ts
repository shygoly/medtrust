import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { createHash } from "crypto";
import * as bcrypt from "bcryptjs";
import {
  User,
  RefreshToken,
  SsoTicket,
  VerificationCode,
  OrgCertificationApplication,
} from "@medtrust/database";
import { IsNull } from "typeorm";
import { AuthService } from "./auth.service";
import { MailService } from "./mail.service";
import { SmsService } from "./sms.service";
import { TotpService } from "./totp.service";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";

describe("AuthService SSO tickets", () => {
  let service: AuthService;
  const users = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const refreshTokens = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };
  const ssoTickets = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };
  const verificationCodes = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };
  const mailService = { sendPasswordResetCode: jest.fn() };
  const smsService = { sendLoginCode: jest.fn(), sendPasswordResetCode: jest.fn() };
  const gmService = { sm2Verify: jest.fn(() => true) };
  const totpService = { verify: jest.fn(() => true) };
  const orgCerts = {
    findOne: jest.fn(),
  };
  const jwtService = { sign: jest.fn(() => "jwt-token") };
  const configService = { get: jest.fn(() => "15m") };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: MailService, useValue: mailService },
        { provide: SmsService, useValue: smsService },
        { provide: TotpService, useValue: totpService },
        { provide: GMCryptoService, useValue: gmService },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: getRepositoryToken(SsoTicket), useValue: ssoTickets },
        {
          provide: getRepositoryToken(VerificationCode),
          useValue: verificationCodes,
        },
        {
          provide: getRepositoryToken(OrgCertificationApplication, "controlplane"),
          useValue: orgCerts,
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it("createSsoTicket stores hash and returns raw ticket", async () => {
    ssoTickets.save.mockResolvedValue(undefined);
    const raw = await service.createSsoTicket(7);
    expect(raw).toBeTruthy();
    expect(ssoTickets.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
    );
    const saved = ssoTickets.save.mock.calls[0][0];
    expect(saved.ticketHash).not.toBe(raw);
  });

  it("createSsoTicket treats XIAN_LOGIN_TICKET_TTL_MS as milliseconds", async () => {
    (configService.get as jest.Mock).mockReturnValueOnce(60000);
    ssoTickets.save.mockResolvedValue(undefined);
    const before = Date.now();
    await service.createSsoTicket(7);
    const saved = ssoTickets.save.mock.calls[0][0];
    const expiresIn = saved.expiresAt.getTime() - before;
    expect(expiresIn).toBeGreaterThan(60_000 - 2_000);
    expect(expiresIn).toBeLessThan(60_000 + 2_000);
    expect(expiresIn).toBeLessThan(10 * 60_000);
  });

  it("createSsoTicket falls back to 60s when XIAN_LOGIN_TICKET_TTL_MS is non-numeric", async () => {
    (configService.get as jest.Mock).mockReturnValueOnce("abc");
    ssoTickets.save.mockResolvedValue(undefined);
    const before = Date.now();
    await service.createSsoTicket(7);
    const saved = ssoTickets.save.mock.calls[0][0];
    expect(saved.expiresAt.getTime()).toBeGreaterThan(before + 60_000 - 2_000);
    expect(saved.expiresAt.getTime()).toBeLessThan(before + 60_000 + 2_000);
  });

  it("exchangeSsoTicket returns session for valid ticket", async () => {
    const now = Date.now();
    ssoTickets.findOne.mockResolvedValue({
      id: "t1",
      userId: 7,
      usedAt: null,
      expiresAt: new Date(now + 60_000),
    });
    ssoTickets.update.mockResolvedValue({ affected: 1 });
    users.findOne.mockResolvedValue({
      id: 7,
      email: "xian@example.com",
      name: "雷军",
      participantId: "xian-40044",
      participantRole: "consumer",
      deletedAt: null,
    });
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const session = await service.exchangeSsoTicket("raw-ticket");
    expect(session.access_token).toBe("jwt-token");
    expect(session.user.email).toBe("xian@example.com");
    expect(ssoTickets.update).toHaveBeenCalledWith(
      { id: "t1", usedAt: IsNull() },
      { usedAt: expect.any(Date) },
    );
  });

  it("exchangeSsoTicket rejects replayed ticket when atomic claim affects 0 rows", async () => {
    ssoTickets.findOne.mockResolvedValue({
      id: "t1",
      userId: 7,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    ssoTickets.update.mockResolvedValue({ affected: 0 });
    await expect(service.exchangeSsoTicket("raw-ticket")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("exchangeSsoTicket rejects expired ticket", async () => {
    ssoTickets.findOne.mockResolvedValue({
      id: "t1",
      userId: 7,
      usedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(service.exchangeSsoTicket("raw-ticket")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(ssoTickets.update).not.toHaveBeenCalled();
  });

  it("exchangeSsoTicket rejects used ticket", async () => {
    ssoTickets.findOne.mockResolvedValue({
      id: "t1",
      userId: 7,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.exchangeSsoTicket("raw-ticket")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(ssoTickets.update).not.toHaveBeenCalled();
  });

  it("sendPasswordResetCode stores only the code hash and emails the code", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      deletedAt: null,
    });
    verificationCodes.save.mockResolvedValue(undefined);
    verificationCodes.create.mockImplementation((v) => v);

    await service.sendPasswordResetCode("user@example.com");

    const saved = verificationCodes.save.mock.calls[0][0];
    expect(saved.target).toBe("user@example.com");
    expect(saved.purpose).toBe("reset_password");
    expect(saved.codeHash).not.toBe("123456"); // 不存明文
    expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mailService.sendPasswordResetCode).toHaveBeenCalledWith(
      "user@example.com",
      expect.any(String),
    );
  });

  it("sendPasswordResetCode silently no-ops for unknown users", async () => {
    users.findOne.mockResolvedValue(null);
    await service.sendPasswordResetCode("ghost@example.com");
    expect(verificationCodes.save).not.toHaveBeenCalled();
    expect(mailService.sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it("resetPassword revokes all refresh tokens after resetting", async () => {
    verificationCodes.findOne.mockResolvedValue({
      id: "vc-1",
      target: "user@example.com",
      purpose: "reset_password",
      codeHash: createHash("sha256").update("123456").digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    verificationCodes.update.mockResolvedValue({ affected: 1 });
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      deletedAt: null,
    });
    users.save.mockResolvedValue(undefined);
    refreshTokens.update.mockResolvedValue({ affected: 2 });

    await service.resetPassword("user@example.com", "123456", "Abc12345!");

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
    );
    expect(refreshTokens.update).toHaveBeenCalledWith(
      { userId: 7, revoked: false },
      { revoked: true },
    );
  });

  it("login rejects disabled users even with correct password", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: null,
      status: "disabled",
      failedLoginCount: 0,
      lockedUntil: null,
    });

    await expect(
      service.login({ account: "user@example.com", password: "Abc12345!" }),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("login rejects deleted users even with correct password", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: new Date(),
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
    });

    await expect(
      service.login({ account: "user@example.com", password: "Abc12345!" }),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("login locks the account after 5 consecutive failures", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: null,
      status: "active",
      failedLoginCount: 4,
      lockedUntil: null,
    });
    users.save.mockImplementation(async (v) => v);

    await expect(
      service.login({ account: "user@example.com", password: "wrong-pass" }),
    ).rejects.toThrow(UnauthorizedException);

    const saved = users.save.mock.calls[0][0];
    expect(saved.failedLoginCount).toBe(5);
    expect(saved.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("login rejects correct password while locked", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: null,
      status: "active",
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.login({ account: "user@example.com", password: "Abc12345!" }),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("login resets failure count and lock on success", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: null,
      status: "active",
      failedLoginCount: 3,
      lockedUntil: null,
      lastLoginAt: null,
    });
    users.save.mockImplementation(async (v) => v);
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const session = await service.login({
      account: "user@example.com",
      password: "Abc12345!",
    });

    expect(session.access_token).toBe("jwt-token");
    const saved = users.save.mock.calls[0][0];
    expect(saved.failedLoginCount).toBe(0);
    expect(saved.lockedUntil).toBeNull();
    expect(saved.lastLoginAt).toBeInstanceOf(Date);
  });

  it("sendSmsLoginCode stores hashed code and delegates to SmsService", async () => {
    verificationCodes.findOne.mockResolvedValue(null);
    verificationCodes.save.mockResolvedValue(undefined);
    verificationCodes.create.mockImplementation((v) => v);

    await service.sendSmsLoginCode("13800138000");

    const saved = verificationCodes.save.mock.calls[0][0];
    expect(saved.target).toBe("13800138000");
    expect(saved.purpose).toBe("sms_login");
    expect(saved.codeHash).not.toBe("123456");
    expect(smsService.sendLoginCode).toHaveBeenCalledWith(
      "13800138000",
      expect.any(String),
    );
  });

  it("sendSmsLoginCode enforces 60s resend cooldown", async () => {
    verificationCodes.findOne.mockResolvedValue({
      id: "vc-1",
      createdAt: new Date(),
      usedAt: null,
    });

    await expect(service.sendSmsLoginCode("13800138000")).rejects.toThrow(
      "发送太频繁",
    );
    expect(verificationCodes.save).not.toHaveBeenCalled();
  });

  it("loginWithSmsCode auto-creates pending user for new phone", async () => {
    verificationCodes.findOne.mockResolvedValue({
      id: "vc-1",
      target: "13800138000",
      purpose: "sms_login",
      codeHash: createHash("sha256").update("123456").digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      attempts: 0,
    });
    verificationCodes.update.mockResolvedValue({ affected: 1 });
    users.findOne.mockResolvedValue(null);
    users.save.mockImplementation(async (v) => v);
    users.create.mockImplementation((v) => v);
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const session = await service.loginWithSmsCode("13800138000", "123456");

    expect(session.access_token).toBe("jwt-token");
    const created = users.create.mock.calls[0][0];
    expect(created.phone).toBe("13800138000");
    expect(created.status).toBe("pending");
    expect(created.email).toContain("13800138000");
  });

  it("loginWithSmsCode rejects wrong code and increments attempts", async () => {
    verificationCodes.findOne.mockResolvedValue({
      id: "vc-1",
      target: "13800138000",
      purpose: "sms_login",
      codeHash: createHash("sha256").update("999999").digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      attempts: 0,
    });
    verificationCodes.update.mockResolvedValue({ affected: 1 });

    await expect(
      service.loginWithSmsCode("13800138000", "123456"),
    ).rejects.toThrow(UnauthorizedException);
    expect(verificationCodes.update).toHaveBeenCalledWith(
      { id: "vc-1" },
      { attempts: 1 },
    );
  });

  it("sendSmsPasswordResetCode stores hashed code and delegates to SmsService", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      phone: "13800138000",
      deletedAt: null,
      status: "active",
    });
    verificationCodes.findOne.mockResolvedValue(null);
    verificationCodes.save.mockResolvedValue(undefined);
    verificationCodes.create.mockImplementation((v) => v);

    await service.sendSmsPasswordResetCode("13800138000");

    const saved = verificationCodes.save.mock.calls[0][0];
    expect(saved.purpose).toBe("sms_reset");
    expect(saved.codeHash).not.toBe("123456");
    expect(smsService.sendPasswordResetCode).toHaveBeenCalledWith(
      "13800138000",
      expect.any(String),
    );
  });

  it("resetPasswordByPhone resets password and revokes refresh tokens", async () => {
    verificationCodes.findOne.mockResolvedValue({
      id: "vc-1",
      target: "13800138000",
      purpose: "sms_reset",
      codeHash: createHash("sha256").update("123456").digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      attempts: 0,
    });
    verificationCodes.update.mockResolvedValue({ affected: 1 });
    users.findOne.mockResolvedValue({
      id: 7,
      email: "sms-13800138000@medtrust.local",
      phone: "13800138000",
      deletedAt: null,
      status: "active",
    });
    users.save.mockImplementation(async (v) => v);
    refreshTokens.update.mockResolvedValue({ affected: 2 });

    await service.resetPasswordByPhone(
      "13800138000",
      "123456",
      "Abc12345!",
    );

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "13800138000" }),
    );
    expect(refreshTokens.update).toHaveBeenCalledWith(
      { userId: 7, revoked: false },
      { revoked: true },
    );
  });

  it("createCaChallenge issues a one-time challenge for a usable account", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      deletedAt: null,
      status: "active",
    });

    const res = await service.createCaChallenge("user@example.com");

    expect(res.challengeId).toBeTruthy();
    expect(res.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(res.expiresInSeconds).toBe(300);
  });

  it("createCaChallenge rejects unknown accounts", async () => {
    users.findOne.mockResolvedValue(null);
    await expect(service.createCaChallenge("ghost@example.com")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("loginWithCa verifies signature and issues a session", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      deletedAt: null,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
    });
    orgCerts.findOne.mockResolvedValue({
      userId: 7,
      caCertFingerprint: "SM2:ABCD",
      caPublicKey: "04" + "a1".repeat(64),
    });
    gmService.sm2Verify.mockReturnValue(true);
    users.save.mockImplementation(async (v) => v);
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const challenge = await service.createCaChallenge("user@example.com");
    const session = await service.loginWithCa(
      "user@example.com",
      challenge.challengeId,
      "signature",
    );

    expect(session.access_token).toBe("jwt-token");
    expect(gmService.sm2Verify).toHaveBeenCalledWith(
      challenge.challenge,
      "signature",
      "04" + "a1".repeat(64),
    );
  });

  it("loginWithCa rejects when no CA credential exists", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      deletedAt: null,
      status: "active",
    });
    orgCerts.findOne.mockResolvedValue(null);

    const challenge = await service.createCaChallenge("user@example.com");
    await expect(
      service.loginWithCa("user@example.com", challenge.challengeId, "sig"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("loginWithCa rejects replay of the same challenge", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      deletedAt: null,
      status: "active",
    });
    orgCerts.findOne.mockResolvedValue({
      userId: 7,
      caCertFingerprint: "SM2:ABCD",
      caPublicKey: "04" + "a1".repeat(64),
    });
    gmService.sm2Verify.mockReturnValue(true);
    users.save.mockImplementation(async (v) => v);
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const challenge = await service.createCaChallenge("user@example.com");
    await service.loginWithCa(
      "user@example.com",
      challenge.challengeId,
      "sig",
    );
    await expect(
      service.loginWithCa("user@example.com", challenge.challengeId, "sig"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("login rejects missing/wrong MFA code for MFA-enabled users", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: null,
      status: "active",
      mfaEnabled: true,
      mfaSecret: "SECRET",
      failedLoginCount: 0,
      lockedUntil: null,
    });
    totpService.verify.mockReturnValue(false);

    await expect(
      service.login({ account: "user@example.com", password: "Abc12345!" }),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("login issues session when MFA code is valid", async () => {
    const passwordHash = await bcrypt.hash("Abc12345!", 10);
    users.findOne.mockResolvedValue({
      id: 7,
      email: "user@example.com",
      passwordHash,
      deletedAt: null,
      status: "active",
      mfaEnabled: true,
      mfaSecret: "SECRET",
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
    });
    totpService.verify.mockReturnValue(true);
    users.save.mockImplementation(async (v) => v);
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const session = await service.login({
      account: "user@example.com",
      password: "Abc12345!",
      mfaCode: "123456",
    });

    expect(session.access_token).toBe("jwt-token");
    expect(totpService.verify).toHaveBeenCalledWith("SECRET", "123456");
  });
});
