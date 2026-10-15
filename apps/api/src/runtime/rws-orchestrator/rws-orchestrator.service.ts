import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { randomUUID } from "crypto";
import { sm3 } from "sm-crypto";
import {
  DigitalContract,
  RwsAssignmentEntity,
  RwsTaskEntity,
  resolveOutputPolicy,
  expandToPepArtifacts,
  levelsForPreset,
  outputLabelFromPreset,
  isExecutionIsolation,
  weakestExecutionIsolation,
  type ExecutionIsolation,
} from "@medtrust/database";
import { ContractService } from "../digital-contract/contract.service";
import { SpaceContextService } from "../space-context/space-context.service";
import {
  rowVisibleInSpace,
  spaceIdForWrite,
} from "../space-context/space-visibility";
import { AttestationService } from "../digital-contract/attestation.service";
import { ConnectorTaskNotifier } from "../connector-tasks/connector-task-notifier.service";
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
import { L0ValidationMergeService } from "./l0-validation-merge";
import {
  ConnectorContractPayload,
  ConnectorPendingTask,
  RwsAnalysisSpec,
  RwsOrchestrationRecord,
  RwsProgressStage,
  RwsTaskAssignment,
} from "./types";
import {
  computeProtocolWarnings,
  validateRwsAnalysisLadder,
  validateSapLock,
} from "../../compute-task/dto/rws-analysis-spec";
import {
  latestProgress,
  ProviderInboxItem,
  rwsResultHint,
  rwsWorkloadLabel,
} from "./provider-inbox";
import { ConnectorAuthService } from "../participant-identity/connector-auth.service";
import {
  collectEndorsements,
  endorsementRequired,
  resultEndorsementPayload,
  type ResultEndorsementInput,
} from "./result-endorsement";

/** 稳定序列化:对象键递归排序,保证连接器与平台对同一聚合结果算出同一 SM3。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** P1-6:聚合结果 SM3 指纹(稳定序列化)。测试与连接器共用同一口径。 */
export function aggregateSm3(aggregate: unknown): string {
  return sm3(stableStringify(aggregate));
}

/**
 * algorithm-sandbox:读取并校验聚合结果内部的执行隔离标注(design D7)。
 * - 缺省(旧版连接器)按 none 处理;
 * - isolation 只接受 none | wasm-sandbox,其他值一律拒绝入库;
 * - wasm-sandbox 必须带 64 hex 小写的模块 SM3。
 */
export function readExecutionAnnotation(aggregate: unknown): {
  isolation: ExecutionIsolation;
  moduleSm3?: string;
  abiVersion?: number;
} {
  const raw = (aggregate as Record<string, unknown> | null | undefined)
    ?.execution;
  if (raw === undefined || raw === null) return { isolation: "none" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("执行隔离标注非法:execution 必须是对象");
  }
  const { isolation, moduleSm3, abiVersion } = raw as {
    isolation?: unknown;
    moduleSm3?: unknown;
    abiVersion?: unknown;
  };
  if (!isExecutionIsolation(isolation)) {
    throw new BadRequestException(
      `执行隔离标注非法:isolation=${String(isolation)}(只接受 none | wasm-sandbox)`,
    );
  }
  if (isolation === "none") return { isolation };
  if (typeof moduleSm3 !== "string" || !/^[0-9a-f]{64}$/.test(moduleSm3)) {
    throw new BadRequestException(
      "执行隔离标注非法:wasm-sandbox 必须携带 64 hex 小写的模块 SM3",
    );
  }
  return {
    isolation,
    moduleSm3,
    ...(typeof abiVersion === "number" ? { abiVersion } : {}),
  };
}

@Injectable()
export class RwsOrchestratorService {
  private readonly logger = new Logger(RwsOrchestratorService.name);

