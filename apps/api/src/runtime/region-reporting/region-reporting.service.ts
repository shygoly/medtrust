import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ndiIdFromInternal, ndiOrgCodeFromEnv } from "@medtrust/mdop";
import { SPACE_ID } from "@medtrust/demo-scenario";
import { ConnectorAdminService } from "../participant-identity/connector-admin.service";
import {
  createRegionStateReporter,
  type RegionReporterStatus,
  type RegionStateReporter,
  type RegionStateSnapshot,
} from "./region-reporter";

/** 上报状态（含调度信息）：系统状态页与接口共用。 */
export type RegionReportingStatus = RegionReporterStatus & {
  intervalMs: number;
  nextAttemptAt: string | null;
  lastSkipAt: string | null;
};

const DEFAULT_INTERVAL_MS = 5_000;
/** 连续失败后的退避上限：熔断窗口内定时器不再发起请求，避免打爆对端。 */
const MAX_BACKOFF_MS = 60_000;

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
  /** 退避/熔断窗口：窗口内定时器跳过，手动上报可强制。 */
  private nextAttemptAtMs = 0;
  private lastSkipAt: string | null = null;

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

  /**
   * 上报一次；失败只记录，绝不向上抛。
   *
   * - 定时器路径（`force=false`）：处于退避/熔断窗口内直接跳过，连快照都不建；
   * - 手动路径（`POST /report`，`force=true`）：忽略窗口立即尝试，语义是运维主动探活。
   */
  async reportNow(force = false): Promise<RegionReportingStatus> {
    if (!force && Date.now() < this.nextAttemptAtMs) {
      this.lastSkipAt = new Date().toISOString();
      return this.status();
    }
    try {
      const snapshot = await this.buildSnapshot();
      await this.reporter.report(snapshot);
      this.nextAttemptAtMs = 0;
    } catch (err) {
      const failures = Math.max(this.reporter.status().consecutiveFailures, 1);
      const backoff = Math.min(
        this.intervalMs * 2 ** (failures - 1),
        MAX_BACKOFF_MS,
      );
      this.nextAttemptAtMs = Date.now() + backoff;
      this.logger.warn(
        `区域节点状态上报失败（不影响主链路，${backoff}ms 后重试）：${(err as Error).message}`,
      );
    }
    return this.status();
  }

  status(): RegionReportingStatus {
    const base = this.reporter.status();
    return {
      ...base,
      intervalMs: this.intervalMs,
      nextAttemptAt:
        this.nextAttemptAtMs > Date.now()
          ? new Date(this.nextAttemptAtMs).toISOString()
          : null,
      lastSkipAt: this.lastSkipAt,
    };
  }

  /** 系统状态页用：一次给出上报状态与当前聚合快照（与上报告共用同一构造）。 */
  async adminView(): Promise<{
    status: RegionReportingStatus;
    snapshot: RegionStateSnapshot;
  }> {
    return { status: this.status(), snapshot: await this.buildSnapshot() };
  }

  async buildSnapshot(): Promise<RegionStateSnapshot> {
    const rows = await this.connectorAdmin.listRegistry();
    const orgCode = ndiOrgCodeFromEnv();
    const connectors = rows.map((row) => {
      const heartbeat = row.lastHeartbeat ?? null;
      const online = row.healthStatus === "online";
      // 心跳自报的 NDI 标识优先（与 ndi-identifier-alignment 联合验收）；
      // 还没报过标识时，机构码可用才由平台派生 —— 不猜默认值、不伪造。
      const ndiId =
        typeof heartbeat?.ndiId === "string" && heartbeat.ndiId.trim()
          ? heartbeat.ndiId.trim()
          : orgCode
            ? ndiIdFromInternal({
                internalId: row.participantId,
                orgCode,
                type: "connector" as const,
              })
            : undefined;
      return {
        connectorId: heartbeat?.connectorId?.trim() || row.participantId,
        participantId: row.participantId,
        ...(ndiId ? { ndiId } : {}),
        status: online ? ("online" as const) : ("offline" as const),
        lastSeenAt: row.lastSeen ? new Date(row.lastSeen).toISOString() : null,
        ...(heartbeat?.version ? { version: heartbeat.version } : {}),
        ...(heartbeat?.taskStatus ? { taskStatus: heartbeat.taskStatus } : {}),
        ...(heartbeat?.resources ? { load: heartbeat.resources } : {}),
      };
    });

    // 空间标识：平台按「业务节点」注册（draft-1 映射；04 正式文本到位后校正）。
    // 上报循环是进程级任务，没有请求上下文，故用进程默认空间。
    const spaceId = (process.env.SPACE_ID ?? SPACE_ID).trim() || SPACE_ID;
    const space = {
      spaceId,
      ...(orgCode
        ? {
            ndiId: ndiIdFromInternal({
              internalId: spaceId,
              orgCode,
              type: "business-node" as const,
            }),
          }
        : {}),
    };

    return {
      nodeId:
        (process.env.SILKROAD_NODE_ID ?? "silk-road").trim() || "silk-road",
      space,
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
    const raw = Number(
      process.env.REGION_STATE_REPORT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
    // 上限避免把 5 秒写成 5 小时；下限避免打爆对端。
    return Math.min(Math.max(Math.floor(raw), 1_000), 300_000);
  }
}
