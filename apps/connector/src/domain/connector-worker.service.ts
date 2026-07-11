import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ControlPlaneClient } from './control-plane-client';
import { ConnectorTaskRunner } from './connector-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { ContractView } from './contract-view';
import { AggregateResult, RwsAnalysis } from './types';
import { FlTaskRunner } from './fl-prediction/fl-task-runner';
import { TaskProgressReporter } from './task-progress-reporter';

@Injectable()
export class ConnectorWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectorWorkerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastIdleLogAt = 0;

  constructor(
    private readonly controlPlane: ControlPlaneClient,
    private readonly productSource: DataProductLocalSource,
    private readonly runner: ConnectorTaskRunner,
    private readonly flRunner: FlTaskRunner,
    private readonly progress: TaskProgressReporter,
  ) {}

  start(): void {
    const participantId = this.controlPlane.getParticipantId();
    if (!participantId) {
      this.logger.warn('CONNECTOR_PARTICIPANT_ID 未设置，跳过出站任务轮询');
      return;
    }
    if (this.timer) return;

    const intervalMs = Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? 5000);
    this.logger.log(`出站任务轮询已启动 participant=${participantId} interval=${intervalMs}ms`);
    this.timer = setInterval(() => void this.pollOnce(), intervalMs);
    void this.warmupCatalog();
    void this.pollOnce();
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
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  async pollOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const [pendingRws, pendingFl] = await Promise.all([
        this.controlPlane.pullPendingRws(),
        this.controlPlane.pullPendingFl(),
      ]);
      const pending = pendingRws.length + pendingFl.length;
      if (!pending) {
        const now = Date.now();
        if (now - this.lastIdleLogAt > 30_000) {
          this.logger.debug(
            `轮询中 participant=${this.controlPlane.getParticipantId()} 暂无待执行任务`,
          );
          this.lastIdleLogAt = now;
        }
        return;
      }

      this.logger.log(`拉取到 ${pendingRws.length} 个 RWS + ${pendingFl.length} 个 FL 待执行分派`);
      // 4.2/4.9 — process assignments concurrently so one slow/blocked task
      // (e.g. pep-check on worker B) does not stall subsequent pulls. Each
      // assignment is bounded by TASK_TIMEOUT_MS so a hung task fails instead
      // of sticking in "running" forever.
      await Promise.allSettled([
        ...pendingRws.map((a) => this.executeRwsAssignment(a)),
        ...pendingFl.map((a) => this.executeFlAssignment(a)),
      ]);
    } catch (err) {
      this.logger.warn(`轮询失败: ${(err as Error).message}`);
    } finally {
      this.running = false;
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

    const aggregate = this.runner.run(
      {
        taskId: assignment.taskId,
        purpose: assignment.purpose,
        workloadType: 'rws',
        analysis: assignment.analysis,
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
    contract: ContractView & { dataProductId: string };
  }): Promise<void> {
    const shortId = assignment.assignmentId.slice(0, 8);
    this.progress.bind(async (stage, detail) => {
      this.logger.log(`[${shortId}] ${stage}${detail ? `: ${detail}` : ''}`);
      await this.controlPlane.reportProgress(assignment.assignmentId, stage, detail);
    });

    try {
      await this.withTimeout(`RWS ${shortId}`, () => this.runRwsAssignmentBody(assignment));
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`任务失败 assignment=${shortId}: ${message}`);
      await this.progress.stage('failed', message);
      await this.controlPlane.completeAssignment(assignment.assignmentId, { error: message });
    } finally {
      this.progress.clear();
    }
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

    await this.progress.stage('data-load', 'materialize localDataPath → LocalStore');

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
    this.progress.bind(async (stage, detail) => {
      this.logger.log(`[FL ${shortId}] ${stage}${detail ? `: ${detail}` : ''}`);
      await this.controlPlane.reportFlProgress(assignment.assignmentId, stage, detail);
    });

    try {
      await this.withTimeout(`FL ${shortId}`, () => this.runFlAssignmentBody(assignment));
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`FL 任务失败 assignment=${shortId}: ${message}`);
      await this.progress.stage('failed', message);
      await this.controlPlane.completeFlAssignment(assignment.assignmentId, { error: message });
    } finally {
      this.progress.clear();
    }
  }
}
