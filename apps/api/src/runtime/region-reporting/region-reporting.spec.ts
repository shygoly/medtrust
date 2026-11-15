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
      expect(reporter.status()).toMatchObject({
        failures: 1,
        lastError: "HTTP 500",
      });
    });
  });

  describe("snapshot 与主链路隔离", () => {
    it("聚合连接器状态：在线/离线、心跳明细、NDI 标识（配置机构码时）", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      const service = new RegionReportingService({
        listRegistry: async () => [
          row(),
          row({
            participantId: "p-demohospb",
            healthStatus: "offline",
            lastSeen: null,
          }),
        ],
      } as never);
      const snapshot = await service.buildSnapshot();
      expect(snapshot.connectors).toHaveLength(2);
      expect(snapshot.connectors[0]).toMatchObject({
        connectorId: "p-demohospa", // 心跳未报 connectorId 时回退 participantId
        participantId: "p-demohospa",
        status: "online",
        version: "1.2.3",
        load: { heapUsedMb: 12 },
      });
      expect(snapshot.connectors[0].ndiId).toMatch(/^ndi:draft-1:connector:/);
      // 空间标识：机构码可用时按业务节点编码（draft-1 映射）
      expect(snapshot.space?.spaceId).toBeTruthy();
      expect(snapshot.space?.ndiId).toMatch(/^ndi:draft-1:business-node:/);
      expect(snapshot.connectors[1]).toMatchObject({
        status: "offline",
        lastSeenAt: null,
      });
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

    it("心跳自报的 ndiId 优先于平台派生；connectorId 取心跳值", async () => {
      process.env.NDI_ORG_CODE = "91610131MA6U000000";
      const service = new RegionReportingService({
        listRegistry: async () => [
          row({
            lastHeartbeat: {
              connectorId: "cn-demohospb",
              ndiId:
                "ndi:draft-1:connector:91610131MA6U000000:aaaaaaaaaaaa:0000",
              resources: { rssMb: 64 },
            },
          }),
        ],
      } as never);
      const snapshot = await service.buildSnapshot();
      expect(snapshot.connectors[0].connectorId).toBe("cn-demohospb");
      expect(snapshot.connectors[0].ndiId).toBe(
        "ndi:draft-1:connector:91610131MA6U000000:aaaaaaaaaaaa:0000",
      );
      expect(snapshot.connectors[0].load).toEqual({ rssMb: 64 });
    });

    it("上报失败后退避：窗口内定时器跳过，手动 force 仍立即尝试", async () => {
      process.env.SILKROAD_NODE_ENDPOINT = "http://region.test";
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockRejectedValue(new Error("ECONNREFUSED"));
      const service = new RegionReportingService({
        listRegistry: async () => [],
      } as never);

      const first = await service.reportNow();
      expect(first.failures).toBe(1);
      expect(first.nextAttemptAt).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 定时器路径：窗口内直接跳过（不再发请求）
      const skipped = await service.reportNow();
      expect(skipped.lastSkipAt).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 运维手动探活：忽略窗口
      await service.reportNow(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("adminView 同时给上报状态与聚合快照（状态页与上报告同源）", async () => {
      const service = new RegionReportingService({
        listRegistry: async () => [row()],
      } as never);
      const view = await service.adminView();
      expect(view.status.regionReporting).toBe("unconfigured");
      expect(view.snapshot.connectors).toHaveLength(1);
      expect(view.snapshot.connectors[0].connectorId).toBe("p-demohospa");
    });

    it("未配置时 init 只 warn、不启动定时器", () => {
      delete process.env.SILKROAD_NODE_ENDPOINT;
      const service = new RegionReportingService({
        listRegistry: async () => [],
      } as never);
      expect(() => service.onModuleInit()).not.toThrow();
      expect(service.status()).toMatchObject({
        regionReporting: "unconfigured",
      });
      expect(service.status().intervalMs).toBe(5_000);
      service.onModuleDestroy();
    });
  });
});
