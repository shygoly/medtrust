import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  ComputeMethod,
  ComputeTask,
  ComputeTaskStatus,
  WorkloadType,
} from "@medtrust/database";
import { Repository } from "typeorm";
import { ComputeTaskService } from "./compute-task.service";
import { SecretFlowTaskSpec } from "./dto/secretflow-task-spec";
import { ckdEsrdRiskFlPredictionSpec } from "./dto/fl-prediction-task-spec";
import { buildMockFlRunResult } from "./dto/fl-run-result";

function minimalSecretFlowSpec(): SecretFlowTaskSpec {
  return {
    parties: [{ participantId: "hospital-a", role: "provider" }],
    modalities: [{ type: "clinical_text" }],
    llmBackbone: { modelType: "llm", modelNameOrPath: "mock/backbone" },
    peftStrategy: { type: "lora", r: 8, alpha: 16, targetModules: ["q_proj"] },
    privacy: { teeRequired: true, heuEnabled: false },
    outputPolicy: {
      allowedArtifacts: ["lora_delta_hash", "aggregate_metrics"],
    },
  };
}

describe("ComputeTaskService", () => {
  let service: ComputeTaskService;
  let repository: Repository<ComputeTask>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComputeTaskService,
        {
          provide: getRepositoryToken(ComputeTask),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ComputeTaskService>(ComputeTaskService);
    repository = module.get<Repository<ComputeTask>>(
      getRepositoryToken(ComputeTask),
    );
    jest.clearAllMocks();
  });

  describe("create — SecretFlow validation", () => {
    it("accepts a valid SecretFlow task with method tee", async () => {
      const saved = {
        id: 1,
        tenantId: 1,
        name: "Multimodal LoRA",
        method: ComputeMethod.TEE,
        workloadType: WorkloadType.SECRETFLOW,
        status: ComputeTaskStatus.PENDING,
      } as ComputeTask;

      mockRepository.create.mockReturnValue(saved);
      mockRepository.save.mockResolvedValue(saved);

      const result = await service.create(1, {
        name: "Multimodal LoRA",
        method: ComputeMethod.TEE,
        workloadType: WorkloadType.SECRETFLOW,
        algorithmParams: { secretflowSpec: minimalSecretFlowSpec() },
      });

      expect(repository.create).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalled();
      expect(result.workloadType).toBe(WorkloadType.SECRETFLOW);
    });

    it("rejects SecretFlow tasks without secretflowSpec", async () => {
      await expect(
        service.create(1, {
          name: "Invalid SecretFlow",
          method: ComputeMethod.TEE,
          workloadType: WorkloadType.SECRETFLOW,
          algorithmParams: {},
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "SecretFlow workload requires algorithmParams.secretflowSpec",
        ),
      );
    });

    it("rejects SecretFlow tasks with empty parties", async () => {
      await expect(
        service.create(1, {
          name: "Invalid SecretFlow",
          method: ComputeMethod.MPC,
          workloadType: WorkloadType.SECRETFLOW,
          algorithmParams: {
            secretflowSpec: { ...minimalSecretFlowSpec(), parties: [] },
          },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "SecretFlow workload requires at least one valid party",
        ),
      );
    });

    it("rejects SecretFlow tasks with unsupported method", async () => {
      await expect(
        service.create(1, {
          name: "Invalid SecretFlow",
          method: ComputeMethod.FL,
          workloadType: WorkloadType.SECRETFLOW,
          algorithmParams: { secretflowSpec: minimalSecretFlowSpec() },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "SecretFlow workload requires method to be tee or mpc",
        ),
      );
    });

    it("rejects SecretFlow tasks without privacy settings", async () => {
      const { privacy: _privacy, ...specWithoutPrivacy } =
        minimalSecretFlowSpec();
      await expect(
        service.create(1, {
          name: "Invalid SecretFlow",
          method: ComputeMethod.TEE,
          workloadType: WorkloadType.SECRETFLOW,
          algorithmParams: {
            secretflowSpec: specWithoutPrivacy as unknown as SecretFlowTaskSpec,
          },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "SecretFlow workload requires privacy settings",
        ),
      );
    });

    it("rejects SecretFlow tasks without valid output artifacts", async () => {
      await expect(
        service.create(1, {
          name: "Invalid SecretFlow",
          method: ComputeMethod.MPC,
          workloadType: WorkloadType.SECRETFLOW,
          algorithmParams: {
            secretflowSpec: {
              ...minimalSecretFlowSpec(),
              outputPolicy: { allowedArtifacts: ["raw_rows"] },
            } as unknown as SecretFlowTaskSpec,
          },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "SecretFlow workload requires outputPolicy.allowedArtifacts",
        ),
      );
    });
  });

  describe("create — RWS validation", () => {
    it("still requires analysis.type for RWS workloads", async () => {
      await expect(
        service.create(1, {
          name: "Invalid RWS",
          method: ComputeMethod.TEE,
          workloadType: WorkloadType.RWS,
          algorithmParams: {},
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "RWS workload requires algorithmParams.analysis.type",
        ),
      );
    });
  });

  describe("create — FL prediction validation", () => {
    it("accepts a valid FL prediction task with method mpc + secureboost", async () => {
      const saved = {
        id: 2,
        tenantId: 1,
        name: "CKD ESRD risk",
        method: ComputeMethod.MPC,
        workloadType: WorkloadType.FEDERATED_LEARNING,
        status: ComputeTaskStatus.PENDING,
      } as ComputeTask;

      mockRepository.create.mockReturnValue(saved);
      mockRepository.save.mockResolvedValue(saved);

      const result = await service.create(1, {
        name: "CKD ESRD risk",
        method: ComputeMethod.MPC,
        workloadType: WorkloadType.FEDERATED_LEARNING,
        algorithmParams: { flPredictionSpec: ckdEsrdRiskFlPredictionSpec() },
      });

      expect(result.workloadType).toBe(WorkloadType.FEDERATED_LEARNING);
    });

    it("rejects FL prediction without flPredictionSpec", async () => {
      await expect(
        service.create(1, {
          name: "Invalid FL",
          method: ComputeMethod.FL,
          workloadType: WorkloadType.FEDERATED_LEARNING,
          algorithmParams: {},
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "Federated learning workload requires algorithmParams.flPredictionSpec",
        ),
      );
    });

    it("rejects secureboost when method is not mpc", async () => {
      await expect(
        service.create(1, {
          name: "Invalid FL",
          method: ComputeMethod.FL,
          workloadType: WorkloadType.FEDERATED_LEARNING,
          algorithmParams: { flPredictionSpec: ckdEsrdRiskFlPredictionSpec() },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "FL prediction with aggregation secureboost requires method mpc",
        ),
      );
    });
  });

  describe("updateStatus — FL result validation", () => {
    const flTask = {
      id: 10,
      workloadType: WorkloadType.FEDERATED_LEARNING,
      algorithmParams: { flPredictionSpec: ckdEsrdRiskFlPredictionSpec() },
      startedAt: new Date(),
    } as ComputeTask;

    beforeEach(() => {
      jest.spyOn(service, "findOne").mockResolvedValue(flTask);
      mockRepository.save.mockImplementation(async (t) => t);
    });

    it("rejects completed FL task without flRunResult", async () => {
      await expect(
        service.updateStatus(10, {
          status: ComputeTaskStatus.COMPLETED,
          resultSummary: {},
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "Completed FL prediction task requires resultSummary with flRunResult",
        ),
      );
    });

    it("accepts completed FL task with valid flRunResult", async () => {
      const flRunResult = buildMockFlRunResult(
        "fl-10",
        ckdEsrdRiskFlPredictionSpec(),
      );
      const updated = await service.updateStatus(10, {
        status: ComputeTaskStatus.COMPLETED,
        resultSummary: { flRunResult },
      });
      expect(updated.status).toBe(ComputeTaskStatus.COMPLETED);
    });
  });
});
