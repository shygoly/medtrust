import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Certificate, OpenPlatformApp, SpaceEntity } from "@medtrust/database";
import { CaService } from "../runtime/participant-identity/ca.service";
import { InfraAdminService } from "./infra-admin.service";

describe("InfraAdminService", () => {
  let service: InfraAdminService;
  const spaces = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const certs = {
    find: jest.fn(),
    count: jest.fn(),
  };
  const apps = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const caService = {
    revoke: jest.fn(),
    spaceId: "sh-med",
    caPublicKey: "04pub",
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfraAdminService,
        {
          provide: getRepositoryToken(SpaceEntity, "controlplane"),
          useValue: spaces,
        },
        {
          provide: getRepositoryToken(Certificate, "controlplane"),
          useValue: certs,
        },
        {
          provide: getRepositoryToken(OpenPlatformApp, "controlplane"),
          useValue: apps,
        },
        { provide: CaService, useValue: caService },
      ],
    }).compile();
    service = module.get(InfraAdminService);
  });

  it("creates an open platform app and returns the secret once", async () => {
    apps.save.mockImplementation(async (v) => v);
    const result = await service.createApp({
      name: "西安节点数据同步",
      scopes: ["catalog:read"],
    });

    expect(result.appId).toMatch(/^app-/);
    expect(result.appSecret).toMatch(/^[0-9a-f]{64}$/);
    const saved = apps.create.mock.calls[0][0];
    expect(saved.appKeyHash).not.toBe(result.appSecret);
    expect(saved.appKeyHash).toHaveLength(64);
  });

  it("revokes a certificate via CaService", async () => {
    caService.revoke.mockResolvedValue(undefined);
    const result = await service.revokeCertificate("SM2:ABCD");
    expect(caService.revoke).toHaveBeenCalledWith("SM2:ABCD");
    expect(result.ok).toBe(true);
  });

  it("lists spaces read-only (no mutation methods exposed)", () => {
    expect(typeof (service as any).createSpace).toBe("undefined");
    expect(typeof (service as any).archiveSpace).toBe("undefined");
    expect(typeof service.listSpaces).toBe("function");
  });
});
