import {
  AdminRoleError,
  applyAdminRole,
  parseAdminRoleArgs,
} from "./admin-role";

describe("admin-role (D-ID-3 服务器侧授予 / 撤销)", () => {
  const users = { findOne: jest.fn(), save: jest.fn() };
  const refreshTokens = { update: jest.fn() };
  const repos = { users, refreshTokens } as any;
  const account = (over: Record<string, unknown> = {}) => ({
    id: 9,
    email: "ops@example.com",
    participantRole: "operator",
    status: "active",
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    users.save.mockImplementation(async (v) => v);
    refreshTokens.update.mockResolvedValue({ affected: 2 });
  });

  describe("parseAdminRoleArgs", () => {
    it("parses grant and revoke", () => {
      expect(parseAdminRoleArgs(["grant", "a@b.com"])).toEqual({
        action: "grant",
        email: "a@b.com",
      });
      expect(
        parseAdminRoleArgs(["revoke", "a@b.com", "--role=operator"]),
      ).toEqual({ action: "revoke", email: "a@b.com", role: "operator" });
    });

    it.each([
      [[]],
      [["grant"]],
      [["grant", "not-an-email"]],
      [["grant", "a@b.com", "--role=operator"]],
      [["revoke", "a@b.com"]],
      [["revoke", "a@b.com", "--role=admin"]],
      [["revoke", "a@b.com", "--role=root"]],
      [["promote", "a@b.com"]],
    ])("rejects %j", (argv) => {
      expect(() => parseAdminRoleArgs(argv)).toThrow(AdminRoleError);
    });
  });

  it("grant sets admin, revokes refresh tokens and reports the previous role", async () => {
    const user = account();
    users.findOne.mockResolvedValue(user);
    const result = await applyAdminRole(repos, {
      action: "grant",
      email: "ops@example.com",
    });
    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: "ops@example.com" },
    });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ participantRole: "admin", status: "active" }),
    );
    expect(refreshTokens.update).toHaveBeenCalledWith(
      { userId: 9, revoked: false },
      { revoked: true },
    );
    expect(result).toEqual({
      action: "grant",
      userId: 9,
      email: "ops@example.com",
      previousRole: "operator",
      role: "admin",
      revokedRefreshTokens: 2,
    });
  });

  it("grant lifts a pending account without a role to active", async () => {
    users.findOne.mockResolvedValue(
      account({ participantRole: null, status: "pending" }),
    );
    const result = await applyAdminRole(repos, {
      action: "grant",
      email: "ops@example.com",
    });
    expect(result.previousRole).toBeNull();
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ participantRole: "admin", status: "active" }),
    );
  });

  it.each([
    ["missing user", null],
    ["disabled account", account({ status: "disabled" })],
    ["already admin", account({ participantRole: "admin" })],
  ])("grant refuses: %s", async (_label, found) => {
    users.findOne.mockResolvedValue(found);
    await expect(
      applyAdminRole(repos, { action: "grant", email: "ops@example.com" }),
    ).rejects.toThrow(AdminRoleError);
    expect(users.save).not.toHaveBeenCalled();
    expect(refreshTokens.update).not.toHaveBeenCalled();
  });

  it("revoke moves an admin to the given role and revokes refresh tokens", async () => {
    users.findOne.mockResolvedValue(account({ participantRole: "admin" }));
    const result = await applyAdminRole(repos, {
      action: "revoke",
      email: "ops@example.com",
      role: "compliance",
    });
    expect(result).toMatchObject({
      action: "revoke",
      previousRole: "admin",
      role: "compliance",
    });
    expect(refreshTokens.update).toHaveBeenCalled();
  });

  it.each([
    ["missing user", null],
    ["not an admin", account({ participantRole: "operator" })],
  ])("revoke refuses: %s", async (_label, found) => {
    users.findOne.mockResolvedValue(found);
    await expect(
      applyAdminRole(repos, {
        action: "revoke",
        email: "ops@example.com",
        role: "operator",
      }),
    ).rejects.toThrow(AdminRoleError);
    expect(users.save).not.toHaveBeenCalled();
    expect(refreshTokens.update).not.toHaveBeenCalled();
  });
});
