import { Test, TestingModule } from "@nestjs/testing";
import { FederatedLearningService } from "./fl.service";
import { FateFlowAdapter } from "./adapters/fate-flow.adapter";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  FederatedLearningJob,
  FederatedLearningStatus,
} from "@medtrust/database";
import { Repository } from "typeorm";
import { FLType, FLAlgorithm } from "./dto/fl-job.dto";

describe("FederatedLearningService", () => {
  let service: FederatedLearningService;
  let repository: Repository<FederatedLearningJob>;
  let fateFlowAdapter: FateFlowAdapter;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockFateFlowAdapter = {
    submitJob: jest.fn(),
    getJobStatus: jest.fn(),
    getJobMetrics: jest.fn(),
    downloadModel: jest.fn(),
    stopJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FederatedLearningService,
        {
          provide: getRepositoryToken(FederatedLearningJob),
          useValue: mockRepository,
        },
        {
          provide: FateFlowAdapter,
          useValue: mockFateFlowAdapter,
        },
      ],
    }).compile();

    service = module.get<FederatedLearningService>(FederatedLearningService);
    repository = module.get<Repository<FederatedLearningJob>>(
      getRepositoryToken(FederatedLearningJob),
    );
    fateFlowAdapter = module.get<FateFlowAdapter>(FateFlowAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createJob", () => {
    it("should create a federated learning job", async () => {
      const tenantId = 1;
      const dto = {
        name: "Test FL Job",
        fl_type: FLType.HORIZONTAL,
        algorithm: FLAlgorithm.LOGISTIC_REGRESSION,
        participants: [
          { party_id: 1, role: "guest", endpoint: "http://host1" },
          { party_id: 2, role: "host", endpoint: "http://host2" },
        ],
        training_params: { epochs: 10 },
      };

      const mockJob = {
        id: 1,
        tenantId,
        name: dto.name,
        flType: dto.fl_type,
        algorithm: dto.algorithm,
        participants: dto.participants,
        status: FederatedLearningStatus.PENDING,
        createdAt: new Date(),
      };

      mockRepository.create.mockReturnValue(mockJob);
      mockRepository.save.mockResolvedValue(mockJob);

      const result = await service.createJob(tenantId, dto);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          name: dto.name,
          flType: dto.fl_type,
          algorithm: dto.algorithm,
        }),
      );
      expect(mockRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
      expect(result.status).toBe(FederatedLearningStatus.PENDING);
    });

    it("should reject job with less than 2 participants", async () => {
      const tenantId = 1;
      const dto = {
        name: "Test FL Job",
        fl_type: FLType.HORIZONTAL,
        algorithm: FLAlgorithm.LOGISTIC_REGRESSION,
        participants: [
          { party_id: 1, role: "guest", endpoint: "http://host1" },
        ],
      };

      await expect(service.createJob(tenantId, dto)).rejects.toThrow(
        "At least 2 participants required",
      );
    });
  });

  describe("getJob", () => {
    it("should return a job by id", async () => {
      const tenantId = 1;
      const jobId = 1;
      const mockJob = {
        id: jobId,
        tenantId,
        name: "Test Job",
        status: FederatedLearningStatus.RUNNING,
        createdAt: new Date(),
      };

      mockRepository.findOne.mockResolvedValue(mockJob);

      const result = await service.getJob(tenantId, jobId);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: jobId, tenantId },
      });
      expect(result.id).toBe(jobId);
    });

    it("should throw NotFoundException if job not found", async () => {
      const tenantId = 1;
      const jobId = 999;

      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getJob(tenantId, jobId)).rejects.toThrow(
        "Federated learning job 999 not found",
      );
    });
  });

  describe("downloadModel", () => {
    it("should download model for completed job", async () => {
      const tenantId = 1;
      const jobId = 1;
      const mockJob = {
        id: jobId,
        tenantId,
        status: FederatedLearningStatus.COMPLETED,
        fateJobId: "fate-job-123",
      };

      const mockModelBuffer = Buffer.from("model-data");

      mockRepository.findOne.mockResolvedValue(mockJob);
      mockFateFlowAdapter.downloadModel.mockResolvedValue(mockModelBuffer);

      const result = await service.downloadModel(tenantId, jobId);

      expect(mockFateFlowAdapter.downloadModel).toHaveBeenCalledWith(
        "fate-job-123",
      );
      expect(result).toEqual(mockModelBuffer);
    });

    it("should reject download for non-completed job", async () => {
      const tenantId = 1;
      const jobId = 1;
      const mockJob = {
        id: jobId,
        tenantId,
        status: FederatedLearningStatus.RUNNING,
      };

      mockRepository.findOne.mockResolvedValue(mockJob);

      await expect(service.downloadModel(tenantId, jobId)).rejects.toThrow(
        "Model not ready - job not completed",
      );
    });
  });
});
