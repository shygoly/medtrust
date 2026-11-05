import {
  createRegionStateReporter,
  HttpRegionStateReporter,
  NoopRegionStateReporter,
} from "./region-reporter";
import { RegionReportingService } from "./region-reporting.service";

const row = (over: Record<string, unknown> = {}) => ({
  participantId: "p-demohospa",
  healthStatus: "online",
  lastSeen: new Date("2026-11-05T00:00:00Z"),
  lastHeartbeat: {
    version: "1.2.3",
    taskStatus: { running: 1 },
    resources: { heapUsedMb: 12 },
  },
  ...over,
});

describe("区域节点状态上报（平台侧）", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  describe("reporter 装配", () => {
    it("未配置 endpoint → Noop（不产生外部调用，语义 unconfigured）", async () => {
      const reporter = createRegionStateReporter({ endpoint: "" });
      expect(reporter).toBeInstanceOf(NoopRegionStateReporter);
      const fetchSpy = jest.spyOn(global, "fetch");
      await expect(
        reporter.report({
          nodeId: "silk-road",
          reportedAt: "2026-11-05T00:00:00Z",
          platform: { version: "1", uptimeSeconds: 1, status: "online" },
          connectors: [],
        }),
      ).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reporter.status()).toMatchObject({
        mode: "noop",
        regionReporting: "unconfigured",
        failures: 0,
      });
    });

    it("配置 endpoint → HTTP 上报器 POST /connector-state，带 X-Node-Id", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const reporter = createRegionStateReporter({
        endpoint: "http://region.test/",
        nodeId: "node-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(reporter).toBeInstanceOf(HttpRegionStateReporter);
      await reporter.report({
        nodeId: "node-1",
        reportedAt: "2026-11-05T00:00:00Z",
        platform: { version: "1", uptimeSeconds: 1, status: "online" },
        connectors: [],
      });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("http://region.test/connector-state");
      expect(init.method).toBe("POST");
      expect(init.headers["X-Node-Id"]).toBe("node-1");
      expect(reporter.status()).toMatchObject({
        regionReporting: "configured",
        failures: 0,
      });
      expect(reporter.status().lastSuccessAt).not.toBeNull();
    });

    it("对端 500 → 记录失败但只抛给调用方（由 service 吞掉）", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const reporter = new HttpRegionStateReporter(
        "http://region.test",
        "node-1",
        1_000,
        fetchImpl as unknown as typeof fetch,
      );
      await expect(
        reporter.report({
          nodeId: "node-1",
          reportedAt: "2026-11-05T00:00:00Z",
          platform: { version: "1", uptimeSeconds: 1, status: "online" },
          connectors: [],
        }),
      ).rejects.toThrow("HTTP 500");
      expect(reporter.status()).toMatchObject({ failures: 1, lastError: "HTTP 500" });
    });
  });

  describe("snapshot 与主链路隔离", () => {
    it("聚合连接器状态：在线/离线、心跳明细、NDI 标识（配置机构码时）", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      const service = new RegionReportingService({
        listRegistry: async () => [
          row(),
          row({ participantId: "p-demohospb", healthStatus: "offline", lastSeen: null }),
        ],
      } as never);
      const snapshot = await service.buildSnapshot();
      expect(snapshot.connectors).toHaveLength(2);
      expect(snapshot.connectors[0]).toMatchObject({
        participantId: "p-demohospa",
        status: "online",
        version: "1.2.3",
      });
      expect(snapshot.connectors[0].ndiId).toMatch(/^ndi:draft-1:connector:/);
      expect(snapshot.connectors[1]).toMatchObject({ status: "offline", lastSeenAt: null });
    });

    it("未配置机构码时不生成 ndiId（不猜默认值）", async () => {
      delete process.env.NDI_ORG_CODE;
      const service = new RegionReportingService({
        listRegistry: async () => [row()],
      } as never);
      const snapshot = await service.buildSnapshot();
      expect(snapshot.connectors[0].ndiId).toBeUndefined();
    });

    it("上报失败不影响调用方：reportNow 只记录，不抛", async () => {
      process.env.SILKROAD_NODE_ENDPOINT = "http://region.test";
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      const service = new RegionReportingService({
        listRegistry: async () => [row()],
      } as never);
      await expect(service.reportNow()).resolves.toMatchObject({
        regionReporting: "configured",
        failures: 1,
      });
      expect(service.status().lastError).toContain("ECONNREFUSED");
    });

    it("未配置时 init 只 warn、不启动定时器", () => {
      delete process.env.SILKROAD_NODE_ENDPOINT;
      const service = new RegionReportingService({
        listRegistry: async () => [],
      } as never);
      expect(() => service.onModuleInit()).not.toThrow();
      expect(service.status()).toMatchObject({ regionReporting: "unconfigured" });
      expect(service.status().intervalMs).toBe(5_000);
      service.onModuleDestroy();
    });
  });
});
