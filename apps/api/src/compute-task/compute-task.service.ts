import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ComputeMethod,
  ComputeTask,
  ComputeTaskStatus,
  WorkloadType,
} from "@medtrust/database";
import { CreateComputeTaskDto } from "./dto/create-compute-task.dto";
import {
  hasRequiredLlmBackbone,
  hasRequiredModalities,
  hasRequiredParties,
  hasRequiredPeftStrategy,
  hasRequiredPrivacy,
  hasRequiredOutputPolicy,
} from "./dto/secretflow-task-spec";
import {
  hasRequiredFlFeatures,
  hasRequiredFlModelConfig,
  hasRequiredFlOutputPolicy,
  hasRequiredFlParties,
} from "./dto/fl-prediction-task-spec";
import { FlPredictionTaskSpec } from "./dto/fl-prediction-task-spec";
import { isFlRunResult } from "./dto/fl-run-result";
import { validateRwsAnalysisLadder } from "./dto/rws-analysis-spec";
import {
  UpdateComputeTaskDto,
  UpdateTaskStatusDto,
} from "./dto/update-compute-task.dto";

@Injectable()
export class ComputeTaskService {
  constructor(
    @InjectRepository(ComputeTask)
    private computeTaskRepository: Repository<ComputeTask>,
  ) {}

  async create(
    tenantId: number,
    createDto: CreateComputeTaskDto,
  ): Promise<ComputeTask> {
    const workloadType = createDto.workloadType ?? WorkloadType.LEGACY;

    this.validateWorkloadSpec(
      workloadType,
      createDto.algorithmParams,
      createDto.method,
    );

    const task = this.computeTaskRepository.create({
      tenantId,
      name: createDto.name,
      method: createDto.method,
      workloadType,
      description: createDto.description,
      algorithmParams: createDto.algorithmParams,
      dataAssets: createDto.dataAssets,
      requestId: createDto.requestId,
      contractId: createDto.contractId,
      status: ComputeTaskStatus.PENDING,
    });
    return this.computeTaskRepository.save(task);
  }

  async findAll(): Promise<ComputeTask[]> {
    return this.computeTaskRepository.find({
      relations: ["tenant"],
    });
  }

  async findByTenant(tenantId: number): Promise<ComputeTask[]> {
    return this.computeTaskRepository.find({
      where: { tenantId },
      order: { createdAt: "DESC" },
    });
  }

