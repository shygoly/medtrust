import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComputeTask, ComputeTaskStatus } from '@medtrust/database';
import { CreateComputeTaskDto } from './dto/create-compute-task.dto';
import { UpdateComputeTaskDto, UpdateTaskStatusDto } from './dto/update-compute-task.dto';

@Injectable()
export class ComputeTaskService {
  constructor(
    @InjectRepository(ComputeTask)
    private computeTaskRepository: Repository<ComputeTask>,
  ) {}

  async create(tenantId: number, createDto: CreateComputeTaskDto): Promise<ComputeTask> {
    const task = this.computeTaskRepository.create({
      ...createDto,
      tenantId,
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
}
