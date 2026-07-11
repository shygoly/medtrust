import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  ComputeTaskStatus,
  DigitalContract,
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
} from "@medtrust/database";
import { ComputeTaskService } from "../../compute-task/compute-task.service";
import { isFlPartyRunResult } from "../../compute-task/dto/fl-run-result";
import { FlPredictionTaskSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import { ContractService } from "../digital-contract/contract.service";
import { FlAdmissionService } from "./fl-admission.service";
import { FlAttestationService } from "./fl-attestation.service";
import { FlRunResult } from "../../compute-task/dto/fl-run-result";
import {
  appendFlProgress,
  refreshFlTaskStatus,
  toOrchestrationRecord,
  toPendingFlTask,
} from "./fl-persistence";
import {
  ConnectorContractPayload,
  ConnectorPendingFlTask,
  FlOrchestrationRecord,
  FlProgressStage,
  FlTaskAssignment,
} from "./types";

@Injectable()
export class FlOrchestratorService {
  private readonly logger = new Logger(FlOrchestratorService.name);

  constructor(
    private readonly admission: FlAdmissionService,
    private readonly contracts: ContractService,
    private readonly computeTasks: ComputeTaskService,
    private readonly flAttestation: FlAttestationService,
    @InjectRepository(FlPredictionTaskEntity, "controlplane")
    private readonly taskRepo: Repository<FlPredictionTaskEntity>,
    @InjectRepository(FlPredictionAssignmentEntity, "controlplane")
    private readonly assignmentRepo: Repository<FlPredictionAssignmentEntity>,
  ) {}

  async submit(input: {
    title?: string;
    flPredictionSpec: FlPredictionTaskSpec;
    contractIds: string[];
    consumerId: string;
    computeTaskId?: number;
  }): Promise<FlOrchestrationRecord> {
    const spec = input.flPredictionSpec;
    const admitted = await this.admission.admit(
      input.contractIds,
      input.consumerId,
      spec,
    );
    const taskId = randomUUID();

    const assignments = admitted.map((contract) =>
      this.assignmentRepo.create({
        assignmentId: randomUUID(),
        taskId,
        providerId: contract.providerId,
        purpose: spec.purpose,
        flPredictionSpec: spec as unknown as Record<string, unknown>,
        contract: this.toConnectorContract(contract) as unknown as Record<
          string,
          unknown
        >,
        status: "pending",
        progress: appendFlProgress(
          [],
          "queued",
          "等待连接器出站拉取",
        ) as unknown as Record<string, unknown>[],
      }),
    );

    const task = this.taskRepo.create({
      taskId,
      title: input.title ?? `FL ${spec.modelType}`,
      purpose: spec.purpose,
      flPredictionSpec: spec as unknown as Record<string, unknown>,
      consumerId: input.consumerId,
      contractIds: input.contractIds,
      computeTaskId: input.computeTaskId ?? null,
      status: "pending",
    });

    await this.taskRepo.save(task);
    for (const assignment of assignments) {
      await this.assignmentRepo.save(assignment);
    }

    if (input.computeTaskId) {
      await this.computeTasks.updateStatus(input.computeTaskId, {
        status: ComputeTaskStatus.RUNNING,
      });
    }

    this.logger.log(
      `FL 任务已入队 taskId=${taskId.slice(0, 8)} providers=${assignments.map((a) => a.providerId).join(",")}`,
    );
    return toOrchestrationRecord(task, assignments);
  }

  async list(): Promise<FlOrchestrationRecord[]> {
    const tasks = await this.taskRepo.find({ order: { createdAt: "DESC" } });
    return Promise.all(
      tasks.map(async (task) => {
        const assignments = await this.assignmentRepo.find({
          where: { taskId: task.taskId },
        });
        return toOrchestrationRecord(task, assignments);
      }),
    );
  }

  async get(taskId: string): Promise<FlOrchestrationRecord> {
    const task = await this.taskRepo.findOne({ where: { taskId } });
    if (!task) throw new NotFoundException("FL 预测任务不存在");
    const assignments = await this.assignmentRepo.find({ where: { taskId } });
    return toOrchestrationRecord(task, assignments);
  }

  async pullPending(providerId: string): Promise<ConnectorPendingFlTask[]> {
    const pending = await this.assignmentRepo.find({
      where: { providerId, status: "pending" },
    });

    const out: ConnectorPendingFlTask[] = [];
    for (const assignment of pending) {
      assignment.status = "running";
      assignment.startedAt = new Date();
      assignment.progress = appendFlProgress(
        (assignment.progress ?? []) as unknown as FlTaskAssignment["progress"],
        "pulled",
        `连接器 ${providerId} 已拉取`,
      ) as unknown as Record<string, unknown>[];
      await this.assignmentRepo.save(assignment);

      const task = await this.taskRepo.findOne({
        where: { taskId: assignment.taskId },
      });
      if (task && task.status === "pending") {
        task.status = "running";
        await this.taskRepo.save(task);
      }

      this.logger.log(
        `FL 分派已拉取 taskId=${assignment.taskId.slice(0, 8)} assignment=${assignment.assignmentId.slice(0, 8)} provider=${providerId}`,
      );
      out.push(toPendingFlTask(assignment));
    }
    return out;
  }

  async reportProgress(
    assignmentId: string,
    providerId: string,
    stage: FlProgressStage,
    detail?: string,
  ): Promise<FlOrchestrationRecord> {
    const assignment = await this.requireAssignment(assignmentId, providerId);
    assignment.progress = appendFlProgress(
      (assignment.progress ?? []) as unknown as FlTaskAssignment["progress"],
      stage,
      detail,
    ) as unknown as Record<string, unknown>[];
    await this.assignmentRepo.save(assignment);
    return this.get(assignment.taskId);
  }

  async completeAssignment(
    assignmentId: string,
    providerId: string,
    body: { partyResult?: unknown; error?: string },
  ): Promise<FlOrchestrationRecord> {
    const assignment = await this.requireAssignment(assignmentId, providerId);
    if (assignment.status === "completed" || assignment.status === "failed") {
      return this.get(assignment.taskId);
    }

    assignment.completedAt = new Date();
    if (body.error) {
      assignment.status = "failed";
      assignment.error = body.error;
      assignment.progress = appendFlProgress(
        (assignment.progress ?? []) as unknown as FlTaskAssignment["progress"],
        "failed",
        body.error,
      ) as unknown as Record<string, unknown>[];
    } else if (body.partyResult && isFlPartyRunResult(body.partyResult)) {
      assignment.status = "completed";
      assignment.partyResult = body.partyResult as unknown as Record<
        string,
        unknown
      >;
      assignment.progress = appendFlProgress(
        (assignment.progress ?? []) as unknown as FlTaskAssignment["progress"],
        "complete",
        `samples=${body.partyResult.sampleCount}`,
      ) as unknown as Record<string, unknown>[];
    } else {
      assignment.status = "failed";
      assignment.error = "缺少或无效的 partyResult";
      assignment.progress = appendFlProgress(
        (assignment.progress ?? []) as unknown as FlTaskAssignment["progress"],
        "failed",
        assignment.error,
      ) as unknown as Record<string, unknown>[];
    }

    await this.assignmentRepo.save(assignment);

    const task = await this.taskRepo.findOne({
      where: { taskId: assignment.taskId },
    });
    if (!task) throw new NotFoundException("FL 预测任务不存在");
    const allAssignments = await this.assignmentRepo.find({
      where: { taskId: task.taskId },
    });
    const spec = task.flPredictionSpec as unknown as FlPredictionTaskSpec;
    refreshFlTaskStatus(task, allAssignments, spec);
    if (task.status === "completed" && task.merged) {
      const attested = this.flAttestation.attestMergedResult(
        task.merged as unknown as FlRunResult,
        task.taskId,
      );
      task.merged = attested as unknown as Record<string, unknown>;
      task.resultSummary = {
        ...(task.resultSummary ?? {}),
        attestationReportHash: attested.attestation?.reportHash,
        chainTxHash: attested.attestation?.chainTxHash,
      };
    }
    await this.taskRepo.save(task);

    await this.syncComputeTask(task);

    return toOrchestrationRecord(task, allAssignments);
  }

  private async syncComputeTask(task: FlPredictionTaskEntity): Promise<void> {
    if (!task.computeTaskId) {
      return;
    }

    if (task.status === "completed" && task.resultSummary) {
      await this.computeTasks.updateStatus(task.computeTaskId, {
        status: ComputeTaskStatus.COMPLETED,
        resultSummary: task.resultSummary,
      });
      return;
    }

    if (task.status === "failed") {
      await this.computeTasks.updateStatus(task.computeTaskId, {
        status: ComputeTaskStatus.FAILED,
        errorMessage: "FL prediction orchestration failed",
      });
    }
  }

  private async requireAssignment(
    assignmentId: string,
    providerId: string,
  ): Promise<FlPredictionAssignmentEntity> {
    const assignment = await this.assignmentRepo.findOne({
      where: { assignmentId },
    });
    if (!assignment) throw new NotFoundException("任务分派不存在");
    if (assignment.providerId !== providerId) {
      throw new NotFoundException("任务分派与连接器参与方不匹配");
    }
    return assignment;
  }

  private toConnectorContract(
    contract: DigitalContract,
  ): ConnectorContractPayload {
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
      status: effective === "active" ? "active" : effective,
    };
  }
}
