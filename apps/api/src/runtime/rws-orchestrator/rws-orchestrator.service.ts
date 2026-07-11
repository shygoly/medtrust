import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  DigitalContract,
  RwsAssignmentEntity,
  RwsTaskEntity,
} from "@medtrust/database";
import { ContractService } from "../digital-contract/contract.service";
import { RwsAdmissionService } from "./rws-admission.service";
import {
  appendProgress,
  refreshTaskStatus,
  toOrchestrationRecord,
  toPendingTask,
} from "./rws-persistence";
import { extractCausalSiteEffects } from "./causal-effect-merge";
import { extractSiteEffects } from "./comparative-effect-merge";
import { MetaAnalysisService } from "./meta-analysis.service";
import {
  ConnectorContractPayload,
  ConnectorPendingTask,
  RwsAnalysisSpec,
  RwsOrchestrationRecord,
  RwsProgressStage,
  RwsTaskAssignment,
} from "./types";
import { validateRwsAnalysisLadder } from "../../compute-task/dto/rws-analysis-spec";

@Injectable()
export class RwsOrchestratorService {
  private readonly logger = new Logger(RwsOrchestratorService.name);

  constructor(
    private readonly admission: RwsAdmissionService,
    private readonly contracts: ContractService,
    private readonly meta: MetaAnalysisService,
    @InjectRepository(RwsTaskEntity, "controlplane")
    private readonly taskRepo: Repository<RwsTaskEntity>,
    @InjectRepository(RwsAssignmentEntity, "controlplane")
    private readonly assignmentRepo: Repository<RwsAssignmentEntity>,
  ) {}

  async submit(input: {
    title?: string;
    purpose: string;
    analysis: RwsAnalysisSpec;
    contractIds: string[];
    consumerId: string;
  }): Promise<RwsOrchestrationRecord> {
    const ladderErr = validateRwsAnalysisLadder(input.analysis);
    if (ladderErr) throw new BadRequestException(ladderErr);

    const admitted = await this.admission.admit(
      input.contractIds,
      input.consumerId,
      input.purpose,
    );
    const taskId = randomUUID();

    const assignments = admitted.map((contract) =>
      this.assignmentRepo.create({
        assignmentId: randomUUID(),
        taskId,
        providerId: contract.providerId,
        purpose: input.purpose,
        analysis: input.analysis as unknown as Record<string, unknown>,
        contract: this.toConnectorContract(contract) as unknown as Record<
          string,
          unknown
        >,
        status: "pending",
        progress: appendProgress(
          [],
          "queued",
          "等待连接器出站拉取",
        ) as unknown as Record<string, unknown>[],
      }),
    );

    const task = this.taskRepo.create({
      taskId,
      title: input.title ?? `RWS ${input.analysis.type}`,
      purpose: input.purpose,
      analysis: input.analysis as unknown as Record<string, unknown>,
      consumerId: input.consumerId,
      contractIds: input.contractIds,
      status: "pending",
    });

    await this.taskRepo.save(task);
    for (const assignment of assignments) {
      await this.assignmentRepo.save(assignment);
    }
    this.logger.log(
      `任务已入队 taskId=${taskId.slice(0, 8)} providers=${assignments.map((a) => a.providerId).join(",")}`,
    );
    return toOrchestrationRecord(task, assignments);
  }

