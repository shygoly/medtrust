import { currentSpaceId } from "../../runtime/space-context/space-id.util";
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  MdopAggregateContributionEntity,
  MdopJobEntity,
  MdopOutboxEntity,
  MdopStageEntity,
} from "@medtrust/database";
import {
  MdopError,
  acceptContribution,
  assertJobTransition,
  assertStageTransition,
  expireAggregate,
  noteAggregateFinished,
  readAggregateBinding,
  rejectAggregate,
  serializeAggregateRequest,
  sm3Hex,
  startAggregating,
  type AggregateBinding,
  type AggregateMachineState,
} from "@medtrust/mdop";
import { MdopPurgeService } from "../mdop-purge.service";

/** 密文 blob 保留 72 小时（协议 v0.3 §7.7.5）。 */
export const AGGREGATE_BLOB_TTL_MS = 72 * 60 * 60 * 1000;

/** 密文 blob 大小上限（缺省 100 MB）。 */
export const AGGREGATE_MAX_BLOB_SIZE =
  Number(process.env.MDOP_MAX_CONTRIBUTION_SIZE) || 100 * 1024 * 1024;

export interface ContributionUpload {
  jobId: string;
  stageId: string;
  contributorId: string;
  /** base64 密文字节。平台只核对摘要，不解析内容。 */
  ciphertext: string;
  digest: string;
  partialSignature: string;
}

@Injectable()
export class AggregateSchedulerService {
  private readonly logger = new Logger(AggregateSchedulerService.name);

  constructor(
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(MdopStageEntity, "controlplane")
    private readonly stages: Repository<MdopStageEntity>,
    @InjectRepository(MdopOutboxEntity, "controlplane")
    private readonly outbox: Repository<MdopOutboxEntity>,
    @InjectRepository(MdopAggregateContributionEntity, "controlplane")
    private readonly contributions: Repository<MdopAggregateContributionEntity>,
    @Optional() private readonly purge?: MdopPurgeService,
  ) {}

  /** PENDING → AGGREGATING，向每个参与方下发 AggregateRequest。 */
  async begin(
    job: MdopJobEntity,
    stage: MdopStageEntity,
    ticketId: string,
  ): Promise<void> {
    const binding = this.binding(stage);
    const now = Date.now();
    const next = startAggregating(
      {
        phase: "PENDING",
        parties: binding.parties,
        received: [],
        finished: [],
        deadlineMs: now + binding.timeout_s * 1000,
      },
      now,
    );
    assertStageTransition("PENDING", "AGGREGATING");
    await this.persistMachine(stage, next);
    for (const party of binding.parties) {
      await this.enqueue({
        msgType: "AggregateRequest",
        receiver: party,
        jobId: job.id,
        idempotencyKey: `${job.id}:${stage.stageId}:request:${party}`,
        body: {
          ticket_id: ticketId,
          ...serializeAggregateRequest({
            stage_id: stage.stageId,
            op: stage.opRef,
            spec: {
              algorithm: binding.algorithm,
              params: {},
              parties: [...binding.parties],
              timeout_s: binding.timeout_s,
              encryption: binding.encryption,
            },
          }),
        },
      });
    }
  }

  /** 节点上传密文。收齐后下发 AggregateResult；超时或缺人则整个聚合 REJECTED。 */
  async upload(
    input: ContributionUpload,
    now = new Date(),
  ): Promise<{ contributionRef: string }> {
    const stage = await this.mustStage(input.jobId, input.stageId);
    const binding = this.binding(stage);
    const machine = expireAggregate(
      this.machine(stage, binding),
      now.getTime(),
    );
    if (machine.phase === "REJECTED") {
      await this.rejectStage(stage, machine, "E_TIMEOUT: 聚合贡献超时");
      throw new MdopError("E_TIMEOUT", {}, "聚合贡献超时，未做部分合并");
    }
    if (!binding.parties.includes(input.contributorId)) {
      await this.rejectStage(
        stage,
        rejectAggregate(machine),
        "E_AUTH_INVALID: 非参与方上传贡献",
      );
      throw new MdopError(
        "E_AUTH_INVALID",
        {},
        "贡献方不在编译期闭合的参与方列表里",
      );
    }
    const bytes = Buffer.from(input.ciphertext, "base64");
    if (bytes.length === 0) throw new BadRequestException("密文为空");

    // 协议 v0.3 §7.7.5：密文 blob 大小上限
    if (bytes.length > AGGREGATE_MAX_BLOB_SIZE) {
      await this.rejectStage(
        stage,
        rejectAggregate(machine),
        `E_PAYLOAD_TOO_LARGE: 密文大小 ${bytes.length} 超过上限 ${AGGREGATE_MAX_BLOB_SIZE}`,
      );
      throw new MdopError(
        "E_PAYLOAD_TOO_LARGE",
        { size: bytes.length, limit: AGGREGATE_MAX_BLOB_SIZE },
        `密文大小 ${(bytes.length / 1024 / 1024).toFixed(2)} MB 超过上限 ${(AGGREGATE_MAX_BLOB_SIZE / 1024 / 1024).toFixed(0)} MB`,
      );
    }
    const digest = `sm3:${sm3Hex(bytes)}`;
    if (input.digest !== digest)
      throw new MdopError("E_LABEL_VIOLATION", {}, "密文摘要与上传内容不一致");
    if (!input.partialSignature) throw new BadRequestException("缺少贡献签名");

    const existing = (
      await this.contributions.find({
        where: {
          jobId: input.jobId,
          stageId: input.stageId,
          contributorId: input.contributorId,
        },
      })
    )[0];
    if (existing) {
      if (existing.digest !== digest) {
        await this.rejectStage(
          stage,
          rejectAggregate(machine),
          "E_LABEL_VIOLATION: 同一参与方提交了不同密文",
        );
        throw new MdopError("E_LABEL_VIOLATION", {}, "同一参与方的密文不一致");
      }
      return { contributionRef: existing.contributionRef };
    }

    const id = randomUUID();
    const contributionRef = `blob://${id}`;
    await this.contributions.save(
      this.contributions.create({
        id,
        contributionRef,
        jobId: input.jobId,
        stageId: input.stageId,
        contributorId: input.contributorId,
        digest,
        partialSignature: input.partialSignature,
        ciphertext: input.ciphertext,
        expiresAt: new Date(now.getTime() + AGGREGATE_BLOB_TTL_MS),
      }),
    );
    const next = acceptContribution(
      machine,
      input.contributorId,
      now.getTime(),
    );
    await this.persistMachine(stage, next);
    if (next.phase === "AGGREGATED") await this.fanoutResult(stage, binding);
    if (next.phase === "REJECTED")
      await this.rejectStage(stage, next, "E_TIMEOUT: 聚合贡献未收齐");
    return { contributionRef };
  }

