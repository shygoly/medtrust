import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComputeMethod, ComputeTask, ComputeTaskStatus, WorkloadType } from '@medtrust/database';
import { CreateComputeTaskDto } from './dto/create-compute-task.dto';
import {
  hasRequiredLlmBackbone,
  hasRequiredModalities,
  hasRequiredParties,
  hasRequiredPeftStrategy,
} from './dto/secretflow-task-spec';
import { UpdateComputeTaskDto, UpdateTaskStatusDto } from './dto/update-compute-task.dto';

@Injectable()
export class ComputeTaskService {
  constructor(
    @InjectRepository(ComputeTask)
    private computeTaskRepository: Repository<ComputeTask>,
  ) {}

  async create(tenantId: number, createDto: CreateComputeTaskDto): Promise<ComputeTask> {
    const workloadType = createDto.workloadType ?? WorkloadType.LEGACY;

    this.validateWorkloadSpec(workloadType, createDto.algorithmParams, createDto.method);

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
      relations: ['tenant'],
    });
  }

  async findByTenant(tenantId: number): Promise<ComputeTask[]> {
    return this.computeTaskRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByRequest(requestId: number): Promise<ComputeTask[]> {
    return this.computeTaskRepository.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<ComputeTask> {
    const task = await this.computeTaskRepository.findOne({
      where: { id },
      relations: ['tenant'],
    });
    if (!task) {
      throw new NotFoundException(`Compute task #${id} not found`);
    }
    return task;
  }

  async update(id: number, updateDto: UpdateComputeTaskDto): Promise<ComputeTask> {
    const task = await this.findOne(id);
    Object.assign(task, updateDto);
    return this.computeTaskRepository.save(task);
  }

  async updateStatus(id: number, statusDto: UpdateTaskStatusDto): Promise<ComputeTask> {
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
    
    if ([ComputeTaskStatus.COMPLETED, ComputeTaskStatus.FAILED, ComputeTaskStatus.CANCELLED].includes(statusDto.status)) {
      task.completedAt = new Date();
    }

    return this.computeTaskRepository.save(task);
  }

  async remove(id: number): Promise<void> {
    const task = await this.findOne(id);
    await this.computeTaskRepository.remove(task);
  }

  async getTaskStats(tenantId: number) {
    const stats = await this.computeTaskRepository
      .createQueryBuilder('task')
      .where('task.tenantId = :tenantId', { tenantId })
      .select('task.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('task.status')
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
        throw new BadRequestException('RWS workload requires algorithmParams.analysis.type');
      }
      return;
    }

    if (workloadType === WorkloadType.SECRETFLOW) {
      this.validateSecretFlowSpec(algorithmParams, method);
    }
  }

  private validateSecretFlowSpec(algorithmParams: unknown, method: ComputeMethod): void {
    if (method !== ComputeMethod.TEE && method !== ComputeMethod.MPC) {
      throw new BadRequestException('SecretFlow workload requires method to be tee or mpc');
    }

    if (!algorithmParams || typeof algorithmParams !== 'object' || !('secretflowSpec' in algorithmParams)) {
      throw new BadRequestException('SecretFlow workload requires algorithmParams.secretflowSpec');
    }

    const secretflowSpec = (algorithmParams as { secretflowSpec?: unknown }).secretflowSpec;
    if (secretflowSpec === undefined || secretflowSpec === null) {
      throw new BadRequestException('SecretFlow workload requires algorithmParams.secretflowSpec');
    }

    if (!hasRequiredParties(secretflowSpec)) {
      throw new BadRequestException('SecretFlow workload requires at least one valid party');
    }

    if (!hasRequiredModalities(secretflowSpec)) {
      throw new BadRequestException('SecretFlow workload requires at least one valid modality');
    }

    if (!hasRequiredLlmBackbone(secretflowSpec)) {
      throw new BadRequestException('SecretFlow workload requires llmBackbone');
    }

    if (!hasRequiredPeftStrategy(secretflowSpec)) {
      throw new BadRequestException('SecretFlow workload requires peftStrategy');
    }
  }

  private hasRwsAnalysisType(value: unknown): value is { analysis: { type: string } } {
    if (!value || typeof value !== 'object' || !('analysis' in value)) {
      return false;
    }

    const analysis = (value as { analysis?: unknown }).analysis;
    return (
      !!analysis &&
      typeof analysis === 'object' &&
      'type' in analysis &&
      typeof (analysis as { type?: unknown }).type === 'string' &&
      (analysis as { type: string }).type.length > 0
    );
  }
}
