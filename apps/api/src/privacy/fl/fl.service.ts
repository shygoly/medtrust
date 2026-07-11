import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  FederatedLearningJob,
  FederatedLearningStatus,
} from "@medtrust/database";
import { FateFlowAdapter } from "./adapters/fate-flow.adapter";
import { CreateFLJobDto, FLJobResponseDto } from "./dto/fl-job.dto";
import { Cron, CronExpression } from "@nestjs/schedule";

@Injectable()
export class FederatedLearningService {
  private readonly logger = new Logger(FederatedLearningService.name);

  constructor(
    @InjectRepository(FederatedLearningJob)
    private readonly flJobRepository: Repository<FederatedLearningJob>,
    private readonly fateFlowAdapter: FateFlowAdapter,
  ) {}

  async createJob(
    tenantId: number,
    dto: CreateFLJobDto,
  ): Promise<FLJobResponseDto> {
    // Validate participants
    if (dto.participants.length < 2) {
      throw new BadRequestException(
        "At least 2 participants required for federated learning",
      );
    }

    // Create job record
    const job = this.flJobRepository.create({
      tenantId,
      name: dto.name,
      description: dto.description,
      flType: dto.fl_type as any,
      algorithm: dto.algorithm as any,
      participants: dto.participants,
      trainingParams: dto.training_params || {},
      datasetRefs: dto.dataset_refs || [],
      status: FederatedLearningStatus.PENDING,
      totalEpochs: dto.training_params?.epochs || 10,
    });

    await this.flJobRepository.save(job);

    // Submit to FATE Flow asynchronously
    this.submitToFateFlow(job.id).catch((error) => {
      this.logger.error(
        `Failed to submit job ${job.id} to FATE Flow: ${error.message}`,
      );
    });

    return this.toResponseDto(job);
  }

  async getJob(tenantId: number, jobId: number): Promise<FLJobResponseDto> {
    const job = await this.flJobRepository.findOne({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new NotFoundException(`Federated learning job ${jobId} not found`);
    }

    return this.toResponseDto(job);
  }

  async getJobsByTenant(tenantId: number): Promise<FLJobResponseDto[]> {
    const jobs = await this.flJobRepository.find({
      where: { tenantId },
      order: { createdAt: "DESC" },
    });

    return jobs.map((job) => this.toResponseDto(job));
  }

  async downloadModel(tenantId: number, jobId: number): Promise<Buffer> {
    const job = await this.flJobRepository.findOne({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new NotFoundException(`Federated learning job ${jobId} not found`);
    }

    if (job.status !== FederatedLearningStatus.COMPLETED) {
      throw new BadRequestException("Model not ready - job not completed");
    }

    if (!job.fateJobId) {
      throw new BadRequestException("No FATE job ID available");
    }

    return this.fateFlowAdapter.downloadModel(job.fateJobId);
  }

  async cancelJob(tenantId: number, jobId: number): Promise<void> {
    const job = await this.flJobRepository.findOne({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new NotFoundException(`Federated learning job ${jobId} not found`);
    }

    if (
      job.status === FederatedLearningStatus.COMPLETED ||
      job.status === FederatedLearningStatus.FAILED ||
      job.status === FederatedLearningStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot cancel job in ${job.status} status`,
      );
    }

    if (job.fateJobId) {
      await this.fateFlowAdapter.stopJob(job.fateJobId);
    }

    job.status = FederatedLearningStatus.CANCELLED;
    await this.flJobRepository.save(job);
  }

  private async submitToFateFlow(jobId: number): Promise<void> {
    const job = await this.flJobRepository.findOne({ where: { id: jobId } });
    if (!job) return;

    try {
      const fateJobId = await this.fateFlowAdapter.submitJob({
        job_type: "train",
        algorithm: job.algorithm,
        participants: job.participants.map((p, idx) => ({
          party_id: p.party_id,
          role: idx === 0 ? "guest" : "host",
          endpoint: p.endpoint,
        })),
        training_params: job.trainingParams,
        dataset_refs: job.datasetRefs,
      });

      job.fateJobId = fateJobId;
      job.status = FederatedLearningStatus.RUNNING;
      job.startedAt = new Date();
      await this.flJobRepository.save(job);

      this.logger.log(`Job ${jobId} submitted to FATE Flow: ${fateJobId}`);
    } catch (error) {
      job.status = FederatedLearningStatus.FAILED;
      job.errorMessage = error.message;
      await this.flJobRepository.save(job);
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollJobStatus(): Promise<void> {
    const runningJobs = await this.flJobRepository.find({
      where: { status: FederatedLearningStatus.RUNNING },
    });

    for (const job of runningJobs) {
      if (!job.fateJobId) continue;

      try {
        const status = await this.fateFlowAdapter.getJobStatus(job.fateJobId);

        job.currentEpoch = status.current_epoch || job.currentEpoch;
        job.progressPercentage = status.progress;

        if (status.status === "success") {
          job.status = FederatedLearningStatus.COMPLETED;
          job.completedAt = new Date();

          // Fetch metrics
          const metrics = await this.fateFlowAdapter.getJobMetrics(
            job.fateJobId,
          );
          job.modelMetrics = metrics;

          this.logger.log(`Job ${job.id} completed successfully`);
        } else if (status.status === "failed") {
          job.status = FederatedLearningStatus.FAILED;
          job.errorMessage = status.error_message;
          job.completedAt = new Date();

          this.logger.error(`Job ${job.id} failed: ${status.error_message}`);
        }

        await this.flJobRepository.save(job);
      } catch (error) {
        this.logger.error(
          `Failed to poll status for job ${job.id}: ${error.message}`,
        );
      }
    }
  }

  private toResponseDto(job: FederatedLearningJob): FLJobResponseDto {
    return {
      id: job.id,
      name: job.name,
      status: job.status,
      fl_type: job.flType,
      algorithm: job.algorithm,
      fate_job_id: job.fateJobId,
      current_epoch: job.currentEpoch,
      total_epochs: job.totalEpochs,
      progress_percentage: job.progressPercentage
        ? Number(job.progressPercentage)
        : undefined,
      model_path: job.modelPath,
      model_metrics: job.modelMetrics,
      error_message: job.errorMessage,
      created_at: job.createdAt,
      started_at: job.startedAt,
      completed_at: job.completedAt,
    };
  }
}