  /** 按句柄取回密文。过期视为已清理。 */
  async download(
    contributionRef: string,
    now = new Date(),
  ): Promise<{
    contributionRef: string;
    ciphertext: string;
    digest: string;
  }> {
    const row = await this.contributions.findOne({
      where: { contributionRef },
    });
    if (!row || row.expiresAt.getTime() <= now.getTime())
      throw new BadRequestException("密文不存在或已过期");
    return {
      contributionRef: row.contributionRef,
      ciphertext: row.ciphertext,
      digest: row.digest,
    };
  }

  /** 节点完成本地聚合，或因解密失败拒绝。 */
  async onNodeReport(
    job: MdopJobEntity,
    stage: MdopStageEntity,
    input: {
      reporter: string;
      status: string;
      code?: string;
      message?: string;
    },
  ): Promise<{ stage: string; jobStatus: string }> {
    const binding = this.binding(stage);
    if (!binding.parties.includes(input.reporter))
      throw new BadRequestException("上报方不是该聚合阶段的参与方");
    const machine = this.machine(stage, binding);
    if (input.status === "FAILED" || input.status === "RUNNING") {
      const rejected = rejectAggregate(machine);
      await this.rejectStage(
        stage,
        rejected,
        `${input.code ?? "E_RUNTIME"}: ${input.message ?? "节点拒绝聚合"}`,
      );
      return { stage: "REJECTED", jobStatus: "REJECTED" };
    }
    const next = noteAggregateFinished(machine, input.reporter);
    await this.persistMachine(stage, next);
    if (next.phase === "SUCCEEDED") {
      const jobStatus = await this.completeJob(job);
      return { stage: next.phase, jobStatus };
    }
    return { stage: next.phase, jobStatus: job.status };
  }

  /** 扫描超时的 AGGREGATING 阶段。缺贡献则 REJECTED，不合并已收到的部分。 */
  async sweepTimeouts(now = new Date()): Promise<number> {
    const rows = await this.stages.find({ where: { status: "AGGREGATING" } });
    let rejected = 0;
    for (const stage of rows) {
      const binding = readAggregateBinding(stage.params);
      if (!binding) continue;
      const next = expireAggregate(this.machine(stage, binding), now.getTime());
      if (next.phase !== "REJECTED") continue;
      await this.rejectStage(stage, next, "E_TIMEOUT: 聚合贡献超时");
      rejected += 1;
    }
    await this.sweepExpiredBlobs(now);
    return rejected;
  }

  async sweepExpiredBlobs(now = new Date()): Promise<number> {
    const rows = await this.contributions.find();
    let removed = 0;
    for (const row of rows) {
      if (row.expiresAt.getTime() > now.getTime()) continue;
      await this.contributions.delete({ id: row.id });
      removed += 1;
    }
    return removed;
  }

  /** 聚合阶段已产出 C3，且作业没有别的未完成阶段时，按释放路径收口。 */
  private async completeJob(job: MdopJobEntity): Promise<string> {
    const stages = await this.stages.find({ where: { jobId: job.id } });
    if (stages.some((row) => row.status !== "SUCCEEDED")) return job.status;
    let status = job.status;
    if (status === "TICKETED") {
      assertJobTransition("TICKETED", "RUNNING");
      status = "RUNNING";
    }
    if (status === "RUNNING") {
      assertJobTransition("RUNNING", "RELEASING");
      status = "RELEASING";
    }
    if (status === "RELEASING") {
      assertJobTransition("RELEASING", "SUCCEEDED");
      status = "SUCCEEDED";
    }
    if (status !== job.status) {
      await this.jobs.update({ id: job.id }, { status, updatedAt: new Date() });
      job.status = status;
    }
    return job.status;
  }

