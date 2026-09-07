import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
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

    const result = await service.updateUser(7, {
      participantRole: "provider",
      participantId: "p-huashan",
    });

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

    await service.updateUser(7, { status: "disabled" });

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
      service.updateUser(999, { status: "disabled" }),
    ).rejects.toThrow(NotFoundException);
  });
});
