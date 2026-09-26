// omop-data-source-access —— 数据源注册表：「这个数据源现在能不能用」的唯一裁决点
// （task 3.4 / 3.6，spec: 接入一致性校验 fail-closed / 不得静默降级）。
//
//   · 启动时按部署配置装载全部数据源并逐个跑接入校验；库连不上也不让连接器起不来
//     （状态记为未通过），但**绝不**因此改用文件数据——那会让医院以为跑的是库里的数据；
//   · 校验结果持久化（local_data_source_status）并写审计，只留摘要、不留凭据；
//   · 取用数据源只走 `requireAvailable()`：上次校验没过就抛，调用方必须让任务失败；
//   · 周期复核（CONNECTOR_CDM_REVERIFY_MS，缺省 6 小时）：医院改了授权 / 升级了词汇表，
//     不用等连接器重启就能发现——授权被放宽即刻不可用，版本变了目录即刻标陈旧。
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocalDataSourceStatus } from '@medtrust/database';
import { AuditService } from '../audit';
import { CdmAccessGate, summarizeFailures, type AccessGateReport } from './cdm-access-gate';
import { CdmCoverageReporter } from './cdm-coverage-reporter';
import { CdmExecutor, type PoolFactory } from './cdm-executor';
import { CdmResultsScratch } from './cdm-results-scratch';
import {
  CdmDataSourceConfig,
  describeSource,
  loadDataSourceConfigs,
  type DataSourceDescription,
} from './data-source-config';

export class DataSourceNotAvailableError extends Error {
  constructor(
    readonly label: string,
    reason: string,
  ) {
    super(
      `数据源 ${label} 当前不可用，任务失败且**不会改用本地文件数据**：${reason}`,
    );
    this.name = 'DataSourceNotAvailableError';
  }
}

/** 周期复核间隔缺省 6 小时；0 = 关闭（只在启动时校验）。 */
export const DEFAULT_REVERIFY_MS = 6 * 3_600_000;
/** results 里的孤儿中间表超过这个时长才被兜底清理（本进程在跑的任务永远不碰）。 */
export const RESULTS_ORPHAN_GRACE_MS = 24 * 3_600_000;

export function reverifyIntervalMs(
  raw: string | undefined = process.env.CONNECTOR_CDM_REVERIFY_MS,
): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_REVERIFY_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 0) {
    throw new Error(`CONNECTOR_CDM_REVERIFY_MS 须为非负整数毫秒：${raw}`);
  }
  return ms;
}

export interface DataSourceStatusView {
  description: DataSourceDescription;
  passed: boolean;
  checkedAt?: string;
  cdmVersion?: string;
  vocabularyVersion?: string;
  failures: string[];
}

