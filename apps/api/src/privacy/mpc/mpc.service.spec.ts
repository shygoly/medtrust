import { Test, TestingModule } from "@nestjs/testing";
import { MpcService } from "./mpc.service";
import { MpSpdzAdapter } from "./adapters/mp-spdz.adapter";
import { getRepositoryToken } from "@nestjs/typeorm";
import { MpcSession, MpcSessionStatus } from "@medtrust/database";
import { Repository } from "typeorm";
import { MpcComputationType } from "./dto/mpc-session.dto";

describe("MpcService", () => {
  let service: MpcService;
  let repository: Repository<MpcSession>;
  let mpSpdzAdapter: MpSpdzAdapter;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockMpSpdzAdapter = {
    computeSum: jest.fn(),
    computeMean: jest.fn(),
    checkHealth: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpcService,
        {
          provide: getRepositoryToken(MpcSession),
          useValue: mockRepository,
        },
        {
          provide: MpSpdzAdapter,
          useValue: mockMpSpdzAdapter,
        },
      ],
    }).compile();

    service = module.get<MpcService>(MpcService);
    repository = module.get<Repository<MpcSession>>(
      getRepositoryToken(MpcSession),
    );
    mpSpdzAdapter = module.get<MpSpdzAdapter>(MpSpdzAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createSession", () => {
    it("should create an MPC session", async () => {
      const tenantId = 1;
      const dto = {
        name: "Test MPC Session",
        computation_type: MpcComputationType.SECURE_SUM,
        participants: [
          { party_id: 0, tenant_id: 1, endpoint: "http://host1" },
          { party_id: 1, tenant_id: 2, endpoint: "http://host2" },
        ],
        timeout_seconds: 300,
      };

      const mockSession = {
        id: 1,
        tenantId,
        sessionId: "session-uuid",
        name: dto.name,
        computationType: dto.computation_type,
        status: MpcSessionStatus.WAITING_FOR_SHARES,
        createdAt: new Date(),
      };

      mockRepository.create.mockReturnValue(mockSession);
      mockRepository.save.mockResolvedValue(mockSession);

      const result = await service.createSession(tenantId, dto);

      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
      expect(result.status).toBe(MpcSessionStatus.WAITING_FOR_SHARES);
    });

    it("should reject session with less than 2 participants", async () => {
      const tenantId = 1;
      const dto = {
        name: "Test MPC Session",
        computation_type: MpcComputationType.SECURE_SUM,
        participants: [{ party_id: 0, tenant_id: 1, endpoint: "http://host1" }],
      };

      await expect(service.createSession(tenantId, dto)).rejects.toThrow(
        "At least 2 participants required for MPC",
      );
    });
  });

  describe("submitShare", () => {
    it("should accept valid share submission", async () => {
      const tenantId = 1;
      const sessionId = 1;
      const dto = { party_id: 0, value: 100 };

      const mockSession = {
        id: sessionId,
        sessionId: "session-uuid",
        status: MpcSessionStatus.WAITING_FOR_SHARES,
        participants: [
          {
            party_id: 0,
            tenant_id: 1,
            endpoint: "http://host1",
            share_submitted: false,
          },
          {
            party_id: 1,
            tenant_id: 2,
            endpoint: "http://host2",
            share_submitted: false,
          },
        ],
        totalParticipants: 2,
        sharesReceived: 0,
        expiresAt: new Date(Date.now() + 300000),
      };

      mockRepository.findOne.mockResolvedValue(mockSession);
      mockRepository.save.mockResolvedValue({
        ...mockSession,
        sharesReceived: 1,
      });

      const result = await service.submitShare(tenantId, sessionId, dto);

      expect(result.shares_received).toBe(1);
    });

    it("should reject share for expired session", async () => {
      const tenantId = 1;
      const sessionId = 1;
      const dto = { party_id: 0, value: 100 };

      const mockSession = {
        id: sessionId,
        status: MpcSessionStatus.WAITING_FOR_SHARES,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };

      mockRepository.findOne.mockResolvedValue(mockSession);

      await expect(
        service.submitShare(tenantId, sessionId, dto),
      ).rejects.toThrow("Session has expired");
    });
  });
});
