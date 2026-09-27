import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TeeComputation, TeeComputationStatus } from "@medtrust/database";
import { ConfidentialComputeAttestationAdapter } from "./adapters/confidential-compute-attestation.adapter";
import {
  CreateTeeComputationDto,
  TeeComputationResponseDto,
  AttestationResponseDto,
} from "./dto/tee-computation.dto";
import { ConfigService } from "@nestjs/config";

/**
 * 控制面历史 TEE 通道。默认未注入测试通道时：`getAttestation` 把
 * `verified` / `attestationValid` 写成 false，`submitComputation` 因而被挡住。
 * 测试期可注入 `createSoftwareAttestationTestKit` 走通管线（不构成 C2 证据）。
 * 不得表述为已具备 TEE / 远程证明（CTL-09）。
 */
@Injectable()
export class TeeService {
  private readonly logger = new Logger(TeeService.name);

  constructor(
    @InjectRepository(TeeComputation)
    private readonly teeComputationRepository: Repository<TeeComputation>,
    private readonly attestationAdapter: ConfidentialComputeAttestationAdapter,
    private readonly configService: ConfigService,
  ) {}

  async createComputation(
    tenantId: number,
    dto: CreateTeeComputationDto,
  ): Promise<TeeComputationResponseDto> {
    // Create computation record
    const computation = this.teeComputationRepository.create({
      tenantId,
      name: dto.name,
      description: dto.description,
      computationType: dto.computation_type,
      computationParams: dto.computation_params || {},
      userPublicKey: dto.user_public_key,
      status: TeeComputationStatus.PROVISIONING,
    });

    await this.teeComputationRepository.save(computation);

    // Provision placeholder instance asynchronously
    this.provisionInstance(computation.id).catch((error) => {
      this.logger.error(
        `Failed to provision instance for computation ${computation.id}: ${error.message}`,
      );
    });

    return this.toResponseDto(computation);
  }

  async getComputation(
    tenantId: number,
    computationId: number,
  ): Promise<TeeComputationResponseDto> {
    const computation = await this.teeComputationRepository.findOne({
      where: { id: computationId, tenantId },
    });

    if (!computation) {
      throw new NotFoundException(`TEE computation ${computationId} not found`);
    }

    return this.toResponseDto(computation);
  }

  async getAttestation(
    tenantId: number,
    computationId: number,
  ): Promise<AttestationResponseDto> {
    const computation = await this.teeComputationRepository.findOne({
      where: { id: computationId, tenantId },
    });

    if (!computation) {
      throw new NotFoundException(`TEE computation ${computationId} not found`);
    }

    if (!computation.instanceId) {
      throw new BadRequestException(
        "Confidential-compute instance not yet provisioned",
      );
    }

    if (!computation.attestationReport) {
      // 默认部署未注入 TrustedRoot：返回 software 级占位报告，
      // verifyAttestation 走 mdop 契约，拒绝理由来自 E_ATTESTATION_FAILED / E_CAPABILITY_MISMATCH。
      const report = await this.attestationAdapter.getAttestationReport(
        computation.instanceId,
      );
      let isValid = false;
      try {
        this.attestationAdapter.verifyAttestation(report);
        isValid = true;
      } catch (error) {
        this.logger.warn(
          `attestation rejected by mdop: ${error instanceof Error ? error.message : error}`,
        );
      }

      computation.attestationReport = JSON.stringify(report);
      computation.attestationValid = isValid;
      computation.attestationVerifiedAt = new Date();
      await this.teeComputationRepository.save(computation);
    }

    return {
      instance_id: computation.instanceId,
      attestation_report: computation.attestationReport,
      verified: computation.attestationValid,
      verified_at: computation.attestationVerifiedAt,
    };
  }

  async submitComputation(
    tenantId: number,
    computationId: number,
    encryptedData: Buffer,
  ): Promise<TeeComputationResponseDto> {
    const computation = await this.teeComputationRepository.findOne({
      where: { id: computationId, tenantId },
    });

    if (!computation) {
      throw new NotFoundException(`TEE computation ${computationId} not found`);
    }

    if (computation.status !== TeeComputationStatus.READY) {
      throw new BadRequestException(
        `Cannot submit computation - status is ${computation.status}`,
      );
    }

    if (!computation.attestationValid) {
      throw new BadRequestException(
        "Attestation not verified - cannot submit computation",
      );
    }

    try {
      // Upload encrypted data to placeholder instance
      const inputPath = await this.attestationAdapter.uploadEncryptedData(
        computation.instanceId,
        encryptedData,
        computation.inputEncryptionKey,
      );

      computation.encryptedInputPath = inputPath;
      computation.status = TeeComputationStatus.RUNNING;
      computation.startedAt = new Date();
      await this.teeComputationRepository.save(computation);

      // Execute computation asynchronously
      this.executeComputation(computation.id).catch((error) => {
        this.logger.error(
          `Failed to execute computation ${computation.id}: ${error.message}`,
        );
      });

      return this.toResponseDto(computation);
    } catch (error) {
      computation.status = TeeComputationStatus.FAILED;
      computation.errorMessage = error.message;
      await this.teeComputationRepository.save(computation);
      throw error;
    }
  }

