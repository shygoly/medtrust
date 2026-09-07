import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { AttestationRef, DigitalContractEntity } from "@medtrust/database";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { AuditService } from "./audit.service";
import { EvidencePackageService } from "./evidence-package.service";

describe("EvidencePackageService", () => {
  let service: EvidencePackageService;
  const auditService = {
    exportReport: jest.fn(),
  };
  const gm = {
    sm3Hash: jest.fn((s: string) => `sm3:${s.length}`),
  };
  const attestations = {
    find: jest.fn(),
  };
  const contracts = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidencePackageService,
        { provide: AuditService, useValue: auditService },
        { provide: GMCryptoService, useValue: gm },
        {
          provide: getRepositoryToken(AttestationRef, "controlplane"),
          useValue: attestations,
        },
        {
          provide: getRepositoryToken(DigitalContractEntity, "controlplane"),
          useValue: contracts,
        },
      ],
    }).compile();
    service = module.get(EvidencePackageService);
  });

  it("builds a ZIP with report, attestations, contracts and manifest", async () => {
    auditService.exportReport.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      tenantId: 1,
      filters: {},
      total: 1,
      integrity: { ok: true, checked: 1, message: "完整" },
      entries: [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          action: "LOGIN",
          resourceType: "auth",
          resourceId: null,
          userId: 7,
          userName: "张三",
          entryHash: "SM3:abc",
          prevHash: "GENESIS",
        },
      ],
    });
    attestations.find.mockResolvedValue([]);
    contracts.find.mockResolvedValue([]);

    const pkg = await service.build({ tenantId: 1 });

    expect(pkg.fileCount).toBe(5); // report.html/json + attestations + contracts + manifest
    expect(pkg.zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(pkg.fingerprint).toMatch(/^sm3:/);
  });
});
