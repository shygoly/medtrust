import { ConfigService } from "@nestjs/config";
import { User, XianUserLink } from "@medtrust/database";
import * as bcrypt from "bcryptjs";
import { XianOpenApiService } from "./xian-open-api.service";
import { XianApiError } from "./xian-api-error";

jest.mock("bcryptjs", () => ({
  hash: jest.fn(async () => "hashed-password"),
}));

describe("XianOpenApiService", () => {
  let service: XianOpenApiService;
  let configGet: jest.Mock;
  let users: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let links: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let gm: {
    extractSm2PrivateKeyHexFromPkcs8: jest.Mock;
    sm2DecryptC1C2C3Base64: jest.Mock;
  };
  let auth: { createSsoTicket: jest.Mock };
  let hashSpy: jest.Mock;

  beforeEach(() => {
    configGet = jest.fn((key: string) => {
      if (key === "XIAN_SM2_PRIVATE_KEY_PKCS8_B64") return "pkcs8-b64";
      if (key === "XIAN_WEB_BASE_URL") return "http://web.test";
      if (key === "XIAN_TENANT_ROLE_MAP") return '{"t001":"provider"}';
      return undefined;
    });
    users = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    links = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    gm = {
      extractSm2PrivateKeyHexFromPkcs8: jest.fn(() => "private-key-hex"),
      sm2DecryptC1C2C3Base64: jest.fn((value: string) => {
        if (value === "enc-pw") return "plain-password";
        if (value === "enc-email") return "xian@example.com";
        return "";
      }),
    };
    auth = { createSsoTicket: jest.fn() };
    hashSpy = bcrypt.hash as unknown as jest.Mock;
    hashSpy.mockResolvedValue("hashed-password");
    hashSpy.mockClear();

    users.save.mockImplementation(async (u: any) => u);
    users.create.mockImplementation((dto: any) => ({ id: 1, ...dto }));
    links.save.mockImplementation(async (l: any) => l);
    links.create.mockImplementation((dto: any) => ({ id: 20, ...dto }));

    service = new XianOpenApiService(
      { get: configGet } as unknown as ConfigService,
      gm as any,
      auth as any,
      users as any,
      links as any,
    );
  });

  afterEach(() => {
    hashSpy.mockClear();
  });

  const syncBody = (overrides: Record<string, any> = {}) => ({
    requestId: "r1",
    tenantId: "t001",
    userId: "u001",
    userName: "张三",
    ...overrides,
  });

  it("userSync creates a user with synthetic email when email is empty, hashes password, and saves a link", async () => {
    links.findOne.mockResolvedValue(null);
    users.findOne.mockResolvedValue(null);

    const result = await service.userSync(
      syncBody({ password: "enc-pw" }),
    );

    expect(result).toEqual({ code: "SUCCESS", message: "user synchronized" });
    expect(gm.sm2DecryptC1C2C3Base64).toHaveBeenCalledWith(
      "enc-pw",
      "private-key-hex",
    );
    expect(bcrypt.hash).toHaveBeenCalledWith("plain-password", 10);
    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: "xian-t001-u001@xian-node.local" },
    });
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "xian-t001-u001@xian-node.local",
        name: "张三",
        passwordHash: "hashed-password",
        participantId: "xian-t001",
        participantRole: "provider",
      }),
    );
    expect(links.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t001",
        userId: "u001",
        localUserId: 1,
      }),
    );
  });

  it("userSync updates name and passwordHash for an existing linked user", async () => {
    links.findOne.mockResolvedValue({
      id: 10,
      tenantId: "t001",
      userId: "u001",
      localUserId: 7,
      enterpriseName: null,
      unifiedSocialCreditCode: null,
    });
    users.findOne.mockResolvedValue({
      id: 7,
      name: "旧名",
      email: "xian-t001-u001@xian-node.local",
      passwordHash: "old-hash",
      deletedAt: null,
    });

    const result = await service.userSync(
      syncBody({ userName: "新名", password: "enc-pw" }),
    );

    expect(result.code).toBe("SUCCESS");
    expect(bcrypt.hash).toHaveBeenCalledWith("plain-password", 10);
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        name: "新名",
        passwordHash: "hashed-password",
      }),
    );
    expect(links.save).not.toHaveBeenCalled();
  });

  it("userSync re-creates a missing local user and updates link.localUserId", async () => {
    const link = {
      id: 10,
      tenantId: "t001",
      userId: "u001",
      localUserId: 7,
      enterpriseName: null,
      unifiedSocialCreditCode: null,
    };
    links.findOne.mockResolvedValue(link);
    users.findOne.mockResolvedValue(null);
    users.create.mockImplementation((dto: any) => ({ id: 9, ...dto }));

    const result = await service.userSync(
      syncBody({ password: "enc-pw" }),
    );

    expect(result.code).toBe("SUCCESS");
    expect(users.findOne).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "xian-t001-u001@xian-node.local",
        name: "张三",
        passwordHash: "hashed-password",
        participantId: "xian-t001",
        participantRole: "provider",
      }),
    );
    expect(link.localUserId).toBe(9);
    expect(links.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, localUserId: 9 }),
    );
  });

  it("login throws XianApiError code INVALID_USER when no link exists", async () => {
    links.findOne.mockResolvedValue(null);

    await expect(
      service.login({ tenantId: "t001", userId: "u001" }),
    ).rejects.toMatchObject({ code: "INVALID_USER" });
  });

  it("login throws XianApiError code ACCOUNT_DISABLED when user has deletedAt", async () => {
    links.findOne.mockResolvedValue({
      id: 10,
      tenantId: "t001",
      userId: "u001",
      localUserId: 7,
    });
    users.findOne.mockResolvedValue({
      id: 7,
      email: "x@y",
      passwordHash: "hash",
      deletedAt: new Date(),
    });

    await expect(
      service.login({ tenantId: "t001", userId: "u001" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
  });

  it("login returns SUCCESS and a loginUrl containing /login/sso?ticket= when valid", async () => {
    links.findOne.mockResolvedValue({
      id: 10,
      tenantId: "t001",
      userId: "u001",
      localUserId: 7,
    });
    users.findOne.mockResolvedValue({
      id: 7,
      email: "x@y",
      passwordHash: "hash",
      deletedAt: null,
    });
    auth.createSsoTicket.mockResolvedValue("ticket-abc");

    const result = await service.login({ tenantId: "t001", userId: "u001" });

    expect(result.code).toBe("SUCCESS");
    expect(result.data.loginUrl).toBe(
      "http://web.test/login/sso?ticket=ticket-abc",
    );
    expect(result.data.loginUrl).toContain("/login/sso?ticket=");
  });

  it("throws SYSTEM_ERROR when SM2 private key is not configured", async () => {
    configGet.mockImplementation((key: string) => {
      if (key === "XIAN_SM2_PRIVATE_KEY_PKCS8_B64") return "";
      return undefined;
    });

    await expect(
      service.login({ tenantId: "t001", userId: "u001" }),
    ).rejects.toBeInstanceOf(XianApiError);
  });
});
