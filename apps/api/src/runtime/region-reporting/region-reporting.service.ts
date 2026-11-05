import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ndiIdFromInternal, ndiOrgCodeFromEnv } from "@medtrust/mdop";
import { ConnectorAdminService } from "../participant-identity/connector-admin.service";
import {
  createRegionStateReporter,
  type RegionReporterStatus,
  type RegionStateReporter,
  type RegionStateSnapshot,
} from "./region-reporter";

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * 平台 → 区域/行业功能节点状态上报。
 *
 * 离线可用性（硬约束）：
 * - 未配置 endpoint：装配 Noop，只 warn 一次，**不启动定时器**；
 * - 已配置但不可达：只记录 lastError，不抛、不阻塞、不影响任何业务请求；
 * - 定时器 `unref()`，不阻止进程退出。
 */
@Injectable()
export class RegionReportingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegionReportingService.name);
  private readonly startedAt = Date.now();
  private readonly reporter: RegionStateReporter;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly connectorAdmin: ConnectorAdminService) {
    this.reporter = createRegionStateReporter();
    this.intervalMs = this.resolveInterval();
  }

  onModuleInit(): void {
    if (this.reporter.mode === "noop") {
      this.logger.warn(
        "区域节点状态上报未配置（SILKROAD_NODE_ENDPOINT 为空）：regionReporting=unconfigured，主链路不受影响",
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.reportNow();
    }, this.intervalMs);
    // 不阻止进程退出（测试与服务优雅停机都会更快）。
    this.timer.unref?.();
    this.logger.log(
      `区域节点状态上报已启用：每 ${this.intervalMs}ms 一次（单次 ≤5s）`,
    );
    void this.reportNow();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 立即上报一次；失败只记录，绝不向上抛。 */
  async reportNow(): Promise<RegionReporterStatus> {
    try {
      const snapshot = await this.buildSnapshot();
      await this.reporter.report(snapshot);
    } catch (err) {
      this.logger.warn(`区域节点状态上报失败（不影响主链路）：${(err as Error).message}`);
    }
    return this.reporter.status();
  }

  status(): RegionReporterStatus & { intervalMs: number } {
    return { ...this.reporter.status(), intervalMs: this.intervalMs };
  }

  async buildSnapshot(): Promise<RegionStateSnapshot> {
    const rows = await this.connectorAdmin.listRegistry();
    const orgCode = ndiOrgCodeFromEnv();
    const connectors = rows.map((row) => {
      const heartbeat = row.lastHeartbeat ?? null;
      const online = row.healthStatus === "online";
      return {
        participantId: row.participantId,
        // 机构码未配置时不生成标识（对外上报本身也已 fail-closed），不猜默认值。
        ...(orgCode
          ? {
              ndiId: ndiIdFromInternal({
                internalId: row.participantId,
                orgCode,
                type: "connector" as const,
              }),
            }
          : {}),
        status: online ? ("online" as const) : ("offline" as const),
        lastSeenAt: row.lastSeen ? new Date(row.lastSeen).toISOString() : null,
        ...(heartbeat?.version ? { version: heartbeat.version } : {}),
        ...(heartbeat?.taskStatus ? { taskStatus: heartbeat.taskStatus } : {}),
        ...(heartbeat?.resources ? { resources: heartbeat.resources } : {}),
      };
    });

    return {
      nodeId: (process.env.SILKROAD_NODE_ID ?? "silk-road").trim() || "silk-road",
      reportedAt: new Date().toISOString(),
      platform: {
        version: process.env.APP_VERSION ?? "1.0.0",
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        status: "online",
      },
      connectors,
    };
  }

  private resolveInterval(): number {
    const raw = Number(process.env.REGION_STATE_REPORT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
    // 上限避免把 5 秒写成 5 小时；下限避免打爆对端。
    return Math.min(Math.max(Math.floor(raw), 1_000), 300_000);
  }
}