  async terminateComputation(
    tenantId: number,
    computationId: number,
  ): Promise<void> {
    const computation = await this.teeComputationRepository.findOne({
      where: { id: computationId, tenantId },
    });

    if (!computation) {
      throw new NotFoundException(`TEE computation ${computationId} not found`);
    }

    if (computation.instanceId) {
      await this.attestationAdapter.terminateInstance(computation.instanceId);
    }

    computation.status = TeeComputationStatus.TERMINATED;
    computation.terminatedAt = new Date();
    await this.teeComputationRepository.save(computation);
  }

  private async provisionInstance(computationId: number): Promise<void> {
    const computation = await this.teeComputationRepository.findOne({
      where: { id: computationId },
    });
    if (!computation) return;

    try {
      const instanceType = this.configService.get<string>(
        "ALIBABA_CLOUD_SGX_INSTANCE_TYPE",
      );
      const region = this.configService.get<string>("ALIBABA_CLOUD_REGION");
      const imageId = this.configService.get<string>(
        "ALIBABA_CLOUD_SGX_IMAGE_ID",
      );

      const instance = await this.attestationAdapter.provisionInstance({
        instance_type: instanceType,
        region,
        image_id: imageId,
      });

      computation.instanceId = instance.instance_id;
      computation.publicIp = instance.public_ip;
      computation.instanceType = instanceType;
      computation.region = region;
      computation.status = TeeComputationStatus.READY;
      computation.provisionedAt = new Date();

      await this.teeComputationRepository.save(computation);

      this.logger.log(
        `Instance provisioned for computation ${computationId}: ${instance.instance_id}`,
      );
    } catch (error) {
      computation.status = TeeComputationStatus.FAILED;
      computation.errorMessage = error.message;
      await this.teeComputationRepository.save(computation);
      throw error;
    }
  }

  private async executeComputation(computationId: number): Promise<void> {
    const computation = await this.teeComputationRepository.findOne({
      where: { id: computationId },
    });
    if (!computation) return;

    try {
      // Mock computation execution - actual implementation would:
      // 1. Trigger enclave computation via secure channel
      // 2. Wait for computation to complete
      // 3. Download encrypted result

      // Simulate computation time
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const resultPath = `/results/${Date.now()}.enc`;
      const resultBuffer =
        await this.attestationAdapter.downloadEncryptedResult(
          computation.instanceId,
          resultPath,
        );

      computation.encryptedOutputPath = resultPath;
      computation.status = TeeComputationStatus.COMPLETED;
      computation.completedAt = new Date();

      // Calculate resource usage (mock)
      const durationHours =
        (computation.completedAt.getTime() - computation.startedAt.getTime()) /
        (1000 * 60 * 60);
      computation.cpuHours = durationHours * 2; // 2 vCPUs
      computation.memoryGbHours = durationHours * 8; // 8 GB RAM
      computation.costCny = durationHours * 5; // ¥5/hour

      await this.teeComputationRepository.save(computation);

      this.logger.log(`Computation ${computationId} completed successfully`);
    } catch (error) {
      computation.status = TeeComputationStatus.FAILED;
      computation.errorMessage = error.message;
      computation.completedAt = new Date();
      await this.teeComputationRepository.save(computation);

      this.logger.error(
        `Computation ${computationId} failed: ${error.message}`,
      );
    }
  }

  private toResponseDto(
    computation: TeeComputation,
  ): TeeComputationResponseDto {
    return {
      id: computation.id,
      name: computation.name,
      status: computation.status,
      computation_type: computation.computationType,
      instance_id: computation.instanceId,
      public_ip: computation.publicIp,
      attestation_valid: computation.attestationValid,
      attestation_verified_at: computation.attestationVerifiedAt,
      encrypted_output_path: computation.encryptedOutputPath,
      cpu_hours: computation.cpuHours
        ? Number(computation.cpuHours)
        : undefined,
      cost_cny: computation.costCny ? Number(computation.costCny) : undefined,
      error_message: computation.errorMessage,
      created_at: computation.createdAt,
      started_at: computation.startedAt,
      completed_at: computation.completedAt,
    };
  }
}
