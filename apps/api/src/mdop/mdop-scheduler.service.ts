import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  MdopJobEntity,
  MdopOutboxEntity,
  MdopStageEntity,
} from "@medtrust/database";
import {
  MdopError,
  RETRYABLE_CODES,
  STAGE_RETRY_LIMIT,
  assertJobTransition,
  assertStageTransition,
  idempotencyKey,
  isRetryable,
  mergeAttestationPolicies,
  participantUrn,
  retryBackoffSeconds,
  type AttestationPolicy,
  type StageState,
} from "@medtrust/mdop";
import { Optional } from "@nestjs/common";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopPurgeService } from "./mdop-purge.service";
// **值导入（不是 `import type`）**：Nest 的构造参数注入靠 `emitDecoratorMetadata` 发出的类型元数据，
// 用 `import type` 会让元数据退化成 `Object`，模块启动时报「无法解析依赖」——
// 单元测试直接 new 服务，发现不了这类坏掉。
import { MdopAttestationService } from "./mdop-attestation.service";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";

/**
 * MDOP 调度器（任务 7.6 / 协议 §8.2、§8.3）。
 *
 * - 显式迁移表：非法迁移被拒绝并记审计（`packages/mdop` 的 STAGE/JOB_TRANSITIONS）。
 * - `StageDispatch` 带凭证编号与幂等键 `job:stage:attempt`；连接器对重复键返回原结果。
 * - 可重试错误（E_RUNTIME / E_TIMEOUT / E_PEER_UNREACHABLE）最多 3 次、指数退避 30/60/120 秒。
 * - 阶段失败向作业传播：阶段 FAILED → 作业 FAILED。
 */

export interface StageStatusInput {
  jobId: string;
  stageId: string;
  /**
   * **消息层已认证的上报方 URN**（= 信封 sender / 证书主体）。
   *
   * 必须核对：阶段状态直接驱动平台状态机（`SUCCEEDED` 会解锁下游下发，`FAILED` 会触发重试或把作业判失败）。
   * 不核对的话，任何已认证参与方都能替**别家**上报：要么让计划在数据未到时就往前推进，
   * 要么把别家的阶段刷成失败，甚至把整个作业打成 `FAILED`。
   */
  reporter: string;
  status: "SUCCEEDED" | "FAILED" | "RUNNING";
  /** 失败时的错误码（决定是否可重试）。 */
  code?: string;
  message?: string;
}

