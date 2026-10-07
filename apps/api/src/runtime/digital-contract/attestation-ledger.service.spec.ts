import {
  AttestationLedgerService,
  normalizeAttestationHash,
} from "./attestation-ledger.service";
import { fakeRepo } from "./attestation-ledger.test-utils";

const HASH_A = "SM3:" + "a".repeat(64);
const HASH_B = "SM3:" + "b".repeat(64);
const HASH_C = "SM3:" + "c".repeat(64);
const HASH_D = "SM3:" + "d".repeat(64);
const HASH_E = "SM3:" + "e".repeat(64);

function makeLedger() {
  const refs = fakeRepo<any>();
  const rwsTasks = fakeRepo<any>([
    { taskId: "rws-1", consumerId: "p-meddata" },
    { taskId: "rws-2", consumerId: "p-other-pharma" },
  ]);
  const rwsAssignments = fakeRepo<any>([
    { assignmentId: "a1", taskId: "rws-1", providerId: "p-huashan" },
    { assignmentId: "a2", taskId: "rws-2", providerId: "p-ruijin" },
  ]);
  const flTasks = fakeRepo<any>([{ taskId: "fl-1", consumerId: "p-meddata" }]);
  const flAssignments = fakeRepo<any>([
    { assignmentId: "f1", taskId: "fl-1", providerId: "p-ruijin" },
  ]);
  const contracts = fakeRepo<any>([
    { id: "c-1", providerId: "p-huashan", consumerId: "p-meddata" },
    { id: "c-2", providerId: "p-ruijin", consumerId: "p-other-pharma" },
  ]);
  const mdopJobs = fakeRepo<any>([
    { id: "job-1", contracts: ["c-1"] },
    { id: "job-2", contracts: ["c-2"] },
  ]);
  const ledger = new AttestationLedgerService(
    refs,
    rwsTasks,
    rwsAssignments,
    flTasks,
    flAssignments,
    contracts,
    mdopJobs,
  );
  return { ledger, refs };
}

async function seed(ledger: AttestationLedgerService) {
  await ledger.record({
    hash: HASH_A,
    txHash: "tx-a",
    block: 22,
    kind: "output",
    subjectType: "rws-task",
    subjectId: "rws-1",
    anchoredAt: "2026-09-20T05:40:00.000Z",
  });
  await ledger.record({
    hash: HASH_B,
    txHash: "tx-b",
    block: 998,
    kind: "receipt-chain",
    subjectType: "mdop-job",
    subjectId: "job-1",
    anchoredAt: "2026-10-07T01:00:00.000Z",
  });
  await ledger.record({
    hash: HASH_C,
    txHash: "tx-c",
    block: 30,
    kind: "output",
    subjectType: "rws-task",
    subjectId: "rws-2",
    anchoredAt: "2026-09-21T00:00:00.000Z",
  });
  await ledger.record({
    hash: HASH_D,
    txHash: "tx-d",
    block: 984,
    kind: "node-attestation",
    anchoredAt: "2026-10-06T00:00:00.000Z",
  });
  await ledger.record({
    hash: HASH_E,
    txHash: "tx-e",
    block: 12,
    kind: "policy",
    subjectType: "contract",
    subjectId: "c-2",
    anchoredAt: "2026-09-19T00:00:00.000Z",
  });
}

