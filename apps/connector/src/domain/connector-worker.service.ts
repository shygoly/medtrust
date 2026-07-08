import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ControlPlaneClient } from './control-plane-client';
import { ConnectorTaskRunner } from './connector-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { ContractView } from './contract-view';
import { AggregateResult } from './types';
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
    void this.pollOnce();
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
      const pending = await this.controlPlane.pullPendingRws();
      if (!pending.length) {
        const now = Date.now();
        if (now - this.lastIdleLogAt > 30_000) {
          this.logger.debug(
            `轮询中 participant=${this.controlPlane.getParticipantId()} 暂无待执行任务`,
          );
          this.lastIdleLogAt = now;
        }
        return;
      }

      this.logger.log(`拉取到 ${pending.length} 个待执行分派`);
      for (const assignment of pending) {
        await this.executeAssignment(assignment);
      }
    } catch (err) {
      this.logger.warn(`轮询失败: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async executeAssignment(assignment: {
    assignmentId: string;
    taskId: string;
    purpose: string;
    analysis: { type: 'adverse-event-signal' | 'cohort-count' | 'condition-prevalence'; drug?: string };
    contract: ContractView & { dataProductId: string };
  }): Promise<void> {
    const shortId = assignment.assignmentId.slice(0, 8);
    this.progress.bind(async (stage, detail) => {
      this.logger.log(`[${shortId}] ${stage}${detail ? `: ${detail}` : ''}`);
      await this.controlPlane.reportProgress(assignment.assignmentId, stage, detail);
    });

    try {
      this.logger.log(
        `开始执行 taskId=${assignment.taskId.slice(0, 8)} assignment=${shortId} product=${assignment.contract.dataProductId?.slice(0, 8) ?? '—'}`,
      );

      const productId = assignment.contract.dataProductId;
      if (productId) {
        await this.progress.stage('catalog-prefetch', productId);
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
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`任务失败 assignment=${shortId}: ${message}`);
      await this.progress.stage('failed', message);
      await this.controlPlane.completeAssignment(assignment.assignmentId, { error: message });
    } finally {
      this.progress.clear();
    }
  }
}
