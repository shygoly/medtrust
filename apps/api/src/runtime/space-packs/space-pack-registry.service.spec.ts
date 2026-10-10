import {
  DEFAULT_ALLOWED_PACKS,
  SpacePackRegistryService,
  parseAllowedPacks,
} from "./space-pack-registry.service";
import {
  egressFromOutputPolicy,
  meteringFromService,
  operatorsFromRegistry,
} from "./spi-bindings";

function meteringStub() {
  return {
    measure: jest.fn().mockReturnValue({
      engine: { id: "proxy-count", version: "1", digest: "n/a", mode: "proxy" },
      contributions: [],
    }),
  } as any;
}

describe("医疗包挂载与装配（P1.2 / P1.3）", () => {
  const prev = process.env.SPACE_PACKS;
  afterEach(() => {
    if (prev === undefined) delete process.env.SPACE_PACKS;
    else process.env.SPACE_PACKS = prev;
  });

  it("部署白名单解析：缺省 med；显式列表优先", () => {
    assertPacks(parseAllowedPacks(undefined), [...DEFAULT_ALLOWED_PACKS]);
    assertPacks(parseAllowedPacks(""), [...DEFAULT_ALLOWED_PACKS]);
    assertPacks(parseAllowedPacks(" med , power "), ["med", "power"]);
  });

  it("装载：白名单含 med 时注册并挂上既有实现", () => {
    delete process.env.SPACE_PACKS;
    const svc = new SpacePackRegistryService(meteringStub());
    svc.onModuleInit();
    svc.enableForSpace({ spaceId: "s1" });
    expect(svc.packsForSpace({ spaceId: "s1" })).toEqual(["med"]);
    const reg = svc.registry.enabled({ spaceId: "s1" })[0];
    expect(reg.manifest.id).toBe("med");
    expect(reg.bundle.egress).toBeDefined();
    expect(reg.bundle.metering).toBeDefined();
  });

  it("装载：白名单不含 med 时不注册，启用即拒", () => {
    process.env.SPACE_PACKS = "power";
    const svc = new SpacePackRegistryService(meteringStub());
    svc.onModuleInit();
    expect(svc.allowedPacks()).toEqual(["power"]);
    expect(() => svc.enableForSpace({ spaceId: "s1" })).toThrow(
      /PACK_NOT_ALLOWED|PACK_NOT_REGISTERED/,
    );
  });

  it("启用集按空间独立", () => {
    delete process.env.SPACE_PACKS;
    const svc = new SpacePackRegistryService(meteringStub());
    svc.onModuleInit();
    svc.enableForSpace({ spaceId: "s1" });
    expect(svc.packsForSpace({ spaceId: "s1" })).toEqual(["med"]);
    expect(svc.packsForSpace({ spaceId: "s2" })).toEqual([]);
  });

  it("S3 出域模板来自既有合约 outputPolicy（单一事实源）", () => {
    const t = egressFromOutputPolicy().resolve({ spaceId: "s1" });
    expect(t.minimumCount).toBe(5); // DEFAULT_MIN_CELL
    expect(t.allowedArtifacts).toContain("aggregate_stats");
    expect(t.rules[0]).toEqual({
      id: "min-count",
      kind: "minimum-count",
      params: { minimumCount: 5 },
    });
  });

  it("S2 算子来自注册表：摘要只搬运、不生成", () => {
    const src = {
      list: () => [
        {
          analysisType: "disproportionality",
          sm3: "ab".repeat(32),
          abiVersion: 1,
          operator: {
            id: "rws.disproportionality",
            version: "1.0.0",
            category: "local",
            environments: ["connector-local"],
            inputs: [{ name: "in", schema: "table", accept_labels: ["C0"] }],
            outputs: [{ name: "out", schema: "table", label_rule: "min-cell" }],
          },
        },
      ],
    };
    const ops = operatorsFromRegistry(src as never).declareOperators({
      spaceId: "s1",
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].digest).toBe("ab".repeat(32));
    expect(ops[0].inputs[0].acceptLabels).toEqual(["C0"]);
    expect(ops[0].outputs[0].labelRule).toBe("min-cell");
  });

  it("S4 计量：委托既有服务并透传空间；MUST NOT 改写 mode", async () => {
    const stub = meteringStub();
    const provider = meteringFromService(stub);
    const out = await provider.measure(
      { spaceId: "s1" },
      { taskId: "t1", outputs: [] },
    );
    expect(stub.measure).toHaveBeenCalledWith(
      { taskId: "t1", outputs: [] },
      "s1",
    );
    expect((out as any).engine.mode).toBe("proxy"); // 兜底口径如实标注
  });
});

function assertPacks(actual: readonly string[], expected: readonly string[]) {
  expect([...actual]).toEqual([...expected]);
}