  private binding(stage: MdopStageEntity): AggregateBinding {
    const binding = readAggregateBinding(stage.params);
    if (!binding) throw new MdopError("E_RUNTIME", {}, "阶段没有聚合绑定");
    return binding;
  }

  private machine(
    stage: MdopStageEntity,
    binding: AggregateBinding,
  ): AggregateMachineState {
    const runtime = (stage.params.aggregate_runtime ?? {}) as {
      received?: string[];
      finished?: string[];
      deadlineMs?: number;
    };
    const phase = stage.status as AggregateMachineState["phase"];
    return {
      phase,
      parties: binding.parties,
      received: runtime.received ?? [],
      finished: runtime.finished ?? [],
      deadlineMs: runtime.deadlineMs ?? 0,
    };
  }

  private async persistMachine(
    stage: MdopStageEntity,
    machine: AggregateMachineState,
  ): Promise<void> {
    const params = {
      ...stage.params,
      aggregate_runtime: {
        received: [...machine.received],
        finished: [...machine.finished],
        deadlineMs: machine.deadlineMs,
      },
    };
    stage.status = machine.phase;
    stage.params = params;
    await this.stages.update(
      { id: stage.id },
      { status: machine.phase, params, updatedAt: new Date() },
    );
  }

  private async fanoutResult(
    stage: MdopStageEntity,
    binding: AggregateBinding,
  ): Promise<void> {
    const rows = await this.contributions.find({
      where: { jobId: stage.jobId, stageId: stage.stageId },
    });
    const contribution_refs = binding.parties.map((party) => {
      const row = rows.find((item) => item.contributorId === party);
      if (!row)
        throw new MdopError("E_RUNTIME", {}, `缺少 ${party} 的密文句柄`);
      return {
        contributor_id: party,
        contribution_ref: row.contributionRef,
        digest: row.digest,
      };
    });
    for (const party of binding.parties) {
      await this.enqueue({
        msgType: "AggregateResult",
        receiver: party,
        jobId: stage.jobId,
        idempotencyKey: `${stage.jobId}:${stage.stageId}:result:${party}`,
        body: { stage_id: stage.stageId, complete: true, contribution_refs },
      });
    }
  }

  private async rejectStage(
    stage: MdopStageEntity,
    machine: AggregateMachineState,
    reason: string,
  ): Promise<void> {
    await this.persistMachine(stage, { ...machine, phase: "REJECTED" });
    const job = await this.jobs.findOne({ where: { id: stage.jobId } });
    if (job && (job.status === "RUNNING" || job.status === "TICKETED")) {
      if (job.status === "TICKETED") {
        assertJobTransition("TICKETED", "RUNNING");
        job.status = "RUNNING";
      }
      assertJobTransition("RUNNING", "REJECTED");
      await this.jobs.update(
        { id: job.id },
        { status: "REJECTED", rejectReason: reason, updatedAt: new Date() },
      );
    }
    const rows = await this.contributions.find({
      where: { jobId: stage.jobId, stageId: stage.stageId },
    });
    for (const row of rows) await this.contributions.delete({ id: row.id });
    for (const msgType of [
      "AggregateRequest",
      "AggregateResult",
      "StageDispatch",
    ]) {
      const pending = await this.outbox.find({
        where: { job_id: stage.jobId, msg_type: msgType },
      });
      for (const row of pending) await this.outbox.delete({ id: row.id });
    }
    this.logger.warn(
      `聚合阶段 ${stage.jobId}#${stage.stageId} 拒绝：${reason}`,
    );
    await this.purge
      ?.orchestratePurge(stage.jobId)
      .catch((err) =>
        this.logger.error(`销毁编排失败：${(err as Error).message}`),
      );
  }

  private async mustStage(
    jobId: string,
    stageId: string,
  ): Promise<MdopStageEntity> {
    const stage = await this.stages.findOne({ where: { jobId, stageId } });
    if (!stage) throw new BadRequestException("聚合阶段不存在");
    return stage;
  }

  private async enqueue(input: {
    msgType: string;
    receiver: string;
    jobId: string;
    idempotencyKey: string;
    body: Record<string, unknown>;
  }): Promise<void> {
    const id = `${input.msgType}:${input.idempotencyKey}`;
    const existing = await this.outbox.findOne({ where: { id } });
    if (existing) return;
    await this.outbox.save(
      this.outbox.create({
        id,
        msg_id: randomUUID(),
        msg_type: input.msgType,
        job_id: input.jobId,
        receiver: input.receiver,
        sender: `urn:tds:${currentSpaceId()}:participant:platform`,
        idempotency_key: input.idempotencyKey,
        body: input.body,
      }),
    );
  }
}
