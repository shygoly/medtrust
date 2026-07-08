import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DigitalContract, RwsAssignmentEntity, RwsTaskEntity } from '@medtrust/database';
import { ContractService } from '../digital-contract/contract.service';
import { RwsAdmissionService } from './rws-admission.service';
import {
  appendProgress,
  refreshTaskStatus,
  toOrchestrationRecord,
  toPendingTask,
} from './rws-persistence';
import {
  ConnectorContractPayload,
  ConnectorPendingTask,
  RwsAnalysisSpec,
  RwsOrchestrationRecord,
  RwsProgressStage,
  RwsTaskAssignment,
} from './types';

@Injectable()
export class RwsOrchestratorService {
  private readonly logger = new Logger(RwsOrchestratorService.name);

  constructor(
    private readonly admission: RwsAdmissionService,
    private readonly contracts: ContractService,
    @InjectRepository(RwsTaskEntity, 'controlplane')
    private readonly taskRepo: Repository<RwsTaskEntity>,
    @InjectRepository(RwsAssignmentEntity, 'controlplane')
    private readonly assignmentRepo: Repository<RwsAssignmentEntity>,
  ) {}

  async submit(input: {
    title?: string;
    purpose: string;
    analysis: RwsAnalysisSpec;
    contractIds: string[];
    consumerId: string;
  }): Promise<RwsOrchestrationRecord> {
    const admitted = await this.admission.admit(input.contractIds, input.consumerId, input.purpose);
    const taskId = randomUUID();

    const assignments = admitted.map((contract) =>
      this.assignmentRepo.create({
        assignmentId: randomUUID(),
        taskId,
        providerId: contract.providerId,
        purpose: input.purpose,
        analysis: input.analysis as unknown as Record<string, unknown>,
        contract: this.toConnectorContract(contract) as unknown as Record<string, unknown>,
        status: 'pending',
        progress: appendProgress([], 'queued', '等待连接器出站拉取') as unknown as Record<
          string,
          unknown
        >[],
      }),
    );

    const task = this.taskRepo.create({
      taskId,
      title: input.title ?? `RWS ${input.analysis.type}`,
      purpose: input.purpose,
      analysis: input.analysis as unknown as Record<string, unknown>,
      consumerId: input.consumerId,
      contractIds: input.contractIds,
      status: 'pending',
    });

    await this.taskRepo.save(task);
    for (const assignment of assignments) {
      await this.assignmentRepo.save(assignment);
    }
    this.logger.log(
      `任务已入队 taskId=${taskId.slice(0, 8)} providers=${assignments.map((a) => a.providerId).join(',')}`,
    );
    return toOrchestrationRecord(task, assignments);
  }

  async list(): Promise<RwsOrchestrationRecord[]> {
    const tasks = await this.taskRepo.find({ order: { createdAt: 'DESC' } });
    return Promise.all(
      tasks.map(async (task) => {
        const assignments = await this.assignmentRepo.find({ where: { taskId: task.taskId } });
        return toOrchestrationRecord(task, assignments);
      }),
    );
  }

  async get(taskId: string): Promise<RwsOrchestrationRecord> {
    const task = await this.taskRepo.findOne({ where: { taskId } });
    if (!task) throw new NotFoundException('RWS 任务不存在');
    const assignments = await this.assignmentRepo.find({ where: { taskId } });
    return toOrchestrationRecord(task, assignments);
  }