@Injectable()
export class MdopSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MdopSchedulerService.name);
  private retryTimer?: ReturnType<typeof setInterval>;

  /**
   * 退避重试的驱动（协议 §8.3）：可重试失败后阶段停在 `RETRYING`，
   * 必须有人在退避时间到了以后**再下发一次**（新 attempt），否则阶段永远不动。
   * 每 10 秒扫一遍到期的 `RETRYING` 阶段，按 30/60/120 秒退避重发。
   */
  onModuleInit(): void {
    this.retryTimer = setInterval(() => {
      void this.sweepRetries().catch((err) =>
        this.logger.error(`退避重试扫描失败：${(err as Error).message}`),
      );
    }, 10_000);
    this.retryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /** 把已过退避窗口的 `RETRYING` 阶段重新下发（作业必须仍在可调度状态）。 */
  async sweepRetries(now: Date = new Date()): Promise<number> {
    const rows = await this.stages.find({ where: { status: "RETRYING" } });
    const jobCache = new Map<string, MdopJobEntity | null>();
    let dispatched = 0;
    for (const stage of rows) {
      const dueAt =
        new Date(stage.updatedAt).getTime() +
        retryBackoffSeconds(stage.attempt) * 1000;
      if (dueAt > now.getTime()) continue;
      if (!jobCache.has(stage.jobId))
        jobCache.set(
          stage.jobId,
          await this.jobs.findOne({ where: { id: stage.jobId } }),
        );
      const job = jobCache.get(stage.jobId);
      if (!job || (job.status !== "TICKETED" && job.status !== "RUNNING"))
        continue;
      dispatched += await this.dispatchReadyStages(stage.jobId).catch(() => 0);
    }
    return dispatched;
  }

  constructor(
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(MdopStageEntity, "controlplane")
    private readonly stages: Repository<MdopStageEntity>,
    @InjectRepository(MdopOutboxEntity, "controlplane")
    private readonly outbox: Repository<MdopOutboxEntity>,
    private readonly tickets: MdopTicketService,
    /** 终态销毁编排（作业 FAILED 后立即发 PurgeOrder）。 */
    private readonly purge: MdopPurgeService,
    /**
     * C2 阶段下发前的证明复检（规格「证明在编译后过期」）。两个都是可选注入：
     * 非 C2 作业不需要它们；**接收 C2 的阶段缺它们即不下发**（fail-closed）。
     */
    @Optional() private readonly contracts?: MdopContractService,
    @Optional() private readonly attestations?: MdopAttestationService,
  ) {}

  /**
   * 把上游已就绪的阶段置为 READY 并下发 `StageDispatch`。
   * 幂等：重复调用不会为同一 `job:stage:attempt` 生成第二份指令。
   */
  async dispatchReadyStages(jobId: string): Promise<number> {
    const job = await this.mustGetJob(jobId);
    if (job.status !== "TICKETED" && job.status !== "RUNNING")
      throw new MdopError("E_RUNTIME", {}, `作业状态 ${job.status} 不允许调度`);
    const ticket = await this.tickets.issuedTicket(jobId);
    if (!ticket)
      throw new MdopError("E_TICKET_INVALID", {}, "作业尚未签发执行凭证");

    const stages = await this.stages.find({ where: { jobId } });
    const byId = new Map(stages.map((s) => [s.stageId, s]));
    let dispatched = 0;
    for (const stage of stages) {
      const isRetry = stage.status === "RETRYING";
      if (stage.status !== "PENDING" && !isRetry) continue;
      // 平台自己的片段（合并阶段）**不经消息下发**：平台就是接收方，由
      // `MdopMergeService` 在全部 C3 投递到齐后就地执行并推进作业状态。
      // 若在这里为平台节点建 StageDispatch，消息会躺在发件箱里无人认领。
      if (stage.node === this.platformNode()) continue;
      const ready = stage.inputs
        .map((i) => i.from)
        .filter((from) => byId.has(from))
        .every((from) => byId.get(from)!.status === "SUCCEEDED");
      if (!ready) continue;

      if (isRetry) {
        // RETRYING → RUNNING（未超限）；不复用上次的中间产物，attempt 加 1
        assertStageTransition("RETRYING", "RUNNING");
      } else {
        assertStageTransition("PENDING", "READY");
        assertStageTransition("READY", "RUNNING");
      }
      const attempt = stage.attempt + 1;
      await this.stages.update(
        { id: stage.id },
        { status: "RUNNING", attempt, updatedAt: new Date() },
      );
      // **C2 阶段下发前再核一次证明登记**（规格「证明在编译后过期」）：编译期查过，但编译到下发
      // 之间证明可能已经过期——此时 MUST NOT 下发。判据只有一份（`assertUsableForC2`），
      // 平台登记过期就按**不可重试的失败**处理（不是「节点执行失败」，两者在排障时完全不同）。
      const blocked = await this.c2DispatchBlocker(job, stage, byId);
      if (blocked) {
        await this.stages.update(
          { id: stage.id },
          {
            status: "FAILED",
            lastError: `E_ATTESTATION_FAILED: ${blocked}`,
            updatedAt: new Date(),
          },
        );
        // 迁移表里 `TICKETED` 只能先到 `RUNNING`（`TICKETED → FAILED` 非法）：一次下发都没有的作业
        // 也要走到终态，否则它会永远停在 `TICKETED`（既没人再下发，也没有超时兜底）。
        if ((job.status as string) === "TICKETED") {
          assertJobTransition("TICKETED", "RUNNING");
          await this.jobs.update(
            { id: jobId },
            { status: "RUNNING", updatedAt: new Date() },
          );
        }
        if ((await this.mustGetJob(jobId)).status === "RUNNING") {
          assertJobTransition("RUNNING", "FAILED");
          await this.jobs.update(
            { id: jobId },
            {
              status: "FAILED",
              rejectReason: `E_ATTESTATION_FAILED: ${blocked}`,
              updatedAt: new Date(),
            },
          );
        }
        this.logger.error(
          `C2 阶段未下发：${jobId}#${stage.stageId}（${blocked}）`,
        );
        await this.purge
          .orchestratePurge(jobId)
          .catch((err) =>
            this.logger.error(
              `销毁编排失败（作业 ${jobId}）：${(err as Error).message}`,
            ),
          );
        continue;
      }
      await this.enqueue({
        msgType: "StageDispatch",
        receiver: stage.node,
        jobId,
        idempotencyKey: idempotencyKey(jobId, stage.stageId, attempt),
        body: {
          ticket_id: ticket.core.ticket_id,
          // 只下发**本节点**的片段（执行前连接器还会用凭证校验它）
          stage_id: stage.stageId,
          attempt,
          idempotency_key: idempotencyKey(jobId, stage.stageId, attempt),
        },
      });
      dispatched += 1;
    }
    if (job.status === "TICKETED" && dispatched > 0) {
      assertJobTransition("TICKETED", "RUNNING");
      await this.jobs.update(
        { id: jobId },
        { status: "RUNNING", updatedAt: new Date() },
      );
    }
    // 只剩平台片段时也把作业推进到 RUNNING：合并阶段由平台就地执行，
    // 不推进的话 `MdopMergeService` 的 RUNNING → RELEASING 迁移会被拒。
    if (
      job.status === "TICKETED" &&
      dispatched === 0 &&
      (await this.pendingHolderStages(jobId)) === 0
    ) {
      assertJobTransition("TICKETED", "RUNNING");
      await this.jobs.update(
        { id: jobId },
        { status: "RUNNING", updatedAt: new Date() },
      );
    }
    return dispatched;
  }

  /**
   * 连接器上报阶段状态：成功推进；可重试错误按 30/60/120 秒退避重试（最多 3 次）；
   * 超过次数或不可重试 → 阶段与作业 FAILED（并触发销毁编排，§7.8 接）。
   */
  async onStageStatus(input: StageStatusInput): Promise<{
    stage: StageState;
    retryAfterSeconds?: number;
    jobStatus: string;
  }> {
    const job = await this.mustGetJob(input.jobId);
    const stage = await this.stages.findOne({
      where: { jobId: input.jobId, stageId: input.stageId },
    });
    if (!stage) throw new BadRequestException("阶段不存在");

    // 身份绑定：只有该阶段的落点节点能上报它的状态（平台自己排的合并阶段不走这条 HTTP 路径）
    if (stage.node !== input.reporter)
      throw new BadRequestException(
        `阶段 ${input.stageId} 落在 ${stage.node}，但上报方是 ${input.reporter} —— 不得替别家上报阶段状态`,
      );

    if (input.status === "SUCCEEDED") {
      // 至少一次投递：同一阶段成功可能被报多次，第二次到达时如实返回当前状态即可
      // （再走一次迁移表会以「非法迁移」把整条消息判成 400，把幂等上报误伤成错误）。
      if (stage.status === "SUCCEEDED")
        return { stage: "SUCCEEDED", jobStatus: job.status };
      assertStageTransition(stage.status as StageState, "SUCCEEDED");
      await this.stages.update(
        { id: stage.id },
        { status: "SUCCEEDED", lastError: null, updatedAt: new Date() },
      );
      return { stage: "SUCCEEDED", jobStatus: job.status };
    }

    const code = input.code ?? "E_RUNTIME";
    const retryable =
      isRetryable(code) || RETRYABLE_CODES.includes(code as never);
    const attempt = stage.attempt;

    if (retryable && attempt < STAGE_RETRY_LIMIT + 1) {
      // RUNNING → RETRYING → RUNNING（新 attempt 不复用上次中间产物）
      // 已在退避等待中就**只重申结果**：同一 attempt 的失败会被重发（平台还会重发
      // `StageDispatch`），重复的 RETRYING 迁移同样是非法的。
      if (stage.status !== "RETRYING") {
        assertStageTransition(stage.status as StageState, "RETRYING");
        await this.stages.update(
          { id: stage.id },
          {
            status: "RETRYING",
            lastError: `${code}: ${input.message ?? ""}`,
            updatedAt: new Date(),
          },
        );
      }
      const backoff = retryBackoffSeconds(attempt);
      this.logger.warn(
        `阶段 ${input.jobId}#${input.stageId} 第 ${attempt} 次失败（${code}），${backoff}s 后重试`,
      );
      return {
        stage: "RETRYING",
        retryAfterSeconds: backoff,
        jobStatus: job.status,
      };
    }

    assertStageTransition(stage.status as StageState, "FAILED");
    await this.stages.update(
      { id: stage.id },
      {
        status: "FAILED",
        lastError: `${code}: ${input.message ?? ""}`,
        updatedAt: new Date(),
      },
    );
    const from = job.status as never;
    if (from === "RUNNING") assertJobTransition(from, "FAILED");
    await this.jobs.update(
      { id: input.jobId },
      {
        status: "FAILED",
        rejectReason: `${code}: ${input.message ?? "阶段失败"}`,
        updatedAt: new Date(),
      },
    );
    this.logger.error(
      `阶段 ${input.jobId}#${input.stageId} 失败并传播到作业（${code}）`,
    );
    // 终态即触发销毁编排（§7.8）：收齐 PurgeReceipt 才进 PURGED。
    await this.purge
      .orchestratePurge(input.jobId)
      .catch((err) =>
        this.logger.error(
          `销毁编排失败（作业 ${input.jobId}）：${(err as Error).message}`,
        ),
      );
    return { stage: "FAILED", jobStatus: "FAILED" };
  }

  private async mustGetJob(jobId: string): Promise<MdopJobEntity> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new BadRequestException("作业不存在");
    return job;
  }

  /**
   * C2 阶段下发前的**证明复检**：返回阻塞原因（`null` = 可以下发）。
   *
   * 只对「**接收 C2 的阶段**」判：它的上游阶段里只要有输出等级 C2 的，就说明这个阶段要吃
   * 解封后的数据，目标节点的证明必须仍然可用（`assertUsableForC2`：链型 / 度量清单 / TCB / 未过期）。
   *
   * 缺服务（合约或证明登记未注入）时**判不了就阻塞**（fail-closed）——「平台没接服务所以照发」
   * 会正好把这个校验变成可选项，那是本条要求最容易被绕过的地方。
   */
  private async c2DispatchBlocker(
    job: MdopJobEntity,
    stage: MdopStageEntity,
    byId: ReadonlyMap<string, MdopStageEntity>,
  ): Promise<string | null> {
    const receivesC2 = stage.inputs.some(
      (i) => byId.get(i.from)?.outputLabel === "C2",
    );
    if (!receivesC2) return null;
    if (!this.contracts || !this.attestations)
      return "平台未接入合约服务或证明登记服务，不能下发接收 C2 的阶段";
    let policy: AttestationPolicy | undefined;
    for (const contractId of job.contracts ?? []) {
      const described = await this.contracts.describeForNode(contractId);
      const declared = described.contract.attestation_policy;
      if (!declared) continue;
      policy = policy ? mergeAttestationPolicies(policy, declared) : declared;
    }
    if (!policy) return "相关合约未声明证明策略，不得把 C2 制品流向任何节点";
    try {
      await this.attestations.assertUsableForC2(stage.node, policy);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  /** 平台节点 URN（合并片段的落点）。 */
  private platformNode(): string {
    return participantUrn(process.env.SPACE_ID ?? "sh-med", "platform");
  }

  /** 还有多少「非平台、未完成」的阶段——判断作业是否该进入 `RUNNING`。 */
  private async pendingHolderStages(jobId: string): Promise<number> {
    const stages = await this.stages.find({ where: { jobId } });
    return stages.filter(
      (s) => s.node !== this.platformNode() && s.status !== "SUCCEEDED",
    ).length;
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
    if (existing) return; // 幂等：同一 job:stage:attempt 不重复下发
    await this.outbox.save(
      this.outbox.create({
        id,
        msg_id: randomUUID(),
        msg_type: input.msgType,
        job_id: input.jobId,
        receiver: input.receiver,
        sender: `urn:tds:${process.env.SPACE_ID ?? "sh-med"}:participant:platform`,
        idempotency_key: input.idempotencyKey,
        body: input.body,
      }),
    );
  }
}
