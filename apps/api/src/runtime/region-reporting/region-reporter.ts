/**
 * 区域/行业功能节点状态上报（TC609-6-2025-16 §6.2 c；TC609-6-2025-11 运行状态）。
 *
 * 归属：**平台**向区域节点上报连接器状态，不是每家院内连接器直接上报。
 * 离线可用性：未配置 endpoint 时装配 Noop 上报器（**不是** fail-closed client），
 * 只 warn、不抛、不计错误率；上报失败只记录状态，不影响主链路。
 */

export interface RegionConnectorState {
  participantId: string;
  /** NDI-TR-2025-04 标识（未配置机构码时缺省）。 */
  ndiId?: string;
  status: "online" | "offline";
  lastSeenAt: string | null;
  version?: string;
  taskStatus?: Record<string, unknown>;
  resources?: Record<string, unknown>;
}

export interface RegionStateSnapshot {
  nodeId: string;
  reportedAt: string;
  platform: {
    version: string;
    uptimeSeconds: number;
    status: "online";
  };
  connectors: RegionConnectorState[];
}

export type RegionReporterMode = "noop" | "http";

export interface RegionReporterStatus {
  mode: RegionReporterMode;
  /** 未配置时的显式语义，供系统状态页展示，禁止写成「已上报」。 */
  regionReporting: "unconfigured" | "configured";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  attempts: number;
  failures: number;
}

export interface RegionStateReporter {
  readonly mode: RegionReporterMode;
  report(snapshot: RegionStateSnapshot): Promise<void>;
  status(): RegionReporterStatus;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class NoopRegionStateReporter implements RegionStateReporter {
  readonly mode = "noop" as const;
  private attempts = 0;
  private lastAttemptAt: string | null = null;

  async report(): Promise<void> {
    // 故意什么都不做：未配置区域节点时不得产生任何外部调用。
    this.attempts += 1;
    this.lastAttemptAt = new Date().toISOString();
  }

  status(): RegionReporterStatus {
    return {
      mode: "noop",
      regionReporting: "unconfigured",
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: null,
      lastError: null,
      attempts: this.attempts,
      failures: 0,
    };
  }
}

export class HttpRegionStateReporter implements RegionStateReporter {
  readonly mode = "http" as const;
  private lastAttemptAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private attempts = 0;
  private failures = 0;

  constructor(
    private readonly endpoint: string,
    private readonly nodeId: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async report(snapshot: RegionStateSnapshot): Promise<void> {
    this.attempts += 1;
    this.lastAttemptAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(
        `${this.endpoint.replace(/\/$/, "")}/connector-state`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Node-Id": this.nodeId,
          },
          body: JSON.stringify(snapshot),
          signal: controller.signal,
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
    } catch (err) {
      this.failures += 1;
      this.lastError = (err as Error).message;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  status(): RegionReporterStatus {
    return {
      mode: "http",
      regionReporting: "configured",
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      attempts: this.attempts,
      failures: this.failures,
    };
  }
}

/**
 * 装配：endpoint 为空 → Noop（不抛错、不打错误率）；
 * 配置了 → HTTP 上报器，单次请求 ≤5s，避免拖慢主链路。
 */
export function createRegionStateReporter(input?: {
  endpoint?: string;
  nodeId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): RegionStateReporter {
  const endpoint = (input?.endpoint ?? process.env.SILKROAD_NODE_ENDPOINT ?? "").trim();
  const nodeId = (input?.nodeId ?? process.env.SILKROAD_NODE_ID ?? "silk-road").trim();
  if (!endpoint) return new NoopRegionStateReporter();
  return new HttpRegionStateReporter(
    endpoint,
    nodeId || "silk-road",
    input?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    input?.fetchImpl ?? fetch,
  );
}
