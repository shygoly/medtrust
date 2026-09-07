import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  DataProduct,
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
  const auditService = {
    exportReport: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SilkRoadService,
        { provide: getRepositoryToken(InteropSubject, "controlplane"), useValue: subjects },
        { provide: getRepositoryToken(DataProduct, "controlplane"), useValue: products },
        { provide: getRepositoryToken(OrgCertificationApplication, "controlplane"), useValue: orgApps },
        { provide: getRepositoryToken(ParticipantIdentity, "controlplane"), useValue: participants },
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

  it("importSubjectToCertification rejects missing subjects", async () => {
    subjects.findOne.mockResolvedValue(null);
    await expect(
      service.importSubjectToCertification(7, "missing"),
    ).rejects.toThrow("丝路数港主体不存在");
  });
});
