import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException } from "@nestjs/common";
import { TeeComputation, TeeComputationStatus } from "@medtrust/database";
import { TeeService } from "./tee.service";
import { ConfidentialComputeAttestationAdapter } from "./adapters/confidential-compute-attestation.adapter";

/**
 * D2：默认未注入 TrustedRoot。getAttestation 必须把
 * verified / attestationValid 写成 false，submit 必须被挡住。
 * 拒绝来自 mdop 接缝（无信任根），不是写死 return false。
 */
describe("TeeService — 未注入信任根则 fail-closed", () => {
  let service: TeeService;
  let adapter: ConfidentialComputeAttestationAdapter;

  const computation = {
    id: 1,
    tenantId: 7,
    instanceId: "i-sgx-unwired",
    attestationReport: null as string | null,
    attestationValid: undefined as boolean | undefined,
    attestationVerifiedAt: undefined as Date | undefined,
  };

  const mockRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    mockRepository.findOne.mockReset();
    mockRepository.save.mockReset();
    mockRepository.save.mockImplementation(async (row) => row);

    const config = {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    };
    adapter = new ConfidentialComputeAttestationAdapter(
      config as unknown as ConfigService,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeeService,
        { provide: ConfidentialComputeAttestationAdapter, useValue: adapter },
        { provide: ConfigService, useValue: config },
        {
          provide: getRepositoryToken(TeeComputation),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get(TeeService);
  });

  it("getAttestation 在未注入信任根时 verified 必须为 false", async () => {
    mockRepository.findOne.mockResolvedValue({ ...computation });

    const result = await service.getAttestation(7, 1);

    expect(result.verified).toBe(false);
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ attestationValid: false }),
    );
  });

  it("submitComputation 在 attestation 未通过时必须拒绝", async () => {
    mockRepository.findOne.mockResolvedValue({
      ...computation,
      status: TeeComputationStatus.READY,
      attestationValid: false,
    });

    await expect(
      service.submitComputation(7, 1, Buffer.from("x")),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
