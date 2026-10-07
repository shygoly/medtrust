import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { RefreshToken, User } from "@medtrust/database";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  let service: AdminService;
  const users = {
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const refreshTokens = {
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  it("updateUser assigns role and lifts pending users to active", async () => {
    const user = {
      id: 7,
      email: "u@example.com",
      name: "张三",
      participantId: null,
      participantRole: null,
      status: "pending",
    };
    users.findOne.mockResolvedValue(user);
    users.save.mockImplementation(async (v) => v);

    const result = await service.updateUser(
      7,
      { participantRole: "provider", participantId: "p-huashan" },
      1,
    );

    expect(result.participantRole).toBe("provider");
    expect(result.status).toBe("active");
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        participantRole: "provider",
        participantId: "p-huashan",
        status: "active",
      }),
    );
  });

  it("updateUser disabling a user revokes all refresh tokens", async () => {
    const user = {
      id: 7,
      email: "u@example.com",
      name: "张三",
      participantId: "p-huashan",
      participantRole: "provider",
      status: "active",
    };
    users.findOne.mockResolvedValue(user);
    users.save.mockImplementation(async (v) => v);
    refreshTokens.update.mockResolvedValue({ affected: 3 });

    await service.updateUser(7, { status: "disabled" }, 1);

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disabled" }),
    );
    expect(refreshTokens.update).toHaveBeenCalledWith(
      { userId: 7, revoked: false },
      { revoked: true },
    );
  });

  it("resetPassword hashes, unlocks and revokes refresh tokens", async () => {
    const user = {
      id: 7,
      email: "u@example.com",
      passwordHash: "old-hash",
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 60_000),
      lastPasswordChangedAt: null,
    };
    users.findOne.mockResolvedValue(user);
    users.save.mockImplementation(async (v) => v);
    refreshTokens.update.mockResolvedValue({ affected: 1 });

    await service.resetPassword(7, "Abc12345!");

    const saved = users.save.mock.calls[0][0];
    expect(saved.passwordHash).not.toBe("old-hash");
    expect(saved.failedLoginCount).toBe(0);
    expect(saved.lockedUntil).toBeNull();
    expect(saved.lastPasswordChangedAt).toBeInstanceOf(Date);
    expect(refreshTokens.update).toHaveBeenCalledWith(
      { userId: 7, revoked: false },
      { revoked: true },
    );
  });

  it("updateUser throws NotFound for missing users", async () => {
    users.findOne.mockResolvedValue(null);
    await expect(
      service.updateUser(999, { status: "disabled" }, 1),
    ).rejects.toThrow(NotFoundException);
  });

  // ── D-ID-3:平台管理员只能在服务器侧授予与管理 ──────────────────────────
  const account = (over: Record<string, unknown> = {}) => ({
    id: 7,
    email: "u@example.com",
    name: "张三",
    participantId: "p-huashan",
    participantRole: "provider",
    status: "active",
    passwordHash: "old-hash",
    ...over,
  });

  it("updateUser refuses to grant the admin role", async () => {
    users.findOne.mockResolvedValue(account());
    await expect(
      service.updateUser(7, { participantRole: "admin" }, 1),
    ).rejects.toThrow(ForbiddenException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("updateUser refuses to grant admin even to the caller", async () => {
    users.findOne.mockResolvedValue(
      account({ id: 1, participantRole: "operator" }),
    );
    await expect(
      service.updateUser(1, { participantRole: "admin" }, 1),
    ).rejects.toThrow(ForbiddenException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it.each([
    ["demote", { participantRole: "provider" as const }],
    ["disable", { status: "disabled" as const }],
    ["rename", { name: "改名" }],
    ["rebind participant", { participantId: "p-other" }],
  ])("updateUser refuses to %s an admin account", async (_label, dto) => {
    users.findOne.mockResolvedValue(account({ participantRole: "admin" }));
    await expect(service.updateUser(7, dto, 1)).rejects.toThrow(
      ForbiddenException,
    );
    expect(users.save).not.toHaveBeenCalled();
    expect(refreshTokens.update).not.toHaveBeenCalled();
  });

  it("resetPassword refuses to touch an admin account", async () => {
    users.findOne.mockResolvedValue(account({ participantRole: "admin" }));
    await expect(service.resetPassword(7, "Abc12345!")).rejects.toThrow(
      ForbiddenException,
    );
    expect(users.save).not.toHaveBeenCalled();
    expect(refreshTokens.update).not.toHaveBeenCalled();
  });

  it("updateUser refuses to change the caller's own role", async () => {
    users.findOne.mockResolvedValue(
      account({ id: 1, participantRole: "operator" }),
    );
    await expect(
      service.updateUser(1, { participantRole: "compliance" }, 1),
    ).rejects.toThrow(ForbiddenException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("updateUser still lets the caller edit their own non-role fields", async () => {
    users.findOne.mockResolvedValue(
      account({ id: 1, participantRole: "operator" }),
    );
    users.save.mockImplementation(async (v) => v);
    const result = await service.updateUser(
      1,
      { name: "新名字", participantRole: "operator" },
      1,
    );
    expect(result.name).toBe("新名字");
    expect(result.participantRole).toBe("operator");
  });

  it("updateUser still assigns the four business roles to other users", async () => {
    users.save.mockImplementation(async (v) => v);
    for (const role of [
      "provider",
      "consumer",
      "operator",
      "compliance",
    ] as const) {
      users.findOne.mockResolvedValue(account({ participantRole: null }));
      const result = await service.updateUser(7, { participantRole: role }, 1);
      expect(result.participantRole).toBe(role);
    }
  });
});