describe("AttestationLedgerService — 存证指针账本", () => {
  it("normalizes hashes so `sm3:` / `SM3:` / bare hex address the same record", () => {
    const hex = "AB".repeat(32);
    const canonical = "SM3:" + "ab".repeat(32);
    expect(normalizeAttestationHash(hex)).toBe(canonical);
    expect(normalizeAttestationHash("sm3:" + hex)).toBe(canonical);
    expect(normalizeAttestationHash("SM3:" + hex)).toBe(canonical);
  });

  it("finds a recorded on-chain attestation by hash, whatever the prefix case", async () => {
    const { ledger } = makeLedger();
    await seed(ledger);
    const found = await ledger.findByHash("sm3:" + "a".repeat(64));
    expect(found?.txHash).toBe("tx-a");
    expect(Number(found?.block)).toBe(22);
    expect(await ledger.findByHash("SM3:" + "f".repeat(64))).toBeNull();
  });

  it("is idempotent per (hash, subject) and lets a second subject reference the same chain record", async () => {
    const { ledger, refs } = makeLedger();
    await seed(ledger);
    const before = refs.rows.length;
    // 同一对象重复登记：不新增
    await ledger.record({
      hash: HASH_A,
      txHash: "tx-a",
      block: 22,
      kind: "output",
      subjectType: "rws-task",
      subjectId: "rws-1",
    });
    expect(refs.rows.length).toBe(before);
    // 另一个任务算出同一结果哈希：新增一条指针，指向**同一笔**链上交易
    await ledger.record({
      hash: HASH_A,
      txHash: "tx-a",
      block: 22,
      kind: "output",
      subjectType: "rws-task",
      subjectId: "rws-2",
    });
    expect(refs.rows.length).toBe(before + 1);
    expect(
      refs.rows.filter((r: any) => r.hash === HASH_A).map((r: any) => r.txHash),
    ).toEqual(["tx-a", "tx-a"]);
  });

  it("never records a degraded local receipt as an on-chain attestation", async () => {
    const { ledger, refs } = makeLedger();
    await expect(
      ledger.record({
        hash: HASH_A,
        txHash: "0xLOCAL:a103fb4ceb604229",
        block: 1840733,
        kind: "output",
      }),
    ).resolves.toBeNull();
    expect(refs.rows).toHaveLength(0);
  });

  describe("list — 按角色控权", () => {
    it("operator / compliance see every on-chain attestation, newest first", async () => {
      const { ledger } = makeLedger();
      await seed(ledger);
      for (const role of ["operator", "compliance"]) {
        const rows = await ledger.list({ role, participantId: "p-platform" });
        expect(rows.map((r) => r.txHash)).toEqual([
          "tx-b",
          "tx-d",
          "tx-c",
          "tx-a",
          "tx-e",
        ]);
      }
    });

    it("returns type / hash / txHash / block / time for each row", async () => {
      const { ledger } = makeLedger();
      await seed(ledger);
      const [first] = await ledger.list({ role: "operator" });
      expect(first).toEqual({
        id: expect.any(String),
        kind: "receipt-chain",
        hash: HASH_B,
        txHash: "tx-b",
        block: 998,
        anchoredAt: "2026-10-07T01:00:00.000Z",
        subjectType: "mdop-job",
        subjectId: "job-1",
        attestationLevel: "software",
      });
    });

    it("a consumer sees only attestations of its own tasks, jobs and contracts", async () => {
      const { ledger } = makeLedger();
      await seed(ledger);
      const rows = await ledger.list({
        role: "consumer",
        participantId: "p-meddata",
      });
      expect(rows.map((r) => r.txHash).sort()).toEqual(["tx-a", "tx-b"]);
    });

    it("a provider (hospital) sees attestations of the work it took part in", async () => {
      const { ledger } = makeLedger();
      await seed(ledger);
      const huashan = await ledger.list({
        role: "provider",
        participantId: "p-huashan",
      });
      expect(huashan.map((r) => r.txHash).sort()).toEqual(["tx-a", "tx-b"]);
      const ruijin = await ledger.list({
        role: "provider",
        participantId: "p-ruijin",
      });
      expect(ruijin.map((r) => r.txHash).sort()).toEqual(["tx-c", "tx-e"]);
    });

    it("matches participants the same way the contract list does (seed aliases)", async () => {
      const { ledger } = makeLedger();
      await seed(ledger);
      // 种子合约里提供方可能写的是机构显示名而不是 participantId
      const aliased = new AttestationLedgerService(
        (ledger as any).refs,
        fakeRepo(),
        fakeRepo(),
        fakeRepo(),
        fakeRepo(),
        fakeRepo<any>([
          { id: "c-2", providerId: "瑞金医院", consumerId: "p-other-pharma" },
        ]),
        fakeRepo(),
      );
      const rows = await aliased.list({
        role: "provider",
        participantId: "p-ruijin",
      });
      expect(rows.map((r) => r.txHash)).toEqual(["tx-e"]);
    });

    it("fails closed: no participant identity or unknown role sees nothing", async () => {
      const { ledger } = makeLedger();
      await seed(ledger);
      expect(await ledger.list({ role: "consumer" })).toEqual([]);
      expect(await ledger.list({ participantId: "p-meddata" })).toEqual([]);
      expect(await ledger.list({})).toEqual([]);
    });
  });
});
