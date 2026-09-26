import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  ConnectorPendingAssignment,
  ConnectorPendingFlAssignment,
  ConnectorTaskBatch,
  ControlPlaneClient,
} from './control-plane-client';
import { AuditService } from './audit';
import { ConnectorTaskRunner } from './connector-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { ContractView } from './contract-view';
import { AggregateResult, RwsAnalysis } from './types';
import { FlTaskRunner } from './fl-prediction/fl-task-runner';
import { TaskProgressReporter } from './task-progress-reporter';
import {
  SignedConnectorTask,
  verifySignedConnectorTask,
} from './connector-task-signature';
import { loadConnectorPrivateKey } from './connector-key';
import { MdopOperatorWhitelistStore } from '../mdop/operator-whitelist';
import { MdopNodeService } from '../mdop/mdop-node.service';
import { ConnectorTaskDedupe } from './task-dedupe';
import { TaskExecutionQueue } from './task-queue';
import {
  ConnectorFlRoundTask,
  FlRoundExecutor,
} from './fl-round/fl-round-executor';
import { ConnectorModuleClient } from './sandbox/module-client';

export const DEFAULT_LONG_POLL_WAIT_MS = 25_000;
export const DEFAULT_TASK_CONCURRENCY = 4;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const MIN_BACKOFF_MS = 1_000;

