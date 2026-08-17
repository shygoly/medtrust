import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { User, RefreshToken, SsoTicket } from "@medtrust/database";
import { AuthService } from "./auth.service";

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
  const jwtService = { sign: jest.fn(() => "jwt-token") };
  const configService = { get: jest.fn(() => "15m") };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: getRepositoryToken(SsoTicket), useValue: ssoTickets },
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
    expect(ssoTickets.update).toHaveBeenCalled();
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
  });
});
