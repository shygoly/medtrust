import { RbqmService } from "./rbqm.service";
import { SEED_KRI_DEFINITIONS } from "./kri-catalog";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

/**
 * RbqmService.ingest 编排集成验收（无 DB 驱动，用内存假仓）：
 * 观测入库 → 抑制处理 → 越限检测 → 越限记录 + 存证。
 * 证明真实服务逻辑（非仅纯函数）可端到端跑通，不依赖本地 better-sqlite3。
 */

// 极简内存假仓，覆盖 RbqmService 用到的 create/save/findOne/find。
class FakeRepo<T extends { id?: string }> {
  rows: T[] = [];
  constructor(seed: T[] = []) {
    this.rows = [...seed];
  }
  create(x: Partial<T>): T {
    return { ...(x as T) };
  }
  async save(x: T): Promise<T> {
    if (!x.id) x.id = "gen-" + Math.random().toString(36).slice(2);
    const i = this.rows.findIndex((r) => r.id === x.id);
    if (i >= 0) this.rows[i] = x;
    else this.rows.push(x);
    return x;
  }
  async findOne(opts: { where: Partial<T> }): Promise<T | null> {
    const w = opts.where;
    return (
      this.rows.find((r) =>
        Object.keys(w).every((k) => (r as any)[k] === (w as any)[k]),
      ) ?? null
    );
  }
  async find(opts?: { where?: Partial<T> }): Promise<T[]> {
    const w = opts?.where ?? {};
    return this.rows.filter((r) =>
      Object.keys(w).every((k) => (r as any)[k] === (w as any)[k]),
    );
  }
}

function makeService() {
  const defs = new FakeRepo<any>(SEED_KRI_DEFINITIONS.map((d) => ({ ...d })));
  const obs = new FakeRepo<any>();
  const breaches = new FakeRepo<any>();
  const attestation = {
    anchor: jest.fn(async (hash: string) => ({
      txHash: "0xLOCAL:" + hash.slice(4, 20),
      block: 1_840_777,
      hash,
      attestationLevel: "software" as const,
    })),
  };
  const svc = new RbqmService(
    defs as any,
    obs as any,
    breaches as any,
    new GMCryptoService(),
    attestation as any,
  );
  return { svc, defs, obs, breaches, attestation };
}

describe("RbqmService.ingest (integration, in-memory repos)", () => {
  it("stores a breaching observation, creates a critical breach, and anchors it", async () => {
    const { svc, attestation } = makeService();
    const { observation, breach } = await svc.ingest({
      id: "obs-1",
      kriCode: "AE_SUBJECT_RATE",
      siteId: "p-demohospa",
      siteName: "示范甲医院",
      studyId: "study-x",
      numerator: 53,
      denominator: 126, // 0.42 ≥ critical 0.40
    });

    expect(observation.suppressed).toBe(false);
    expect(observation.value).toBeCloseTo(0.42, 2);
    expect(observation.sourceDigest.startsWith("SM3:")).toBe(true);

    expect(breach).toBeDefined();
    expect(breach!.severity).toBe("critical");
    expect(breach!.thresholdValue).toBe(0.4);
    expect(breach!.status).toBe("open");
    expect(breach!.attestationTxHash).toMatch(/^0xLOCAL:/);
    expect(breach!.attestationBlock).toBe(1_840_777);
    expect(attestation.anchor).toHaveBeenCalledTimes(1);
  });

  it("does not create a breach for a within-tolerance observation", async () => {
    const { svc, breaches, attestation } = makeService();
    const { breach } = await svc.ingest({
      id: "obs-2",
      kriCode: "MISSING_KEY_FIELD_RATE",
      siteId: "p-demohospa",
      numerator: 8,
      denominator: 126, // 0.063 < warning 0.10
    });
    expect(breach).toBeUndefined();
    expect(breaches.rows.length).toBe(0);
    expect(attestation.anchor).not.toHaveBeenCalled();
  });

  it("zeroes counts and skips breach evaluation for a suppressed observation", async () => {
    const { svc, breaches, attestation } = makeService();
    const { observation, breach } = await svc.ingest({
      id: "obs-3",
      kriCode: "AE_SUBJECT_RATE",
      siteId: "p-demohospb",
      numerator: 2,
      denominator: 3,
      suppressed: true,
    });
    expect(observation.suppressed).toBe(true);
    expect(observation.numerator).toBe(0);
    expect(observation.denominator).toBe(0);
    expect(observation.value).toBe(0);
    expect(breach).toBeUndefined();
    expect(breaches.rows.length).toBe(0);
    expect(attestation.anchor).not.toHaveBeenCalled();
  });

  it("lists breaches and acknowledges one", async () => {
    const { svc } = makeService();
    const { breach } = await svc.ingest({
      id: "obs-4",
      kriCode: "AE_SUBJECT_RATE",
      siteId: "p-demohospb",
      numerator: 27,
      denominator: 98, // 0.276 → warning
    });
    expect(breach!.severity).toBe("warning");

    const open = await svc.listBreaches("open");
    expect(open.length).toBe(1);

    const acked = await svc.acknowledgeBreach(breach!.id);
    expect(acked?.status).toBe("acknowledged");
  });

  it("seeds the full catalog idempotently via onModuleInit (defs + observations + breaches)", async () => {
    const { svc, defs, obs, breaches } = makeService();
    await svc.onModuleInit();
    await svc.onModuleInit(); // second run must not duplicate

    // 4 KRI defs (already seeded in FakeRepo) stay 4; observations seeded once.
    expect(defs.rows.length).toBe(SEED_KRI_DEFINITIONS.length);
    // 8 seeded observations, no duplicates on re-run
    expect(obs.rows.length).toBe(8);
    // 示范甲 AE critical + 示范甲 followup warning + 示范乙 AE warning + 示范乙 missing warning = 4 breaches
    expect(breaches.rows.length).toBe(4);
    const severities = breaches.rows.map((b: any) => b.severity).sort();
    expect(severities).toEqual(["critical", "warning", "warning", "warning"]);
  });
});