@Injectable()
export class ConnectorWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectorWorkerService.name);
  private stopped = false;
  private loopRunning = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastDigestUploadAt = 0;
  private lastHeartbeatAt = 0;
  private readonly dedupe = new ConnectorTaskDedupe();
  private readonly queue = new TaskExecutionQueue(
    Number(process.env.CONNECTOR_TASK_CONCURRENCY ?? DEFAULT_TASK_CONCURRENCY),
    (job, err) =>
      this.logger.error(`任务执行未捕获异常 ${job.label}: ${(err as Error).message}`),
  );

  constructor(
    private readonly controlPlane: ControlPlaneClient,
    private readonly productSource: DataProductLocalSource,
    private readonly runner: ConnectorTaskRunner,
    private readonly flRunner: FlTaskRunner,
    private readonly progress: TaskProgressReporter,
    private readonly audit: AuditService,
    @Optional() private readonly flRoundExecutor?: FlRoundExecutor,
    /** third-party-module-admission 闸 5:收下批次里的吊销名单。 */
    @Optional() private readonly modules?: ConnectorModuleClient,
    /** mdop-kernel:算子清单 + MDOP 白名单/吊销状态（本地）。 */
    @Optional() private readonly mdopOperators?: MdopOperatorWhitelistStore,
    /** mdop-kernel:MDOP 信封处理（七项复核/执行/制品/回执）。 */
    @Optional() private readonly mdopNode?: MdopNodeService,
  ) {}

  start(): void {
    const participantId = this.controlPlane.getParticipantId();
    if (!participantId) {
      this.logger.warn('CONNECTOR_PARTICIPANT_ID 未设置，跳过出站任务轮询');
      return;
    }
    if (this.loopRunning) return;
    this.stopped = false;
    this.logLoopConfig(participantId);

    // 长轮询主循环（D2）：领到任务立刻发起下一次请求；执行交给有并发上限的队列。
    this.heartbeatTimer = setInterval(
      () => void this.maybeSendHeartbeat(),
      HEARTBEAT_INTERVAL_MS,
    );
    /**
     * 心跳定时器 **unref**：本进程的存活由 HTTP 服务决定，不该由「后台心跳」这一件事撑着。
     * 同仓另两处后台节拍（`MdopNodeService` 的 tick、`CdmDataSourceRegistry` 的刷新）都是这么做的——
     * 不一致的后果很具体：**测试跑完进程不退出**（jest 报 "worker process has failed to exit gracefully"），
     * 而这类噪音一旦习惯了，真漏句柄就再也看不见。
     */
    this.heartbeatTimer.unref?.();
    void this.pollLoop();
    void this.warmupCatalog();
  }

  /** Pre-fetch catalog metadata so the first assignment skips cold HTTP. */
  private async warmupCatalog(): Promise<void> {
    const productIds = (process.env.CONNECTOR_CATALOG_WARMUP ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!productIds.length) return;

    this.logger.log(`目录预热: ${productIds.join(', ')}`);
    await Promise.allSettled(
      productIds.map(async (productId) => {
        const product = await this.controlPlane.prefetchCatalogProduct(productId);
        if (product) this.productSource.registerProduct(product);
      }),
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** 长轮询等待上限(客户端与服务端同一开关)。 */
  private waitMs(): number {
    const raw = Number(
      process.env.CONNECTOR_LONG_POLL_WAIT_MS ?? DEFAULT_LONG_POLL_WAIT_MS,
    );
    if (!Number.isFinite(raw) || raw < 0) return DEFAULT_LONG_POLL_WAIT_MS;
    return Math.min(Math.floor(raw), DEFAULT_LONG_POLL_WAIT_MS);
  }

  private logLoopConfig(participantId: string): void {
    // 连接器私钥是**自持**的：内联环境变量或本地 0600 文件（D-MDOP-3）。
    const keyLoaded = (() => {
      try {
        return !!loadConnectorPrivateKey();
      } catch {
        return false;
      }
    })();
    const certConfigured = !!process.env.CONNECTOR_CERT_FINGERPRINT && keyLoaded;
    const platformKeyConfigured = !!process.env.CONNECTOR_PLATFORM_NODE_PUBKEY;
    const tokenAllowed =
      process.env.CONNECTOR_TOKEN_AUTH_ALLOWED === 'true' &&
      !!process.env.CONNECTOR_PULL_TOKEN;
    this.logger.log(
      `长轮询已启动 participant=${participantId} waitMs=${this.waitMs()} ` +
        `concurrency=${Number(process.env.CONNECTOR_TASK_CONCURRENCY ?? DEFAULT_TASK_CONCURRENCY)} ` +
        `cert=${certConfigured ? 'on' : 'off'} platformKey=${platformKeyConfigured ? 'on' : 'off'} ` +
        `tokenFallback=${tokenAllowed ? 'on' : 'off'}`,
    );
    if (!certConfigured && !tokenAllowed) {
      this.logger.error(
        '既未配置连接器证书(CONNECTOR_CERT_FINGERPRINT + CONNECTOR_SM2_PRIVATE_KEY[_FILE]),' +
          '也不允许令牌降级:平台会拒绝所有请求',
      );
    }
    if (!platformKeyConfigured) {
      this.logger.error(
        '未配置 CONNECTOR_PLATFORM_NODE_PUBKEY:无法验证下发任务签名,所有任务都会被拒绝(fail-closed)',
      );
    }
  }

  /**
   * 长轮询主循环（design D2）。
   *
   * - 领到任务立刻发起下一次请求（不 sleep）；执行交给并发受限的队列；
   * - 网络错误按 1s→30s 指数退避并加抖动；
   * - 空闲与忙碌时都在刷新在线状态（服务端每次长轮询都 touch）。
   */
  private async pollLoop(): Promise<void> {
    this.loopRunning = true;
    let backoffMs = MIN_BACKOFF_MS;
    try {
      while (!this.stopped) {
        try {
          const batch = await this.controlPlane.longPollTasks(this.waitMs());
          backoffMs = MIN_BACKOFF_MS;
          // 闸 5:先收吊销名单再派发 —— 本批次里引用了刚被吊销模块的任务,
          // 必须在这一轮就被 PEP 拒掉,不能等下一轮名单。
          this.modules?.applyRevocationList(batch.revocations);
          // mdop-kernel:先落清单与吊销名单，再派发（同一条 fail-closed 顺序）。
          // 注意：这里**只**更新清单与吊销状态，白名单只能由院内本地 CLI/端点改。
          if (this.mdopOperators) {
            await this.mdopOperators.applyOperatorManifests(batch.mdopOperators);
            await this.mdopOperators.applyRevocationList(batch.mdopRevocations);
          }
          // mdop-kernel:处理平台下发的 MDOP 信封（缺省 MDOP_ENABLED=false → 不处理）
          if (this.mdopNode) await this.mdopNode.handleBatch(batch.mdop as never);
          this.dispatchSignedTasks(batch);
          void this.maybeUploadAuditDigest(); // 周期上报审计链摘要(节流 30s)
          void this.maybeSendHeartbeat(); // 显式心跳节流到 60s
        } catch (err) {
          if (this.stopped) break;
          const jitter = Math.floor(Math.random() * 250);
          this.logger.warn(
            `长轮询失败(退避 ${backoffMs + jitter}ms): ${(err as Error).message}`,
          );
          await sleep(backoffMs + jitter);
          backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
        }
      }
    } finally {
      this.loopRunning = false;
    }
  }

  /**
   * 验签 → 去重 → 入队执行（design D4）。
   * 验签失败：记 `task-signature-invalid` 审计并上报失败，避免编排器空等。
   */
  private dispatchSignedTasks(batch: {
    rws: SignedConnectorTask<ConnectorPendingAssignment>[];
    flPrediction: SignedConnectorTask<ConnectorPendingFlAssignment>[];
    flRounds: SignedConnectorTask<ConnectorFlRoundTask>[];
  }): void {
    const total =
      batch.rws.length + batch.flPrediction.length + batch.flRounds.length;
    if (!total) return;
    this.logger.log(
      `领到 ${batch.rws.length} 个 RWS + ${batch.flPrediction.length} 个 FL 预测 + ${batch.flRounds.length} 个训练轮次`,
    );

    for (const signed of batch.rws) {
      const assignment = this.verifyTask(signed);
      if (!assignment) continue;
      this.queue.push({
        label: `rws:${signed.taskId.slice(0, 8)}`,
        run: () => this.executeRwsAssignment(assignment),
      });
    }
    for (const signed of batch.flPrediction) {
      const assignment = this.verifyTask(signed);
      if (!assignment) continue;
      this.queue.push({
        label: `fl:${signed.taskId.slice(0, 8)}`,
        run: () => this.executeFlAssignment(assignment),
      });
    }
    for (const signed of batch.flRounds) {
      const round = this.verifyTask(signed);
      if (!round) continue;
      this.queue.push({
        label: `round:${signed.taskId.slice(0, 8)}`,
        run: () => this.executeFlRound(round),
      });
    }
  }

  /** 校验一个下发任务;失败记审计并上报失败,返回 null。 */
  private verifyTask<T>(signed: SignedConnectorTask<T>): T | null {
    const participantId = this.controlPlane.getParticipantId();
    const result = verifySignedConnectorTask<T>(signed, {
      participantId,
      platformNodePublicKey: process.env.CONNECTOR_PLATFORM_NODE_PUBKEY ?? '',
    });
    const key = `${signed?.kind}:${signed?.taskId}`;
    if (!result.ok) {
      this.audit.record({
        action: 'task-signature-invalid',
        actor: key,
        allowed: false,
        detail: `reason=${result.reason} ${result.detail}`,
      });
      this.logger.error(`下发任务验签失败 ${key}: ${result.detail}`);
      void this.reportTaskRejected(signed, `任务验签失败(${result.reason})`);
      return null;
    }
    if (!this.dedupe.accept(key)) {
      this.logger.warn(`重复下发任务已丢弃 ${key}`);
      return null;
    }
    return result.task.payload as T;
  }

  private async reportTaskRejected(
    signed: SignedConnectorTask<unknown>,
    message: string,
  ): Promise<void> {
    try {
      if (signed?.kind === 'fl-round' && signed.taskId) {
        await this.controlPlane.completeFlRound(signed.taskId, { error: message });
      } else if (signed?.kind === 'rws' && signed.taskId) {
        await this.controlPlane.completeAssignment(signed.taskId, { error: message });
      } else if (signed?.kind === 'fl-prediction' && signed.taskId) {
        await this.controlPlane.completeFlAssignment(signed.taskId, { error: message });
      }
    } catch (err) {
      this.logger.warn(
        `上报任务拒绝失败 ${signed?.kind}:${signed?.taskId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 单次领取（测试/运维排障用）：waitMs=0，不做长时间挂起。
   * 生产由 pollLoop 持续调用。
   */
  async pollOnce(waitMs = 0): Promise<void> {
    const batch: ConnectorTaskBatch = await this.controlPlane.longPollTasks(waitMs);
    this.modules?.applyRevocationList(batch.revocations);
    this.dispatchSignedTasks(batch);
    await this.queue.idle();
  }

  // 周期把本地审计链摘要(含链式 prevHash + 阻断事件)上报平台,平台侧查验完整性(P0-6)。
  private async maybeUploadAuditDigest(): Promise<void> {
    const now = Date.now();
    if (now - this.lastDigestUploadAt < 30_000) return;
    this.lastDigestUploadAt = now;
    const digest = this.audit.digest();
    if (digest.count === 0) return;
    try {
      await this.controlPlane.uploadAuditDigest({
        ...digest,
        blocked: this.audit.blocked(),
      });
    } catch (err) {
      this.logger.warn(`审计摘要上报失败: ${(err as Error).message}`);
    }
  }

  // P1-9:连接器周期心跳上报(版本/任务状态/资源水位),平台据此显示真实在线状态。
  private async maybeSendHeartbeat(): Promise<void> {
    const now = Date.now();
    // 显式心跳每 60s 一次(在线状态由每次长轮询顺带刷新,见 design D2)。
    if (now - this.lastHeartbeatAt < HEARTBEAT_INTERVAL_MS - 5_000) return;
    this.lastHeartbeatAt = now;
    try {
      await this.controlPlane.sendHeartbeat({
        version: process.env.CONNECTOR_VERSION ?? '1.0.0',
        taskStatus: {
          polling: this.loopRunning,
          queued: this.queue.queued,
          running: this.queue.running,
        },
        resources: {
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
        // mdop-kernel（任务 6.5）：启动时与每次心跳都做能力通告 ——
        // 编译器据此决定能不能把阶段放在本节点（运行时/TEE/协同协议）。
        ...(this.mdopOperators
          ? { mdop: await this.mdopOperators.capabilityAdvertise() }
          : {}),
      });
    } catch (err) {
      this.logger.warn(`心跳上报失败: ${(err as Error).message}`);
    }
  }

  private async withTimeout<T>(label: string, work: () => Promise<T>): Promise<T> {
    const timeoutMs = Number(process.env.CONNECTOR_TASK_TIMEOUT_MS ?? 120_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} 超时 (${timeoutMs}ms)`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runRwsAssignmentBody(assignment: {
    assignmentId: string;
    taskId: string;
    purpose: string;
    analysis: RwsAnalysis;
    module?: { analysisType: string; sm3: string };
    contract: ContractView & { dataProductId: string };
  }): Promise<void> {
    const shortId = assignment.assignmentId.slice(0, 8);
    this.logger.log(
      `开始执行 taskId=${assignment.taskId.slice(0, 8)} assignment=${shortId} product=${assignment.contract.dataProductId?.slice(0, 8) ?? '—'}`,
    );

    const productId = assignment.contract.dataProductId;
    if (productId) {
      const cached = this.controlPlane.isCatalogCached(productId);
      if (!cached) {
        await this.progress.stage('catalog-prefetch', productId);
      }
      const product = await this.controlPlane.prefetchCatalogProduct(productId);
      if (!product) {
        throw new Error(`目录元数据拉取失败: ${productId}`);
      }
      this.productSource.registerProduct(product);
    }

    await this.progress.stage('data-load', 'materialize localDataPath → LocalStore');

    const aggregate = await this.runner.run(
      {
        taskId: assignment.taskId,
        purpose: assignment.purpose,
        workloadType: 'rws',
        analysis: assignment.analysis,
        module: assignment.module,
      },
      assignment.contract,
    ) as AggregateResult;

    await this.progress.stage('complete', `cohort=${aggregate.cohortSize}`);
    await this.controlPlane.completeAssignment(assignment.assignmentId, { aggregate });
    this.logger.log(`任务完成 assignment=${shortId} cohort=${aggregate.cohortSize}`);
  }

  private async executeRwsAssignment(assignment: {
    assignmentId: string;
    taskId: string;
    purpose: string;
    analysis: RwsAnalysis;
    module?: { analysisType: string; sm3: string };
    contract: ContractView & { dataProductId: string };
  }): Promise<void> {
    const shortId = assignment.assignmentId.slice(0, 8);
    const sink = async (stage: string, detail?: string) => {
      this.logger.log(`[${shortId}] ${stage}${detail ? `: ${detail}` : ''}`);
      await this.controlPlane.reportProgress(
        assignment.assignmentId,
        stage as never,
        detail,
      );
    };
    await this.progress.withSink(sink as never, async () => {
      try {
        await this.withTimeout(`RWS ${shortId}`, () =>
          this.runRwsAssignmentBody(assignment),
        );
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`任务失败 assignment=${shortId}: ${message}`);
        await this.progress.stage('failed', message);
        await this.controlPlane.completeAssignment(assignment.assignmentId, {
          error: message,
        });
      }
    });
  }

  private async runFlAssignmentBody(assignment: {
    assignmentId: string;
    taskId: string;
    purpose: string;
    flPredictionSpec: Record<string, unknown>;
    contract: ContractView & { dataProductId: string };
  }): Promise<void> {
    const shortId = assignment.assignmentId.slice(0, 8);
    this.logger.log(
      `开始 FL 训练 taskId=${assignment.taskId.slice(0, 8)} assignment=${shortId}`,
    );

    const productId = assignment.contract.dataProductId;
    if (productId) {
      const cached = this.controlPlane.isCatalogCached(productId);
      if (!cached) {
        await this.progress.stage('catalog-prefetch', productId);
      }
      const product = await this.controlPlane.prefetchCatalogProduct(productId);
      if (!product) {
        throw new Error(`目录元数据拉取失败: ${productId}`);
      }
      this.productSource.registerProduct(product);
    }

    await this.progress.stage('data-load', `合约数据产品 ${productId ?? '—'} → 训练行（不替换本地存储）`);

    const partyResult = await this.flRunner.run(
      assignment.taskId,
      assignment.purpose,
      assignment.flPredictionSpec,
      assignment.contract,
    );

    await this.progress.stage('complete', `samples=${partyResult.sampleCount}`);
    await this.controlPlane.completeFlAssignment(assignment.assignmentId, { partyResult });
    this.logger.log(
      `FL 任务完成 assignment=${shortId} samples=${partyResult.sampleCount} auc=${partyResult.localMetrics.auc}`,
    );
  }

  private async executeFlAssignment(assignment: {
    assignmentId: string;
    taskId: string;
    purpose: string;
    flPredictionSpec: Record<string, unknown>;
    contract: ContractView & { dataProductId: string };
  }): Promise<void> {
    const shortId = assignment.assignmentId.slice(0, 8);
    const sink = async (stage: string, detail?: string) => {
      this.logger.log(`[FL ${shortId}] ${stage}${detail ? `: ${detail}` : ''}`);
      await this.controlPlane.reportFlProgress(
        assignment.assignmentId,
        stage as never,
        detail,
      );
    };
    await this.progress.withSink(sink as never, async () => {
      try {
        await this.withTimeout(`FL ${shortId}`, () =>
          this.runFlAssignmentBody(assignment),
        );
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`FL 任务失败 assignment=${shortId}: ${message}`);
        await this.progress.stage('failed', message);
        await this.controlPlane.completeFlAssignment(assignment.assignmentId, {
          error: message,
        });
      }
    });
  }

  /** 联邦训练轮次（经连接器中转，design D3）：PEP → 院内 agent → 回传结果。 */
  private async executeFlRound(task: ConnectorFlRoundTask): Promise<void> {
    const shortId = task.roundTaskId.slice(0, 8);
    try {
      if (!this.flRoundExecutor) {
        throw new Error('未装配 FlRoundExecutor，无法执行训练轮次');
      }
      const payload = await this.flRoundExecutor.runRound(task);
      await this.controlPlane.completeFlRound(task.roundTaskId, payload);
      this.logger.log(
        `训练轮次完成 roundTaskId=${shortId} round=${task.round + 1} samples=${payload.sampleCount} loss=${payload.localLoss}`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`训练轮次失败 roundTaskId=${shortId}: ${message}`);
      this.audit.record({
        action: 'fl-round-failed',
        actor: task.taskId,
        allowed: false,
        detail: `round=${task.round + 1} ${message}`,
      });
      await this.controlPlane
        .completeFlRound(task.roundTaskId, { error: message })
        .catch((e) =>
          this.logger.warn(
            `上报轮次失败失败 roundTaskId=${shortId}: ${(e as Error).message}`,
          ),
        );
    }
  }
}

function sleep(ms: number): Promise<void> {
  // 退避等待同样不持有进程（理由同上）；轮询循环本身由 `stopped` 标志收尾。
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}
