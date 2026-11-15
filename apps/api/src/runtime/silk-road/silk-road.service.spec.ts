import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  DataProduct,
  InteropPushRecordEntity,
  InteropSubject,
  OrgCertificationApplication,
  ParticipantIdentity,
} from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import { SilkRoadService } from "./silk-road.service";

describe("SilkRoadService", () => {
  let service: SilkRoadService;
  const subjects = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    createQueryBuilder: jest.fn(),
  };
  const products = {
    find: jest.fn(),
  };
  const orgApps = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const participants = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const pushes = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    find: jest.fn(),
  };
  const auditService = {
    exportReport: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pushes.findOne.mockResolvedValue(null);
    pushes.save.mockImplementation(async (v) => v);
    pushes.create.mockImplementation((v) => v);
    pushes.find.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SilkRoadService,
        {
          provide: getRepositoryToken(InteropSubject, "controlplane"),
          useValue: subjects,
        },
        {
          provide: getRepositoryToken(DataProduct, "controlplane"),
          useValue: products,
        },
        {
          provide: getRepositoryToken(
            OrgCertificationApplication,
            "controlplane",
          ),
          useValue: orgApps,
        },
        {
          provide: getRepositoryToken(ParticipantIdentity, "controlplane"),
          useValue: participants,
        },
        {
          provide: getRepositoryToken(InteropPushRecordEntity, "controlplane"),
          useValue: pushes,
        },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    service = module.get(SilkRoadService);
  });

  it("syncSubjects upserts subjects and auto-maps cp_participant", async () => {
    subjects.findOne.mockResolvedValue(null);
    subjects.save.mockImplementation(async (v) => v);
    participants.findOne.mockResolvedValue(null);
    participants.save.mockImplementation(async (v) => ({ id: "p-1", ...v }));

    const result = await service.syncSubjects();

    expect(result.imported).toBe(2);
    expect(result.mapped).toBe(2);
    expect(subjects.save).toHaveBeenCalledTimes(2);
    const created = subjects.create.mock.calls.map((c) => c[0]);
    expect(created[0].nodeId).toBe("silk-road");
    expect(created[0].uscc).toBeTruthy();
    expect(participants.create).toHaveBeenCalledWith(
      expect.objectContaining({ org: "西安示例医院", subjectVerified: true }),
    );
  });

  it("importSubjectToCertification prefills org fields from a synced subject", async () => {
    subjects.findOne.mockResolvedValue({
      subjectId: "sr-subj-001",
      nodeId: "silk-road",
      orgName: "西安示例医院",
      uscc: "91610131MA6U000000",
      region: "陕西省/西安市",
    });
    orgApps.findOne.mockResolvedValue(null);
    orgApps.save.mockImplementation(async (v) => v);

    const result = await service.importSubjectToCertification(7, "sr-subj-001");

    expect(orgApps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        source: "silk-road",
        interopSubjectId: "sr-subj-001",
        orgName: "西安示例医院",
        uscc: "91610131MA6U000000",
      }),
    );
    expect(result.application.status).toBe("draft");
  });

  describe("pushCatalog（NDI-TR-2025-04 标识）", () => {
    const original = process.env.NDI_ORG_CODE;
    afterEach(() => {
      if (original === undefined) delete process.env.NDI_ORG_CODE;
      else process.env.NDI_ORG_CODE = original;
    });

    it("配置机构码时按 active 产品数量推送（不抛错）", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      products.find.mockResolvedValue([
        {
          urn: "urn:tds:sp:p1",
          homeSpace: "sp",
          title: "队列",
          providerId: "p1",
          productType: "data",
        },
        {
          urn: "urn:tds:sp:p2",
          homeSpace: "sp",
          title: "统计服务",
          providerId: "p1",
          productType: "service",
        },
      ]);
      await expect(service.pushCatalog()).resolves.toEqual({ pushed: 2 });
      // 类型分派：产品与服务分别记 objectType
      const created = pushes.create.mock.calls.map((c) => c[0]);
      expect(created.map((r) => r.objectType).sort()).toEqual([
        "product",
        "service",
      ]);
      expect(created[0].idempotencyKey).toMatch(/^sp:ndi:draft-1:/);
      expect(created[0].id).toMatch(/^silk-road:sp:ndi:draft-1:/);
    });

    it("重复推送幂等：同键只更新既有台账行，不新增第二条", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      products.find.mockResolvedValue([
        {
          urn: "urn:tds:sp:p1",
          homeSpace: "sp",
          title: "队列",
          providerId: "p1",
          productType: "data",
        },
      ]);
      pushes.findOne.mockResolvedValue({
        id: "silk-road:sp:ndi:draft-1:product:91610131MA6U000000:aaaaaaaaaaaa:0000:draft-1",
        attempts: 1,
        status: "pushed",
      });

      await service.pushCatalog();

      // 已有行：走更新，不 create
      expect(pushes.create).not.toHaveBeenCalled();
      expect(pushes.findOne).toHaveBeenCalled();
      const updated = pushes.save.mock.calls[0][0];
      expect(updated.attempts).toBe(2);
      expect(updated.status).toBe("pushed");
      expect(updated.lastPushedAt).toBeInstanceOf(Date);
    });

    it("推送失败：台账记 failed + 原因并抛给操作者（不回滚本地目录）", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      products.find.mockResolvedValue([
        {
          urn: "urn:tds:sp:p1",
          homeSpace: "sp",
          title: "队列",
          providerId: "p1",
          productType: "data",
        },
      ]);
      // 模拟最小仓储：attempt 落库后，失败标记回写同一行
      const stored = new Map<string, any>();
      pushes.findOne.mockImplementation(
        async ({ where }: any) => stored.get(where.id) ?? null,
      );
      pushes.save.mockImplementation(async (row: any) => {
        stored.set(row.id, { ...(stored.get(row.id) ?? {}), ...row });
        return row;
      });
      jest
        .spyOn(
          (
            service as unknown as {
              client: { pushCatalog: () => Promise<void> };
            }
          ).client,
          "pushCatalog",
        )
        .mockRejectedValueOnce(new Error("HTTP 503"));
      await expect(service.pushCatalog()).rejects.toThrow("HTTP 503");
      const [record] = [...stored.values()];
      expect(record.status).toBe("failed");
      expect(record.lastError).toBe("HTTP 503");
    });

    it("本地台账先落库、再触发外部推送（顺序断言）", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      products.find.mockResolvedValue([
        {
          urn: "urn:tds:sp:p1",
          homeSpace: "sp",
          title: "队列",
          providerId: "p1",
          productType: "data",
        },
      ]);
      const client = (
        service as unknown as { client: { pushCatalog: () => Promise<void> } }
      ).client;
      const pushSpy = jest
        .spyOn(client, "pushCatalog")
        .mockResolvedValue(undefined);
      await service.pushCatalog();
      const firstSaveOrder = pushes.save.mock.invocationCallOrder[0];
      const pushOrder = pushSpy.mock.invocationCallOrder[0];
      expect(firstSaveOrder).toBeLessThan(pushOrder);
    });

    it("推送台账可查：limit 钳制 1–200", async () => {
      await service.listPushRecords(10_000);
      expect(pushes.find).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 200 }),
      );
      await service.listPushRecords(Number.NaN);
      expect(pushes.find).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("缺 NDI_ORG_CODE 时 fail-closed（不回退内部 URN）", async () => {
      delete process.env.NDI_ORG_CODE;
      products.find.mockResolvedValue([
        {
          urn: "urn:tds:sp:p1",
          title: "队列",
          providerId: "p1",
          productType: "data",
        },
      ]);
      await expect(service.pushCatalog()).rejects.toThrow("NDI_ORG_CODE");
    });
  });

  it("importSubjectToCertification rejects missing subjects", async () => {
    subjects.findOne.mockResolvedValue(null);
    await expect(
      service.importSubjectToCertification(7, "missing"),
    ).rejects.toThrow("丝路数港主体不存在");
  });
});
