import {
  BadRequestException,
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { randomUUID } from "crypto";
import {
  ComputeTaskStatus,
  DigitalContract,
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
  resolveOutputPolicy,
  expandToPepArtifacts,
  levelsForPreset,
  outputLabelFromPreset,
} from "@medtrust/database";
import { ComputeTaskService } from "../../compute-task/compute-task.service";
import {
  isFlPartyRunResult,
  FlWeightBundle,
} from "../../compute-task/dto/fl-run-result";
import {
  FlPredictionTaskSpec,
  validateFlPrivacyPolicy,
  hasRequiredFlModelConfig,
  hasRequiredFlParties,
  hasRequiredFlFeatures,
  hasRequiredFlOutputPolicy,
} from "../../compute-task/dto/fl-prediction-task-spec";
import {
  flResultHint,
  flWorkloadLabel,
  latestProgress,
  ProviderInboxItem,
} from "../rws-orchestrator/provider-inbox";
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
    // Structural validation must run BEFORE admission — admission dereferences
    // spec.parties/featureColumns, so a partial spec (@IsObject passes any
    // object) would otherwise crash with a 500. Fail-closed with a clean 400.
    if (!hasRequiredFlModelConfig(spec)) {
      throw new BadRequestException(
        "FL prediction requires purpose, structured_ehr modality, modelType, objective, aggregation, rounds",
      );
    }
    if (!hasRequiredFlParties(spec)) {
      throw new BadRequestException(
        "FL prediction requires at least two provider parties with dataProductId",
      );
    }
    if (!hasRequiredFlFeatures(spec)) {
      throw new BadRequestException(
        "FL prediction requires targetColumn and non-empty featureColumns (target must not appear in features)",
      );
    }
    if (!hasRequiredFlOutputPolicy(spec)) {
      throw new BadRequestException(
        "FL prediction requires outputPolicy.allowedArtifacts",
      );
    }
    const privacyError = validateFlPrivacyPolicy(spec);
    if (privacyError) {
      throw new BadRequestException(privacyError);
    }
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

  /** Provider inbox: only this hospital's FL assignments. */
  async listInbox(providerId: string): Promise<ProviderInboxItem[]> {
    const assignments = await this.assignmentRepo.find({
      where: { providerId },
      order: { taskId: "DESC" },
    });
    if (!assignments.length) return [];

    const taskIds = [...new Set(assignments.map((a) => a.taskId))];
    const tasks = await this.taskRepo.find({
      where: { taskId: In(taskIds) },
    });
    const byId = new Map(tasks.map((t) => [t.taskId, t]));

    const items: ProviderInboxItem[] = [];
    for (const a of assignments) {
      const task = byId.get(a.taskId);
      if (!task) continue;
      const contract = a.contract as { id?: string } | null;
      items.push({
        kind: "fl_prediction",
        assignmentId: a.assignmentId,
        taskId: a.taskId,
        title: task.title,
        purpose: a.purpose,
        consumerId: task.consumerId,
        workloadLabel: flWorkloadLabel(
          a.flPredictionSpec as Record<string, unknown> | undefined,
        ),
        contractId: String(contract?.id ?? ""),
        status: a.status,
        error: a.error ?? undefined,
        latestProgress: latestProgress(
          a.progress as Record<string, unknown>[] | undefined,
        ),
        startedAt: a.startedAt?.toISOString(),
        completedAt: a.completedAt?.toISOString(),
        createdAt: task.createdAt.toISOString(),
        resultHint: flResultHint(
          a.partyResult as Record<string, unknown> | null | undefined,
        ),
      });
    }

    items.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return items;
  }

  async get(taskId: string): Promise<FlOrchestrationRecord> {
    const task = await this.taskRepo.findOne({ where: { taskId } });
    if (!task) throw new NotFoundException("FL 预测任务不存在");
    const assignments = await this.assignmentRepo.find({ where: { taskId } });
    return toOrchestrationRecord(task, assignments);
  }

  /**
   * Consumer downloads FedAvg weight bundle for browser-local inference.
   * Requires: task completed, caller is task consumer, at least one linked
   * contract still active with caller as consumer.
   */
  async getWeightBundle(
    taskId: string,
    consumerId: string,
  ): Promise<FlWeightBundle> {
    const task = await this.taskRepo.findOne({ where: { taskId } });
    if (!task) throw new NotFoundException("FL 预测任务不存在");
    if (task.consumerId !== consumerId) {
      throw new ForbiddenException("仅任务消费方可下载权重包");
    }
    if (task.status !== "completed" && task.status !== "partial") {
      throw new ForbiddenException("任务尚未完成，权重包不可用");
    }

    const contractIds = task.contractIds ?? [];
    let activeOk = false;
    for (const cid of contractIds) {
      const c = await this.contracts.get(cid);
      if (!c) continue;
      const effective = this.contracts.effectiveStatus(c);
      if (effective === "active" && c.consumerId === consumerId) {
        activeOk = true;
        break;
      }
    }
    if (!activeOk) {
      throw new ForbiddenException(
        "需要至少一份仍生效、且本人为消费方的数字合约",
      );
    }

    const merged = task.merged as { weightBundle?: FlWeightBundle } | null;
    const bundle = merged?.weightBundle;
    if (!bundle?.theta?.length) {
      throw new NotFoundException("该任务未产出 model_weights 权重包");
    }
    return { ...bundle, contractIds };
  }

  async pullPending(providerId: string): Promise<ConnectorPendingFlTask[]> {
    // 4.8 — reap assignments a worker pulled but never completed (crash /
    // timeout) so they can be retried instead of sticking in "running".
    await this.sweepStaleAssignments(providerId);

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
      const attested = await this.flAttestation.attestMergedResult(
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

  /**
   * 4.8 — mark FL assignments as pending again if a worker pulled them but
   * never reported progress or completed within the staleness window.
   * Handles worker crash / timeout. Threshold is FL_STALE_MS (default 5 min).
   */
  private async sweepStaleAssignments(providerId: string): Promise<void> {
    const staleMs = Number(process.env.FL_STALE_MS ?? 5 * 60_000);
    const cutoff = new Date(Date.now() - staleMs);
    const running = await this.assignmentRepo.find({
      where: { providerId, status: "running" },
    });
    for (const assignment of running) {
      const progress = (assignment.progress ??
        []) as unknown as FlTaskAssignment["progress"];
      const lastBeat = progress?.at(-1)?.at;
      const lastActivity = lastBeat
        ? new Date(lastBeat).getTime()
        : (assignment.startedAt?.getTime() ?? 0);
      if (lastActivity < cutoff.getTime()) {
        assignment.status = "pending";
        assignment.startedAt = null;
        assignment.progress = appendFlProgress(
          progress ?? [],
          "queued",
          `分派超时(${Math.round(staleMs / 1000)}s 无进度),重新入队`,
        ) as unknown as Record<string, unknown>[];
        await this.assignmentRepo.save(assignment);
        this.logger.warn(
          `FL 分派超时重排 assignment=${assignment.assignmentId.slice(0, 8)} (last activity ${new Date(lastActivity).toISOString()})`,
        );
      }
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
    const outputPolicy = resolveOutputPolicy(contract);
    return {
      id: contract.id,
      dataProductId: contract.dataProductId,
      providerId: contract.providerId,
      consumerId: contract.consumerId,
      purpose: contract.purpose,
      retention: contract.retention,
      output: outputLabelFromPreset(outputPolicy.preset),
      outputPolicy,
      allowedArtifacts: expandToPepArtifacts(outputPolicy),
      allowedLevels: levelsForPreset(outputPolicy.preset),
      minCell: outputPolicy.minCell,
      validUntil: contract.validUntil,
      status: effective === "active" ? "active" : effective,
    };
  }
}