  async findByRequest(requestId: number): Promise<ComputeTask[]> {
    return this.computeTaskRepository.find({
      where: { requestId },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: number): Promise<ComputeTask> {
    const task = await this.computeTaskRepository.findOne({
      where: { id },
      relations: ["tenant"],
    });
    if (!task) {
      throw new NotFoundException(`Compute task #${id} not found`);
    }
    return task;
  }

  async update(
    id: number,
    updateDto: UpdateComputeTaskDto,
  ): Promise<ComputeTask> {
    const task = await this.findOne(id);
    Object.assign(task, updateDto);
    return this.computeTaskRepository.save(task);
  }

  async updateStatus(
    id: number,
    statusDto: UpdateTaskStatusDto,
  ): Promise<ComputeTask> {
    const task = await this.findOne(id);

    task.status = statusDto.status;

    if (statusDto.errorMessage !== undefined) {
      task.errorMessage = statusDto.errorMessage;
    }

    if (statusDto.resultSummary !== undefined) {
      task.resultSummary = statusDto.resultSummary;
    }

    // 更新开始/完成时间
    if (statusDto.status === ComputeTaskStatus.RUNNING && !task.startedAt) {
      task.startedAt = new Date();
    }

    if (
      [
        ComputeTaskStatus.COMPLETED,
        ComputeTaskStatus.FAILED,
        ComputeTaskStatus.CANCELLED,
      ].includes(statusDto.status)
    ) {
      task.completedAt = new Date();
    }

    if (
      statusDto.status === ComputeTaskStatus.COMPLETED &&
      task.workloadType === WorkloadType.FEDERATED_LEARNING
    ) {
      this.validateFlRunResultSummary(
        statusDto.resultSummary,
        task.algorithmParams,
      );
    }

    return this.computeTaskRepository.save(task);
  }

  async remove(id: number): Promise<void> {
    const task = await this.findOne(id);
    await this.computeTaskRepository.remove(task);
  }

  async getTaskStats(tenantId: number) {
    const stats = await this.computeTaskRepository
      .createQueryBuilder("task")
      .where("task.tenantId = :tenantId", { tenantId })
      .select("task.status", "status")
      .addSelect("COUNT(*)", "count")
      .groupBy("task.status")
      .getRawMany();

    return stats.reduce((acc, curr) => {
      acc[curr.status] = parseInt(curr.count);
      return acc;
    }, {});
  }

  private validateWorkloadSpec(
    workloadType: WorkloadType,
    algorithmParams: unknown,
    method: ComputeMethod,
  ): void {
    if (workloadType === WorkloadType.RWS) {
      if (!this.hasRwsAnalysisType(algorithmParams)) {
        throw new BadRequestException(
          "RWS workload requires algorithmParams.analysis.type",
        );
      }
      const analysis = (
        algorithmParams as { analysis: Record<string, unknown> }
      ).analysis;
      const ladderError = validateRwsAnalysisLadder(analysis);
      if (ladderError) {
        throw new BadRequestException(ladderError);
      }
      return;
    }

    if (workloadType === WorkloadType.SECRETFLOW) {
      this.validateSecretFlowSpec(algorithmParams, method);
      return;
    }

    if (workloadType === WorkloadType.FEDERATED_LEARNING) {
      this.validateFlPredictionSpec(algorithmParams, method);
    }
  }

  private validateFlPredictionSpec(
    algorithmParams: unknown,
    method: ComputeMethod,
  ): void {
    if (
      method !== ComputeMethod.FL &&
      method !== ComputeMethod.MPC &&
      method !== ComputeMethod.TEE
    ) {
      throw new BadRequestException(
        "Federated learning prediction workload requires method to be fl, mpc, or tee",
      );
    }

    if (
      !algorithmParams ||
      typeof algorithmParams !== "object" ||
      !("flPredictionSpec" in algorithmParams)
    ) {
      throw new BadRequestException(
        "Federated learning workload requires algorithmParams.flPredictionSpec",
      );
    }

    const flPredictionSpec = (algorithmParams as { flPredictionSpec?: unknown })
      .flPredictionSpec;
    if (flPredictionSpec === undefined || flPredictionSpec === null) {
      throw new BadRequestException(
        "Federated learning workload requires algorithmParams.flPredictionSpec",
      );
    }

    if (!hasRequiredFlModelConfig(flPredictionSpec)) {
      throw new BadRequestException(
        "FL prediction requires purpose, structured_ehr modality, modelType, objective, aggregation, rounds",
      );
    }

    if (!hasRequiredFlParties(flPredictionSpec)) {
      throw new BadRequestException(
        "FL prediction requires at least two provider parties with dataProductId",
      );
    }

    if (!hasRequiredFlFeatures(flPredictionSpec)) {
      throw new BadRequestException(
        "FL prediction requires targetColumn and non-empty featureColumns (target must not appear in features)",
      );
    }

    if (!hasRequiredFlOutputPolicy(flPredictionSpec)) {
      throw new BadRequestException(
        "FL prediction requires outputPolicy.allowedArtifacts",
      );
    }

    const aggregation = (flPredictionSpec as { aggregation?: string })
      .aggregation;
    if (aggregation === "secureboost" && method !== ComputeMethod.MPC) {
      throw new BadRequestException(
        "FL prediction with aggregation secureboost requires method mpc",
      );
    }
  }

  private validateFlRunResultSummary(
    resultSummary: unknown,
    algorithmParams: unknown,
  ): void {
    if (!resultSummary || typeof resultSummary !== "object") {
      throw new BadRequestException(
        "Completed FL prediction task requires resultSummary with flRunResult",
      );
    }

    const flRunResult = (resultSummary as { flRunResult?: unknown })
      .flRunResult;
    if (flRunResult === undefined || flRunResult === null) {
      throw new BadRequestException(
        "Completed FL prediction task requires resultSummary with flRunResult",
      );
    }
    if (!isFlRunResult(flRunResult)) {
      throw new BadRequestException(
        "FL prediction resultSummary.flRunResult is invalid",
      );
    }

    if (
      !algorithmParams ||
      typeof algorithmParams !== "object" ||
      !("flPredictionSpec" in algorithmParams)
    ) {
      return;
    }

    const spec = (
      algorithmParams as { flPredictionSpec?: FlPredictionTaskSpec }
    ).flPredictionSpec;
    if (!spec) {
      return;
    }

    if (flRunResult.totalRounds !== spec.rounds) {
      throw new BadRequestException(
        "FL run result totalRounds must match spec.rounds",
      );
    }

    const providerIds = new Set(
      spec.parties
        .filter((p) => p.role === "provider")
        .map((p) => p.participantId),
    );
    const contributionIds = new Set(
      flRunResult.partyContributions.map((c) => c.participantId),
    );
    for (const id of providerIds) {
      if (!contributionIds.has(id)) {
        throw new BadRequestException(
          `FL run result missing party contribution for provider ${id}`,
        );
      }
    }
  }

  private validateSecretFlowSpec(
    algorithmParams: unknown,
    method: ComputeMethod,
  ): void {
    if (method !== ComputeMethod.TEE && method !== ComputeMethod.MPC) {
      throw new BadRequestException(
        "SecretFlow workload requires method to be tee or mpc",
      );
    }

    if (
      !algorithmParams ||
      typeof algorithmParams !== "object" ||
      !("secretflowSpec" in algorithmParams)
    ) {
      throw new BadRequestException(
        "SecretFlow workload requires algorithmParams.secretflowSpec",
      );
    }

    const secretflowSpec = (algorithmParams as { secretflowSpec?: unknown })
      .secretflowSpec;
    if (secretflowSpec === undefined || secretflowSpec === null) {
      throw new BadRequestException(
        "SecretFlow workload requires algorithmParams.secretflowSpec",
      );
    }

    if (!hasRequiredParties(secretflowSpec)) {
      throw new BadRequestException(
        "SecretFlow workload requires at least one valid party",
      );
    }

    if (!hasRequiredModalities(secretflowSpec)) {
      throw new BadRequestException(
        "SecretFlow workload requires at least one valid modality",
      );
    }

    if (!hasRequiredLlmBackbone(secretflowSpec)) {
      throw new BadRequestException("SecretFlow workload requires llmBackbone");
    }

    if (!hasRequiredPeftStrategy(secretflowSpec)) {
      throw new BadRequestException(
        "SecretFlow workload requires peftStrategy",
      );
    }

    if (!hasRequiredPrivacy(secretflowSpec)) {
      throw new BadRequestException(
        "SecretFlow workload requires privacy settings",
      );
    }

    if (!hasRequiredOutputPolicy(secretflowSpec)) {
      throw new BadRequestException(
        "SecretFlow workload requires outputPolicy.allowedArtifacts",
      );
    }
  }

  private hasRwsAnalysisType(
    value: unknown,
  ): value is { analysis: { type: string } } {
    if (!value || typeof value !== "object" || !("analysis" in value)) {
      return false;
    }

    const analysis = (value as { analysis?: unknown }).analysis;
    return (
      !!analysis &&
      typeof analysis === "object" &&
      "type" in analysis &&
      typeof (analysis as { type?: unknown }).type === "string" &&
      (analysis as { type: string }).type.length > 0
    );
  }
}