  async list(): Promise<RwsOrchestrationRecord[]> {
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

  async get(taskId: string): Promise<RwsOrchestrationRecord> {
    const task = await this.taskRepo.findOne({ where: { taskId } });
    if (!task) throw new NotFoundException("RWS 任务不存在");
    const assignments = await this.assignmentRepo.find({ where: { taskId } });
    return toOrchestrationRecord(task, assignments);
  }

  async pullPending(providerId: string): Promise<ConnectorPendingTask[]> {
    // 4.8 — reap assignments a worker pulled but never completed (crash /
    // timeout) so they can be retried instead of sticking in "running".
    await this.sweepStaleAssignments(providerId);

    const pending = await this.assignmentRepo.find({
      where: { providerId, status: "pending" },
    });

    const out: ConnectorPendingTask[] = [];
    for (const assignment of pending) {
      assignment.status = "running";
      assignment.startedAt = new Date();
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment["progress"],
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
      (assignment.progress ?? []) as unknown as RwsTaskAssignment["progress"],
      stage,
      detail,
    ) as unknown as Record<string, unknown>[];
    await this.assignmentRepo.save(assignment);
    this.logger.log(
      `进度 taskId=${assignment.taskId.slice(0, 8)} stage=${stage}${detail ? ` ${detail}` : ""}`,
    );
    return this.get(assignment.taskId);
  }

  async completeAssignment(
    assignmentId: string,
    providerId: string,
    body: { aggregate?: RwsTaskAssignment["aggregate"]; error?: string },
  ): Promise<RwsOrchestrationRecord> {
    const assignment = await this.requireAssignment(assignmentId, providerId);
    if (assignment.status === "completed" || assignment.status === "failed") {
      return this.get(assignment.taskId);
    }

    assignment.completedAt = new Date();
    if (body.error) {
      assignment.status = "failed";
      assignment.error = body.error;
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment["progress"],
        "failed",
        body.error,
      ) as unknown as Record<string, unknown>[];
      this.logger.warn(
        `分派失败 assignment=${assignmentId.slice(0, 8)}: ${body.error}`,
      );
    } else if (body.aggregate) {
      assignment.status = "completed";
      assignment.aggregate = body.aggregate as unknown as Record<
        string,
        unknown
      >;
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment["progress"],
        "complete",
        `cohort=${body.aggregate.cohortSize}`,
      ) as unknown as Record<string, unknown>[];
      this.logger.log(
        `分派完成 assignment=${assignmentId.slice(0, 8)} cohort=${body.aggregate.cohortSize}`,
      );
    } else {
      assignment.status = "failed";
      assignment.error = "缺少聚合结果";
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment["progress"],
        "failed",
        assignment.error,
      ) as unknown as Record<string, unknown>[];
    }

    await this.assignmentRepo.save(assignment);

    const task = await this.taskRepo.findOne({
      where: { taskId: assignment.taskId },
    });
    if (!task) throw new NotFoundException("RWS 任务不存在");
    const allAssignments = await this.assignmentRepo.find({
      where: { taskId: task.taskId },
    });
    const analysis = task.analysis as unknown as RwsAnalysisSpec;
    let metaMerge;
    if (analysis.type === "comparative-effect") {
      const completed = allAssignments.filter(
        (a) => a.status === "completed" && a.aggregate,
      );
      if (completed.length > 0) {
        const siteEffects = extractSiteEffects(
          completed.map((a) => ({
            providerId: a.providerId,
            aggregate: a.aggregate as unknown as NonNullable<
              RwsTaskAssignment["aggregate"]
            >,
          })),
        );
        if (siteEffects.length > 0) {
          metaMerge = await this.meta.mergeSiteEffects(
            siteEffects,
            task.taskId,
          );
        }
      }
    }
    if (analysis.type === "causal-psm" || analysis.type === "causal-survival") {
      const completed = allAssignments.filter(
        (a) => a.status === "completed" && a.aggregate,
      );
      if (completed.length > 0) {
        const siteEffects = extractCausalSiteEffects(
          completed.map((a) => ({
            providerId: a.providerId,
            aggregate: a.aggregate as unknown as NonNullable<
              RwsTaskAssignment["aggregate"]
            >,
          })),
        );
        if (siteEffects.length > 0) {
          metaMerge = await this.meta.mergeSiteEffects(
            siteEffects,
            task.taskId,
          );
        }
      }
    }
    refreshTaskStatus(task, allAssignments, analysis, { metaMerge });
    await this.taskRepo.save(task);

    return toOrchestrationRecord(task, allAssignments);
  }

  /**
   * 4.8 — mark assignments as pending again if a worker pulled them but never
   * reported progress or completed within the staleness window. This handles
   * the case where worker B crashed or timed out mid-task, leaving the
   * assignment stuck in "running" forever. The stale threshold is
   * RWS_STALE_MS (default 5 min); progress events reset the clock.
   */
  private async sweepStaleAssignments(providerId: string): Promise<void> {
    const staleMs = Number(process.env.RWS_STALE_MS ?? 5 * 60_000);
    const cutoff = new Date(Date.now() - staleMs);
    const running = await this.assignmentRepo.find({
      where: { providerId, status: "running" },
    });
    for (const assignment of running) {
      const progress = (assignment.progress ??
        []) as unknown as RwsTaskAssignment["progress"];
      const lastBeat = progress?.at(-1)?.at;
      const lastActivity = lastBeat
        ? new Date(lastBeat).getTime()
        : (assignment.startedAt?.getTime() ?? 0);
      if (lastActivity < cutoff.getTime()) {
        assignment.status = "pending";
        assignment.startedAt = null;
        assignment.progress = appendProgress(
          progress ?? [],
          "queued",
          `分派超时(${Math.round(staleMs / 1000)}s 无进度),重新入队`,
        ) as unknown as Record<string, unknown>[];
        await this.assignmentRepo.save(assignment);
        this.logger.warn(
          `分派超时重排 assignment=${assignment.assignmentId.slice(0, 8)} (last activity ${new Date(lastActivity).toISOString()})`,
        );
      }
    }
  }

  private async requireAssignment(
    assignmentId: string,
    providerId: string,
  ): Promise<RwsAssignmentEntity> {
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
