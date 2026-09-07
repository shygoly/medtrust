import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { OrgCertificationApplication, User } from "@medtrust/database";
import { CaService } from "../participant-identity/ca.service";
import { OrganizationService } from "./organization.service";

describe("OrganizationService", () => {
  let service: OrganizationService;
  const repo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    createQueryBuilder: jest.fn(),
  };
  const users = {
    findOne: jest.fn(),
  };
  const caService = {
    issue: jest.fn(),
    revoke: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        {
          provide: getRepositoryToken(
            OrgCertificationApplication,
            "controlplane",
          ),
          useValue: repo,
        },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: CaService, useValue: caService },
      ],
    }).compile();
    service = module.get(OrganizationService);
  });

  it("getMyCertification returns null application for first-time users", async () => {
    repo.findOne.mockResolvedValue(null);
    const result = await service.getMyCertification(7);
    expect(result).toEqual({ application: null });
  });

  it("saveCertification creates a draft by default", async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation(async (v) => v);

    const result = await service.saveCertification(7, {
      orgName: "上海示例医院",
      uscc: "91310000MA1FL0000X",
      businessScope: "医疗服务",
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, status: "draft" }),
    );
    expect(result.application.status).toBe("draft");
  });

  it("saveCertification submits when submit=true", async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation(async (v) => v);

    const result = await service.saveCertification(7, {
      orgName: "上海示例医院",
      submit: true,
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "submitted" }),
    );
    expect(result.application.status).toBe("submitted");
  });

  it("saveCertification rejects edits after approval", async () => {
    repo.findOne.mockResolvedValue({ status: "approved" });
    await expect(
      service.saveCertification(7, { orgName: "改名" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("reviewCertification approves a submitted application", async () => {
    const row = { id: "c1", status: "submitted" };
    repo.findOne.mockResolvedValue(row);
    repo.save.mockImplementation(async (v) => v);

    const result = await service.reviewCertification("c1", 9, {
      approve: true,
      note: "ok",
    });

    expect(result.application.status).toBe("approved");
    expect(result.application.reviewerId).toBe(9);
  });

  it("reviewCertification rejects non-submitted applications", async () => {
    repo.findOne.mockResolvedValue({ id: "c1", status: "draft" });
    await expect(
      service.reviewCertification("c1", 9, { approve: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it("reviewCertification throws NotFound for missing applications", async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.reviewCertification("missing", 9, { approve: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it("issueUserCa saves public key and fingerprint from CaService", async () => {
    users.findOne.mockResolvedValue({
      id: 7,
      participantId: null,
    });
    const app = {
      userId: 7,
      status: "submitted",
    };
    repo.findOne.mockResolvedValue(app);
    repo.save.mockImplementation(async (v) => v);
    caService.issue.mockResolvedValue({
      fingerprint: "SM2:ABCD",
      validUntil: new Date(Date.now() + 365 * 86400000).toISOString(),
    });

    const result = await service.issueUserCa(
      7,
      "上海示例医院-管理员",
      "04" + "a1".repeat(64),
    );

    expect(caService.issue).toHaveBeenCalledWith(
      "user:7",
      "pending:7",
      "04" + "a1".repeat(64),
      365,
    );
    expect(result.certificate.fingerprint).toBe("SM2:ABCD");
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ caCertFingerprint: "SM2:ABCD" }),
    );
  });

  it("issueUserCa requires an existing application", async () => {
    users.findOne.mockResolvedValue({ id: 7, participantId: "p-huashan" });
    repo.findOne.mockResolvedValue(null);

    await expect(
      service.issueUserCa(7, "身份", "04" + "a1".repeat(64)),
    ).rejects.toThrow(BadRequestException);
  });

  it("revokeUserCa revokes the certificate and clears the fingerprint", async () => {
    const app = {
      userId: 7,
      caCertFingerprint: "SM2:ABCD",
      caPublicKey: "04" + "a1".repeat(64),
    };
    repo.findOne.mockResolvedValue(app);
    repo.save.mockImplementation(async (v) => v);
    caService.revoke.mockResolvedValue(undefined);

    const result = await service.revokeUserCa(7);

    expect(caService.revoke).toHaveBeenCalledWith("SM2:ABCD");
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ caCertFingerprint: undefined }),
    );
    expect(result.ok).toBe(true);
  });
});