  constructor(
    private readonly admission: RwsAdmissionService,
    private readonly contracts: ContractService,
    private readonly meta: MetaAnalysisService,
    private readonly l0: L0ValidationMergeService,
    @InjectRepository(RwsTaskEntity, "controlplane")
    private readonly taskRepo: Repository<RwsTaskEntity>,
    @InjectRepository(RwsAssignmentEntity, "controlplane")
    private readonly assignmentRepo: Repository<RwsAssignmentEntity>,
    @Optional() private readonly attestationService?: AttestationService,
    /** 长轮询唤醒(outbound-longpoll-agent-auth D2)。 */
    @Optional() private readonly notifier?: ConnectorTaskNotifier,
    /** on-chain-provider-endorsement:按院验连接器结果级背书签名。 */
    @Optional() private readonly connectorAuth?: ConnectorAuthService,
    @Optional() private readonly spaces?: SpaceContextService,
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

    // rws-study-protocol-spec §1.6 / §4.1: admission-time warnings (non-
    // blocking). Persisted on the task record so the report / UI can label
    // "要素不完备" / "独立性未校验". Phase 1 = advisory; Phase 2 flips the
    // relevant ones to hard rejections per analysis level.
    const protocolWarnings = computeProtocolWarnings(input.analysis);

    const admitted = await this.admission.admit(
      input.contractIds,
      input.consumerId,
      input.purpose,
      input.analysis.type,
    );
    const taskId = randomUUID();
    const spaceId = spaceIdForWrite(this.spaces?.current()?.spaceId);

    const assignments = admitted.map((contract) =>
      this.assignmentRepo.create({
        assignmentId: randomUUID(),
        taskId,
        spaceId,
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
      spaceId,
      title: input.title ?? `RWS ${input.analysis.type}`,
      purpose: input.purpose,
      analysis: input.analysis as unknown as Record<string, unknown>,
      consumerId: input.consumerId,
      contractIds: input.contractIds,
      status: "pending",
      protocolVersion: 1,
      protocolWarnings,
    });

    await this.taskRepo.save(task);
    for (const assignment of assignments) {
      await this.assignmentRepo.save(assignment);
    }
    // 长轮询唤醒(outbound-longpoll-agent-auth D2):在途领取请求立即返回。
    this.notifyProviders(assignments);
    this.logger.log(
      `任务已入队 taskId=${taskId.slice(0, 8)} providers=${assignments.map((a) => a.providerId).join(",")}`,
    );
    return toOrchestrationRecord(task, assignments);
  }

  async list(): Promise<RwsOrchestrationRecord[]> {
    const current = this.spaces?.current()?.spaceId;
    const tasks = (
      await this.taskRepo.find({ order: { createdAt: "DESC" } })
    ).filter((task) => rowVisibleInSpace(task, current));
    return Promise.all(
      tasks.map(async (task) => {
        const assignments = await this.assignmentRepo.find({
          where: { taskId: task.taskId },
        });
        return toOrchestrationRecord(task, assignments);
      }),
    );
  }

  /** P1-11:端到端审计追溯——合约→RWS 任务→执行事件→结果→链上回执。 */
  async traceByContract(contractId: string): Promise<{
    contract: DigitalContract;
    tasks: RwsOrchestrationRecord[];
  }> {
    const contract = await this.contracts.get(contractId);
    if (!contract) throw new NotFoundException("数字合约不存在");
    const current = this.spaces?.current()?.spaceId;
    const tasks = (
      await this.taskRepo.find({ order: { createdAt: "DESC" } })
    ).filter((task) => rowVisibleInSpace(task, current));
    const matched = tasks.filter((task) =>
      (task.contractIds ?? []).includes(contractId),
    );
    const records = await Promise.all(
      matched.map(async (task) => {
        const assignments = await this.assignmentRepo.find({
          where: { taskId: task.taskId },
        });
        return toOrchestrationRecord(task, assignments);
      }),
    );
    return { contract, tasks: records };
  }

  /** Provider inbox: only this hospital's assignments (no peer aggregates). */
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
        kind: "rws",
        assignmentId: a.assignmentId,
        taskId: a.taskId,
        title: task.title,
        purpose: a.purpose,
        consumerId: task.consumerId,
        workloadLabel: rwsWorkloadLabel(
          a.analysis as Record<string, unknown> | undefined,
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
        resultHint: rwsResultHint(
          a.aggregate as Record<string, unknown> | null | undefined,
        ),
      });
    }

    items.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return items;
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

    // Deterministic provider inbox order: most-recently-queued first. Each
    // assignment's `progress` carries a queued timestamp (set at creation), so
    // we sort by the newest progress event. This keeps the inbox stable across
    // re-pulls and makes `pending[0]` the newest task a provider must handle.
    pending.sort((a, b) => {
      const lastAt = (p: RwsAssignmentEntity): string => {
        const prog = (p.progress ?? []) as unknown as Array<{
          at?: string;
        }>;
        return prog.at(-1)?.at ?? "";
      };
      return lastAt(b).localeCompare(lastAt(a));
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
        // rws-study-protocol-spec Phase 3 / D1: freeze the protocol spec at
        // the moment of FIRST dispatch (any assignment transitioning pending →
        // running flips the task to running). After this, the frozen-set
        // fields (designType / tte / matchingCovariates / allowedArtifacts /
        // SAP / missingness / sensitivityAnalyses) are immutable; only a
        // /revise creating a new version can change them. Idempotent: an
        // already-frozen task (re-dispatch after partial completion) skips.
        if (!task.frozenAt) {
          task.frozenAt = new Date();
        }
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
    body: {
      aggregate?: RwsTaskAssignment["aggregate"];
      aggregateHash?: string;
      error?: string;
    } & ResultEndorsementInput,
    /** 守卫认证过的连接器证书指纹(结果级背书只认这张证书)。 */
    certFingerprint?: string,
  ): Promise<RwsOrchestrationRecord> {
    const assignment = await this.requireAssignment(assignmentId, providerId);
    if (assignment.status === "completed" || assignment.status === "failed") {
      return this.get(assignment.taskId);
    }

    // P1-6:有聚合结果必须带 SM3 哈希,验哈希后才入库(缺哈希/错哈希均拒绝)。
    let endorsement: {
      resultSm3: string;
      sig: string;
      certFingerprint: string;
    } | null = null;
    if (body.aggregate) {
      if (!body.aggregateHash) {
        throw new BadRequestException("缺少聚合结果哈希,拒绝入库");
      }
      const expected = aggregateSm3(body.aggregate);
      if (expected !== body.aggregateHash) {
        throw new BadRequestException("聚合结果哈希校验失败,拒绝入库");
      }
      // on-chain-provider-endorsement:按院验结果级背书签名。
      endorsement = await this.verifyResultEndorsement(
        assignmentId,
        providerId,
        expected,
        body,
        certFingerprint,
      );
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
      // algorithm-sandbox:执行隔离标注枚举校验(fail-closed)。
      // 缺省(旧版连接器)= none;非法值拒绝入库。
      const execution = readExecutionAnnotation(body.aggregate);
      assignment.status = "completed";
      assignment.aggregate = body.aggregate as unknown as Record<
        string,
        unknown
      >;
      assignment.executionIsolation = execution.isolation;
      assignment.moduleSm3 = execution.moduleSm3 ?? null;
      // on-chain-provider-endorsement:背书**先持久化**,链不可达也不丢,恢复后可补锚(D5)。
      assignment.resultSm3 = endorsement?.resultSm3 ?? null;
      assignment.connectorResultSig = endorsement?.sig ?? null;
      assignment.connectorCertFingerprint =
        endorsement?.certFingerprint ?? null;
      assignment.progress = appendProgress(
        (assignment.progress ?? []) as unknown as RwsTaskAssignment["progress"],
        "complete",
        `cohort=${body.aggregate.cohortSize} isolation=${execution.isolation}`,
      ) as unknown as Record<string, unknown>[];
      this.logger.log(
        `分派完成 assignment=${assignmentId.slice(0, 8)} cohort=${body.aggregate.cohortSize} isolation=${execution.isolation}`,
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

    // L2-sap-lock: a SAP that has begun freezing (declares any lock field —
    // sapVersion / frozenAt / dateStamp / modelSignature) MUST be fully
    // version-controlled + date-stamped + signed before a result can lock.
    // A SAP that is still entirely unfrozen is governed by admission-time
    // validation (Phase 1/2) and passes here (progressive freeze).
    const sap = analysis.sap;
    const beganFreeze = Boolean(
      sap &&
      (sap.sapVersion !== undefined ||
        sap.frozenAt !== undefined ||
        sap.dateStamp !== undefined ||
        sap.modelSignature !== undefined),
    );
    if (beganFreeze) {
      const lockErr = validateSapLock(sap as unknown);
      if (lockErr) throw new BadRequestException(lockErr);
    }

    // L2-sap-lock: fail closed when the run's actual model signature (as
    // reported by a connector inside an aggregate) diverges from the frozen
    // SAP-declared modelSignature. A connector that reports an actual
    // signature MUST match the frozen SAP; a connector that does not yet
    // report one is trusted (signature verification is progressive).
    const declaredSignature = (
      analysis.sap as { modelSignature?: string } | undefined
    )?.modelSignature;
    if (declaredSignature) {
      for (const a of allAssignments) {
        if (a.status !== "completed" || !a.aggregate) continue;
        const reported = (
          a.aggregate as unknown as { actualModelSignature?: unknown }
        ).actualModelSignature;
        if (reported !== undefined && String(reported) !== declaredSignature) {
          throw new BadRequestException(
            `运行日志模型签名与冻结 SAP 不一致 (L2-sap-lock mismatch)：${String(
              reported,
            )} ≠ ${declaredSignature}`,
          );
        }
      }
    }

    let metaMerge;
    if (analysis.type === "algorithm-validation") {
      // D6: L0 MUST skip random-effects meta; collect per-provider results
      // 分列 (never summed). Anchors the canonical payload on-chain.
      metaMerge = await this.l0.collectResults(task.taskId, allAssignments);
    } else if (analysis.type === "comparative-effect") {
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
            collectEndorsements(completed),
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
            collectEndorsements(completed),
          );
        }
      }
    }

    // rws-study-protocol-spec §5.1/§5.2 — sensitivity-analysis reconciliation
    // gate (EVD-10). If the protocol declared sensitivity analyses, every
    // declared id MUST have a corresponding result across the completed
    // assignments. Missing → fail-closed: task is marked failed. Selective
    // omission is the most insidious form of reporting bias (§3.5).
    const sensitivityMerge = this.reconcileSensitivityAnalyses(
      analysis,
      allAssignments,
    );
    if (sensitivityMerge.failed) {
      task.status = "failed";
      task.merged = null;
      this.logger.error(
        `敏感性分析对账失败 taskId=${task.taskId.slice(0, 8)}: ${sensitivityMerge.error}`,
      );
      await this.taskRepo.save(task);
      return toOrchestrationRecord(task, allAssignments);
    }
    // After the fail-closed guard above, the success branch is the only path.
    // Attach reconciled sensitivity results to merged for downstream display.
    if (sensitivityMerge.failed === false) {
      const { results } = sensitivityMerge;
      if (results.length > 0 && metaMerge) {
        (metaMerge as Record<string, unknown>).sensitivityAnalysesMerged =
          results;
      }
    }

    refreshTaskStatus(task, allAssignments, analysis, { metaMerge });
    // P1-6:L1 描述性任务(cohort-count/prevalence/disproportionality/ae-signal)
    // 合并结果补锚定——与 L2/L3 同一存证口径,补齐"全部 4 层任务均有链上回执"。
    await this.anchorDescriptiveMergedResult(task, analysis);
    await this.taskRepo.save(task);

    return toOrchestrationRecord(task, allAssignments);
  }

  /**
   * on-chain-provider-endorsement(task 2.1/2.3)——按院验连接器结果级背书签名。
   *
   * 渐进期(默认):无背书不破坏任务,但记 warn 告警;有背书则**必须验过**,
   * 验不过即拒该院贡献(伪造背书比没有背书更危险,任何时候都 fail-closed)。
   * `RWS_ENDORSEMENT_REQUIRED=true` 后切强制:缺背书同样拒(task 6.1)。
   */
  private async verifyResultEndorsement(
    assignmentId: string,
    providerId: string,
    resultSm3: string,
    body: ResultEndorsementInput,
    certFingerprint?: string,
  ): Promise<{
    resultSm3: string;
    sig: string;
    certFingerprint: string;
  } | null> {
    const sig = body.connectorResultSig?.trim();
    const claimedSm3 = body.resultSm3?.trim().toLowerCase();
    const required = endorsementRequired();
    const short = assignmentId.slice(0, 8);

    if (!sig) {
      if (required) {
        throw new ForbiddenException(
          "缺少连接器结果级背书签名,拒绝该院贡献(RWS_ENDORSEMENT_REQUIRED)",
        );
      }
      this.logger.warn(
        `分派 ${short} provider=${providerId} 未带结果级背书(旧版连接器),` +
          `本次存证不含该院背书 —— 升级后请切 RWS_ENDORSEMENT_REQUIRED=true`,
      );
      return null;
    }

    // 有签名就必须验过:签的对象必须是平台自己算出的结果摘要,不认连接器自报的。
    if (claimedSm3 && claimedSm3 !== resultSm3) {
      throw new ForbiddenException(
        "结果级背书的 resultSm3 与平台算得的聚合结果摘要不符,拒绝该院贡献",
      );
    }
    const fingerprint = certFingerprint?.trim();
    if (!fingerprint) {
      throw new ForbiddenException(
        "请求未携带已认证的连接器证书指纹,无法核验结果级背书",
      );
    }
    if (!this.connectorAuth) {
      throw new ForbiddenException(
        "平台未装配连接器验签服务,无法核验结果级背书(fail-closed)",
      );
    }
    const ok = await this.connectorAuth.verifyPayloadSignature(
      fingerprint,
      resultEndorsementPayload(resultSm3),
      sig,
      providerId,
    );
    if (!ok) {
      this.logger.error(
        `分派 ${short} provider=${providerId} 结果级背书验签失败,拒绝该院贡献`,
      );
      throw new ForbiddenException("连接器结果级背书验签失败,拒绝该院贡献");
    }
    return { resultSm3, sig, certFingerprint: fingerprint };
  }

  /** 描述性任务合并结果上链(结果哈希锚定;链不可达时降级本地回执)。 */
  private async anchorDescriptiveMergedResult(
    task: RwsTaskEntity,
    analysis: RwsAnalysisSpec,
  ): Promise<void> {
    if (!this.attestationService) return;
    // L1.5（disproportionality）已迁 MDOP 且旧入口按 cutoverAt 拒绝；这一段旧通道的结果锚定
    // 不再有 L1.5 可走 —— 该元素按旧接线清单（ledger legacyRefs）删除。
    // 其余三型仍在过渡窗口内，保留登记。
    const descriptiveTypes = [
      "cohort-count",
      "condition-prevalence",
      "adverse-event-signal",
    ];
    if (!descriptiveTypes.includes(analysis.type)) return;
    if (task.status !== "completed" || !task.merged) return;
    const resultHash = "SM3:" + sm3(stableStringify(task.merged));
    try {
      // algorithm-sandbox:存证元数据带执行隔离与模块 SM3 列表(attestationLevel 不变)。
      const assignments = await this.assignmentRepo.find({
        where: { taskId: task.taskId },
      });
      const completed = assignments.filter((a) => a.status === "completed");
      // on-chain-provider-endorsement(D2/task 3.2):anchor 前收集各院背书。
      const endorsements = collectEndorsements(completed);
      const receipt = await this.attestationService.anchor(
        resultHash,
        {
          executionIsolation: weakestExecutionIsolation(
            completed.map((a) => a.executionIsolation),
          ),
          moduleSm3: [
            ...new Set(
              completed
                .map((a) => a.moduleSm3)
                .filter((v): v is string => typeof v === "string" && !!v),
            ),
          ],
          ...(endorsements.length > 0 ? { endorsements } : {}),
        },
        { kind: "output", subjectType: "rws-task", subjectId: task.taskId },
      );
      (task.merged as unknown as Record<string, unknown>).attestation = {
        txHash: receipt.txHash,
        block: receipt.block,
        hash: receipt.hash,
        ...(receipt.endorsements ? { endorsements: receipt.endorsements } : {}),
        // 同一结果哈希此前已上链:回执是既有的链上记录,本次未产生新交易(如实标注)。
        ...(receipt.reused ? { reused: true } : {}),
      };
    } catch (err) {
      this.logger.warn(
        `描述性结果锚定失败,保留本地回执: ${(err as Error).message}`,
      );
    }
  }

  /**
   * rws-study-protocol-spec §5.1/§5.2 — reconcile declared sensitivity
   * analyses against returned results. Returns `{ failed: true, error }` when
   * any declared id is missing from the completed assignments' aggregates
   * (fail-closed). Returns `{ failed: false, results }` with the union of all
   * returned sensitivity results when all declared ids are present (or when
   * no sensitivity analyses were declared — §5.2: un-undeclared = exempt).
   */
  private reconcileSensitivityAnalyses(
    analysis: RwsAnalysisSpec,
    assignments: RwsAssignmentEntity[],
  ):
    | { failed: true; error: string }
    | {
        failed: false;
        results: Array<{ id: string; result: Record<string, unknown> }>;
      } {
    const declared = analysis.sensitivityAnalyses;
    if (!declared || declared.length === 0) {
      // §5.2: tasks that didn't declare any sensitivity analyses are exempt.
      return { failed: false, results: [] };
    }
    const declaredIds = new Set(declared.map((s) => s.id));

    // Collect all sensitivity-result ids across completed assignments.
    const returnedResults: Array<{
      id: string;
      result: Record<string, unknown>;
    }> = [];
    const returnedIds = new Set<string>();
    for (const a of assignments) {
      if (a.status !== "completed" || !a.aggregate) continue;
      const sensResults = (a.aggregate as Record<string, unknown>)
        ?.sensitivityResults as
        Array<{ id: string; result: Record<string, unknown> }> | undefined;
      if (!Array.isArray(sensResults)) continue;
      for (const sr of sensResults) {
        if (typeof sr.id === "string") {
          returnedIds.add(sr.id);
          returnedResults.push(sr);
        }
      }
    }

    const missing = [...declaredIds].filter((id) => !returnedIds.has(id));
    if (missing.length > 0) {
      return {
        failed: true,
        error: `敏感性分析结果缺失，结果不出域（§3.5 fail-closed）：${missing.join(", ")}`,
      };
    }
    return { failed: false, results: returnedResults };
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
        // 重排后立即唤醒该院在途的长轮询,重试不必等下一次轮询间隔。
        this.notifier?.notify(assignment.providerId);
        this.logger.warn(
          `分派超时重排 assignment=${assignment.assignmentId.slice(0, 8)} (last activity ${new Date(lastActivity).toISOString()})`,
        );
      }
    }
  }

  /**
   * rws-study-protocol-spec Phase 3 / D1 — revise a frozen (or pending)
   * protocol into a new version. Always bumps protocolVersion, requires a
   * non-empty revisionReason, re-validates the new analysis shape, drops
   * existing assignments (the new protocol must be re-dispatched), and
   * resets frozenAt (new version starts unfrozen until its own first
   * dispatch).
   *
   * Destructive: prior partial results are discarded. A revised protocol
   * invalidates any in-flight computation — the caller must confirm.
   */
  async revise(
    taskId: string,
    input: {
      analysis: RwsAnalysisSpec;
      revisionReason: string;
      contractIds?: string[];
      consumerId: string;
    },
  ): Promise<RwsOrchestrationRecord> {
    const ladderErr = validateRwsAnalysisLadder(input.analysis);
    if (ladderErr) throw new BadRequestException(ladderErr);
    if (!input.revisionReason?.trim()) {
      throw new BadRequestException("修订须填写 revisionReason（§1.2 留痕）");
    }

    const task = await this.taskRepo.findOne({ where: { taskId } });
    if (!task) throw new NotFoundException("RWS 任务不存在");
    if (task.consumerId !== input.consumerId) {
      throw new ForbiddenException("仅任务发起方可修订方案");
    }

    // The new version's contractIds either come from the body or carry over
    // from the prior version.
    const contractIds = input.contractIds?.length
      ? input.contractIds
      : task.contractIds;
    // Re-admit: contract must still be active + match purpose + consumer.
    const admitted = await this.admission.admit(
      contractIds,
      input.consumerId,
      task.purpose,
      input.analysis.type,
    );

    // Drop existing assignments — the revised protocol invalidates them.
    const oldAssignments = await this.assignmentRepo.find({
      where: { taskId },
    });
    if (oldAssignments.length > 0) {
      // delete() accepts entity ids; remove() also works on a real repository
      // but the test mock only stubs delete.
      await this.assignmentRepo.delete(
        oldAssignments.map((a) => a.assignmentId),
      );
    }

    // Build fresh assignments off the new analysis (same pattern as submit).
    const newAssignments = admitted.map((contract) =>
      this.assignmentRepo.create({
        assignmentId: randomUUID(),
        taskId,
        providerId: contract.providerId,
        purpose: task.purpose,
        analysis: input.analysis as unknown as Record<string, unknown>,
        contract: this.toConnectorContract(contract) as unknown as Record<
          string,
          unknown
        >,
        status: "pending",
        progress: appendProgress(
          [],
          "queued",
          `方案修订 v${(task.protocolVersion ?? 1) + 1} 已入队`,
        ) as unknown as Record<string, unknown>[],
      }),
    );

    // Bump version + reset execution state.
    task.analysis = input.analysis as unknown as Record<string, unknown>;
    task.contractIds = contractIds;
    task.protocolVersion = (task.protocolVersion ?? 1) + 1;
    task.revisionReason = input.revisionReason;
    task.revisedAt = new Date();
    task.frozenAt = null; // new version is unfrozen until its own dispatch
    task.status = "pending";
    task.merged = null;
    task.completedAt = null;
    task.protocolWarnings = computeProtocolWarnings(input.analysis);

    await this.taskRepo.save(task);
    for (const assignment of newAssignments) {
      await this.assignmentRepo.save(assignment);
    }
    // 修订后的新版本分派同样唤醒在途长轮询。
    this.notifyProviders(newAssignments);
    this.logger.log(
      `任务已修订 taskId=${taskId.slice(0, 8)} v${task.protocolVersion} reason="${input.revisionReason.slice(0, 40)}"`,
    );
    return toOrchestrationRecord(task, newAssignments);
  }

  /** 逐院唤醒在途长轮询(重复参与方只唤醒一次)。 */
  private notifyProviders(assignments: Array<{ providerId: string }>): void {
    if (!this.notifier) return;
    for (const providerId of new Set(assignments.map((a) => a.providerId))) {
      if (providerId) this.notifier.notify(providerId);
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

  /**
   * Task 5.5 (carry-along): look up validation metrics for an algorithm
   * referenced by an L1.5–L4 task. Searches prior completed L0 tasks for a
   * `validationResult` matching the (algorithmId, algorithmVersion, providerId)
   * triple and returns it; returns `{ status: 'unknown' }` when no match.
   *
   * Design D5: an unvalidated algorithm MUST NOT block execution. This
   * lookup is read-only decoration — callers use it to attach metrics to a
   * report, never to gate a task.
   *
   * Version binding (task 5.4): only results whose `algorithmVersion`
   * matches exactly are returned. Older versions are filtered out (historical
   * results are retained in the L0 task's `merged` data but not surfaced as
   * "current" accuracy for the new version).
   */
  async lookupValidationMetrics(
    algorithmId: string,
    algorithmVersion: string,
    providerId: string,
  ): Promise<
    { status: "found"; result: Record<string, unknown> } | { status: "unknown" }
  > {
    // Scan prior L0 tasks (analysisType=algorithm-validation). TypeORM doesn't
    // index JSON columns in SQLite, so this is a scan — fine for the volumes
    // involved (one row per L0 task, which is rare and bounded by gold-standard
    // availability, not by patient data).
    const l0Tasks = await this.taskRepo.find({
      where: { status: "completed" as never },
    });
    for (const t of l0Tasks) {
      const analysis = t.analysis as unknown as RwsAnalysisSpec;
      if (analysis.type !== "algorithm-validation") continue;
      const merged =
        (t.merged as unknown as {
          l0Validation?: { results?: Array<Record<string, unknown>> };
        }) ?? null;
      const results = merged?.l0Validation?.results;
      if (!Array.isArray(results)) continue;
      const match = results.find(
        (r) =>
          r.algorithmId === algorithmId &&
          r.algorithmVersion === algorithmVersion &&
          r.providerId === providerId,
      );
      if (match) return { status: "found", result: match };
    }
    return { status: "unknown" };
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
      // algorithm-sandbox:固定算法模块条款随合约下发(连接器据此强制沙箱路径)。
      pinnedModules:
        (contract as { pinnedModules?: Record<string, string> })
          .pinnedModules ?? undefined,
    };
  }
}