  async pullPending(providerId: string): Promise<ConnectorPendingTask[]> {
    const pending = await this.assignmentRepo.find({
      where: { providerId, status: 'pending' },
    });

    const out: ConnectorPendingTask[] = [];
    for (const assignment of pending) {
      assignment.status = 'running';
      assignment.startedAt = new Date();
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment['progress'],
        'pulled',
        `连接器 ${providerId} 已拉取`,
      ) as unknown as Record<string, unknown>[];
      await this.assignmentRepo.save(assignment);

      const task = await this.taskRepo.findOne({ where: { taskId: assignment.taskId } });
      if (task && task.status === 'pending') {
        task.status = 'running';
        await this.taskRepo.save(task);
      }

      this.logger.log(
        `分派已拉取 taskId=${assignment.taskId.slice(0, 8)} assignment=${assignment.assignmentId.slice(0, 8)} provider=${providerId}`,
      );
      out.push(toPendingTask(assignment));
    }
    return out;
  }

  async reportProgress(
    assignmentId: string,
    providerId: string,
    stage: RwsProgressStage,
    detail?: string,
  ): Promise<RwsOrchestrationRecord> {
    const assignment = await this.requireAssignment(assignmentId, providerId);
    assignment.progress = appendProgress(
      (assignment.progress ?? []) as unknown as RwsTaskAssignment['progress'],
      stage,
      detail,
    ) as unknown as Record<string, unknown>[];
    await this.assignmentRepo.save(assignment);
    this.logger.log(
      `进度 taskId=${assignment.taskId.slice(0, 8)} stage=${stage}${detail ? ` ${detail}` : ''}`,
    );
    return this.get(assignment.taskId);
  }

  async completeAssignment(
    assignmentId: string,
    providerId: string,
    body: { aggregate?: RwsTaskAssignment['aggregate']; error?: string },
  ): Promise<RwsOrchestrationRecord> {
    const assignment = await this.requireAssignment(assignmentId, providerId);
    if (assignment.status === 'completed' || assignment.status === 'failed') {
      return this.get(assignment.taskId);
    }

    assignment.completedAt = new Date();
    if (body.error) {
      assignment.status = 'failed';
      assignment.error = body.error;
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment['progress'],
        'failed',
        body.error,
      ) as unknown as Record<string, unknown>[];
      this.logger.warn(`分派失败 assignment=${assignmentId.slice(0, 8)}: ${body.error}`);
    } else if (body.aggregate) {
      assignment.status = 'completed';
      assignment.aggregate = body.aggregate as Record<string, unknown>;
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment['progress'],
        'complete',
        `cohort=${body.aggregate.cohortSize}`,
      ) as unknown as Record<string, unknown>[];
      this.logger.log(
        `分派完成 assignment=${assignmentId.slice(0, 8)} cohort=${body.aggregate.cohortSize}`,
      );
    } else {
      assignment.status = 'failed';
      assignment.error = '缺少聚合结果';
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment['progress'],
        'failed',
        assignment.error,
      ) as unknown as Record<string, unknown>[];
    }

    await this.assignmentRepo.save(assignment);

    const task = await this.taskRepo.findOne({ where: { taskId: assignment.taskId } });
    if (!task) throw new NotFoundException('RWS 任务不存在');
    const allAssignments = await this.assignmentRepo.find({ where: { taskId: task.taskId } });
    refreshTaskStatus(task, allAssignments, task.analysis as unknown as RwsAnalysisSpec);
    await this.taskRepo.save(task);

    return toOrchestrationRecord(task, allAssignments);
  }

  private async requireAssignment(
    assignmentId: string,
    providerId: string,
  ): Promise<RwsAssignmentEntity> {
    const assignment = await this.assignmentRepo.findOne({ where: { assignmentId } });
    if (!assignment) throw new NotFoundException('任务分派不存在');
    if (assignment.providerId !== providerId) {
      throw new NotFoundException('任务分派与连接器参与方不匹配');
    }
    return assignment;
  }

  private toConnectorContract(contract: DigitalContract): ConnectorContractPayload {
    const effective = this.contracts.effectiveStatus(contract);
    return {
      id: contract.id,
      dataProductId: contract.dataProductId,
      providerId: contract.providerId,
      consumerId: contract.consumerId,
      purpose: contract.purpose,
      retention: contract.retention,
      output: contract.output,
      validUntil: contract.validUntil,
      status: effective === 'active' ? 'active' : effective,
    };
  }
}