@Injectable()
export class CdmDataSourceRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CdmDataSourceRegistry.name);
  private readonly executors = new Map<string, CdmExecutor>();
  private readonly scratches = new Map<string, CdmResultsScratch>();
  private readonly reports = new Map<string, AccessGateReport>();
  private configs: CdmDataSourceConfig[] = [];
  private timer?: NodeJS.Timeout;
  private verifying?: Promise<AccessGateReport[]>;

  constructor(
    @Optional() private readonly audit?: AuditService,
    @Optional()
    @InjectRepository(LocalDataSourceStatus)
    private readonly statusRepo?: Repository<LocalDataSourceStatus>,
    @Optional() private readonly coverage?: CdmCoverageReporter,
  ) {}

  /** 测试 / 离线注入：直接给配置与环境，而不是读 process.env。 */
  configure(
    configs: CdmDataSourceConfig[],
    env: NodeJS.ProcessEnv = process.env,
    poolFactory?: PoolFactory,
  ): void {
    this.configs = configs;
    for (const c of configs) {
      const executor = new CdmExecutor(c, poolFactory, env);
      this.executors.set(c.label, executor);
      this.scratches.set(c.label, new CdmResultsScratch(executor));
    }
  }

  async onModuleInit(): Promise<void> {
    // 配置错误要在启动时暴露——但只针对「配了却配错」；没配就是没有数据库数据源。
    if (this.configs.length === 0) this.configure(loadDataSourceConfigs());
    if (this.configs.length === 0) return;
    await this.verifyAll();
    const every = reverifyIntervalMs();
    if (every > 0) {
      this.timer = setInterval(() => {
        this.verifyAll().catch((err) => this.logger.warn(`周期复核失败：${(err as Error).message}`));
      }, every);
      this.timer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.executors.values()].map((e) => e.close()));
  }

  labels(): string[] {
    return this.configs.map((c) => c.label);
  }

  /** 逐个复核；上一轮还没跑完就复用它，不叠加。 */
  verifyAll(): Promise<AccessGateReport[]> {
    this.verifying ??= (async () => {
      try {
        const out: AccessGateReport[] = [];
        for (const label of this.labels()) out.push(await this.verify(label));
        return out;
      } finally {
        this.verifying = undefined;
      }
    })();
    return this.verifying;
  }

  /** 跑接入校验并持久化结果；数据源连不上也只是「未通过」，不抛。 */
  async verify(label: string): Promise<AccessGateReport> {
    const executor = this.executors.get(label);
    if (!executor) throw new DataSourceNotAvailableError(label, '未配置该数据源');

    const report = await new CdmAccessGate(executor).run();
    this.reports.set(label, report);

    this.audit?.record({
      action: report.passed ? 'data-source-verified' : 'data-source-rejected',
      actor: `data-source:${label}`,
      allowed: report.passed,
      // 审计只留摘要：schema / 关系名 / 版本，不含主机口令等任何凭据。
      detail: report.passed
        ? `CDM ${report.cdmVersion ?? '?'} / 词汇表 ${report.vocabularyVersion ?? '?'}`
        : summarizeFailures(report),
    });
    if (!report.passed) this.logger.warn(summarizeFailures(report));

    if (this.statusRepo) {
      await this.statusRepo.save(
        this.statusRepo.create({
          label,
          passed: report.passed,
          cdmVersion: report.cdmVersion ?? null,
          vocabularyVersion: report.vocabularyVersion ?? null,
          checks: report.checks,
          checkedAt: new Date(report.checkedAt),
        }),
      );
    }

    if (report.passed) {
      // 兜底清理崩溃遗留的中间表（task 6.2）；清理失败不影响可用性判定。
      try {
        const swept = await this.scratchOf(label).sweep(RESULTS_ORPHAN_GRACE_MS);
        if (swept.length > 0) {
          this.audit?.record({
            action: 'retention-purge',
            actor: `data-source:${label}`,
            allowed: true,
            detail: `results 孤儿中间表兜底清理 ${swept.length} 张`,
          });
        }
      } catch (err) {
        this.logger.warn(`数据源 ${label} 的 results 兜底清理失败：${(err as Error).message}`);
      }
    }
    await this.coverage?.publish(report, executor);
    return report;
  }

  /** 该数据源的 results 中间表管理器（同一数据源共用，才知道谁在跑）。 */
  scratchOf(label: string): CdmResultsScratch {
    const scratch = this.scratches.get(label);
    if (!scratch) throw new DataSourceNotAvailableError(label, '未配置该数据源');
    return scratch;
  }

  /**
   * 取一个**已通过接入校验**的数据源执行器。没校验过或没通过一律抛——
   * 调用方 MUST 让任务失败，MUST NOT 改用文件数据（spec: 不得静默降级）。
   */
  requireAvailable(label: string): CdmExecutor {
    const executor = this.executors.get(label);
    if (!executor) throw new DataSourceNotAvailableError(label, '未配置该数据源');
    const report = this.reports.get(label);
    if (!report) throw new DataSourceNotAvailableError(label, '尚未完成接入校验');
    if (!report.passed) throw new DataSourceNotAvailableError(label, summarizeFailures(report));
    return executor;
  }

  /** 对外可见的状态视图（不含凭据）。 */
  statusOf(label: string): DataSourceStatusView | undefined {
    const config = this.configs.find((c) => c.label === label);
    if (!config) return undefined;
    const report = this.reports.get(label);
    return {
      description: describeSource(config),
      passed: report?.passed ?? false,
      checkedAt: report?.checkedAt,
      cdmVersion: report?.cdmVersion,
      vocabularyVersion: report?.vocabularyVersion,
      failures: (report?.checks ?? []).filter((c) => !c.passed).map((c) => c.detail),
    };
  }

  list(): DataSourceStatusView[] {
    return this.labels()
      .map((l) => this.statusOf(l))
      .filter((v): v is DataSourceStatusView => !!v);
  }
}
