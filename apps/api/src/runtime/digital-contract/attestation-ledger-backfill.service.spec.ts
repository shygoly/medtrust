import { AttestationLedgerService } from "./attestation-ledger.service";
import { AttestationLedgerBackfillService } from "./attestation-ledger-backfill.service";
import { fakeRepo } from "./attestation-ledger.test-utils";

const hex = (c: string) => c.repeat(64);

/**
 * 账本上线之前，各域已经把真实链上回执存在了各自的表里（RWS 任务、合约、MDOP 回执链锚定、
 * 节点证明登记）。回填把它们一次性补进存证指针账本，否则账本页会一直是空的。
 * 数据形状取自线上实录（任务 f7ea3eb9 / 作业 job-muxxx70z-e03b9dc1）。
 */
function makeFixture() {
  const refs = fakeRepo<any>();
  const rwsTasks = fakeRepo<any>([
    {
      // 描述性任务：merged.attestation
      taskId: "f7ea3eb9-d95b-4581-8759-6bf4fb8b7fdb",
      consumerId: "p-meddata",
      completedAt: new Date("2026-09-20T05:40:00.000Z"),
      merged: {
        analysisType: "disproportionality",
        attestation: {
          txHash:
            "9fe18251bd08d346aad76ca28a7b2004320cc371b15fd25c96e7e9c9ec83794e",
          block: 22,
          hash: "SM3:70d755b33b60e038e1f4d4827d3990a2ce7880be4fff756cd75973a996be2315",
        },
      },
    },
    {
      // 同一结果哈希、被降级成本地回执的任务：不是链上记录，不得入账本
      taskId: "da75b890-2593-4c1a-851e-4358a0d56349",
      consumerId: "p-meddata",
      completedAt: new Date("2026-10-07T09:48:56.338Z"),
      merged: {
        attestation: {
          txHash: "0xLOCAL:a103fb4ceb604229",
          block: 1840733,
          hash: "SM3:70d755b33b60e038e1f4d4827d3990a2ce7880be4fff756cd75973a996be2315",
        },
      },
    },
    {
      // L2/L3 meta 合并：merged.metaPooled.attestation
      taskId: "rws-meta",
      consumerId: "p-meddata",
      completedAt: new Date("2026-09-22T00:00:00.000Z"),
      merged: {
        metaPooled: {
          merged: true,
          attestation: {
            txHash: "tx-meta",
            block: 40,
            hash: "SM3:" + hex("1"),
          },
        },
      },
    },
    {
      // L0 算法核验：merged.l0Validation.attestation
      taskId: "rws-l0",
      consumerId: "p-meddata",
      completedAt: new Date("2026-09-23T00:00:00.000Z"),
      merged: {
        l0Validation: {
          merged: true,
          attestation: { txHash: "tx-l0", block: 41, hash: "SM3:" + hex("2") },
        },
      },
    },
    { taskId: "rws-running", consumerId: "p-meddata", merged: null },
  ]);
  const flTasks = fakeRepo<any>([
    {
      taskId: "fl-1",
      consumerId: "p-meddata",
      completedAt: new Date("2026-09-24T00:00:00.000Z"),
      merged: {
        attestation: {
          reportHash: "SM3:" + hex("3"),
          chainTxHash: "tx-fl",
          chainBlock: 50,
          generatedAt: "2026-09-24T00:00:01.000Z",
        },
      },
    },
  ]);
  const contracts = fakeRepo<any>([
    {
      id: "c-1",
      providerId: "p-huashan",
      consumerId: "p-meddata",
      hash: "SM3:" + hex("4"),
      attestationTxHash: "tx-contract",
      attestationBlock: 12,
      attestedAt: "2026-09-19T08:00:00.000Z",
    },
    {
      id: "c-local",
      providerId: "p-huashan",
      consumerId: "p-meddata",
      hash: "SM3:" + hex("5"),
      attestationTxHash: "0xLOCAL:deadbeef",
      attestationBlock: 1840001,
    },
    { id: "c-unattested", providerId: "p-ruijin", consumerId: "p-meddata" },
  ]);
  const mdopReceipts = fakeRepo<any>([
    {
      id: "job-muxxx70z-e03b9dc1#urn:tds:sh-med:participant:p-huashan#anchor",
      jobId: "job-muxxx70z-e03b9dc1",
      node: "urn:tds:sh-med:participant:p-huashan",
      kind: "anchor",
      payload: {
        node: "urn:tds:sh-med:participant:p-huashan",
        chain_head: "sm3:" + hex("6"),
        at: "2026-10-07T02:00:00.000Z",
        status: "anchored",
        tx_id: "tx-anchor-998",
        block: 998,
      },
    },
    {
      id: "job-pending#urn:tds:sh-med:participant:p-ruijin#anchor",
      jobId: "job-pending",
      node: "urn:tds:sh-med:participant:p-ruijin",
      kind: "anchor",
      payload: {
        chain_head: "sm3:" + hex("7"),
        at: "2026-10-07T02:00:00.000Z",
        status: "pending", // 链不可达时的补偿队列项：没有交易号
      },
    },
    {
      id: "job-muxxx70z-e03b9dc1#n#r1",
      jobId: "job-muxxx70z-e03b9dc1",
      node: "urn:tds:sh-med:participant:p-huashan",
      kind: "audit",
      payload: { receipt_id: "r1" },
    },
  ]);
  const mdopAttestations = fakeRepo<any>([
    {
      id: "urn:tds:sh-med:participant:tee-a#q1",
      node: "urn:tds:sh-med:participant:tee-a",
      jobId: "job-muxxx70z-e03b9dc1",
      quoteDigest: "sm3:" + hex("8"),
      chainTx: "tx-quote-984",
      chainBlock: 984,
      createdAt: new Date("2026-10-07T01:00:00.000Z"),
    },
    {
      id: "urn:tds:sh-med:participant:tee-a#q2",
      node: "urn:tds:sh-med:participant:tee-a",
      jobId: null, // 作业之前的证明背书：无归属作业
      quoteDigest: hex("9"),
      chainTx: "tx-quote-985",
      chainBlock: 985,
      createdAt: new Date("2026-10-07T01:10:00.000Z"),
    },
    {
      id: "urn:tds:sh-med:participant:tee-a#q3",
      node: "urn:tds:sh-med:participant:tee-a",
      quoteDigest: hex("a"),
      chainTx: null, // 未锚上：留在补偿队列
      createdAt: new Date("2026-10-07T01:20:00.000Z"),
    },
  ]);
  const ledger = new AttestationLedgerService(
    refs,
    rwsTasks,
    fakeRepo(),
    flTasks,
    fakeRepo(),
    contracts,
    fakeRepo<any>([{ id: "job-muxxx70z-e03b9dc1", contracts: ["c-1"] }]),
  );
  const backfill = new AttestationLedgerBackfillService(
    ledger,
    rwsTasks,
    flTasks,
    contracts,
    mdopReceipts,
    mdopAttestations,
  );
  return { ledger, backfill, refs };
}

describe("AttestationLedgerBackfillService — 历史链上回执补进账本", () => {
  it("imports every real on-chain receipt held by the domain tables", async () => {
    const { ledger, backfill } = makeFixture();
    const imported = await backfill.backfill();
    expect(imported).toBe(8);

    const rows = await ledger.list({ role: "operator" });
    const byTx = Object.fromEntries(rows.map((r) => [r.txHash, r]));
    expect(
      byTx["9fe18251bd08d346aad76ca28a7b2004320cc371b15fd25c96e7e9c9ec83794e"],
    ).toMatchObject({
      kind: "output",
      hash: "SM3:70d755b33b60e038e1f4d4827d3990a2ce7880be4fff756cd75973a996be2315",
      block: 22,
      subjectType: "rws-task",
      subjectId: "f7ea3eb9-d95b-4581-8759-6bf4fb8b7fdb",
      anchoredAt: "2026-09-20T05:40:00.000Z",
    });
    expect(byTx["tx-meta"]).toMatchObject({ kind: "output", block: 40 });
    expect(byTx["tx-l0"]).toMatchObject({ kind: "output", block: 41 });
    expect(byTx["tx-fl"]).toMatchObject({
      kind: "output",
      subjectType: "fl-task",
      subjectId: "fl-1",
      hash: "SM3:" + hex("3"),
      block: 50,
    });
    expect(byTx["tx-contract"]).toMatchObject({
      kind: "policy",
      subjectType: "contract",
      subjectId: "c-1",
      block: 12,
      anchoredAt: "2026-09-19T08:00:00.000Z",
    });
    expect(byTx["tx-anchor-998"]).toMatchObject({
      kind: "receipt-chain",
      hash: "SM3:" + hex("6"),
      block: 998,
      subjectType: "mdop-job",
      subjectId: "job-muxxx70z-e03b9dc1",
      anchoredAt: "2026-10-07T02:00:00.000Z",
    });
    expect(byTx["tx-quote-984"]).toMatchObject({
      kind: "node-attestation",
      hash: "SM3:" + hex("8"),
      block: 984,
      subjectType: "mdop-job",
      subjectId: "job-muxxx70z-e03b9dc1",
    });
    expect(byTx["tx-quote-985"]).toMatchObject({
      kind: "node-attestation",
      block: 985,
      subjectType: null,
      subjectId: null,
    });
  });

  it("skips local receipts and pending anchors — they are not on chain", async () => {
    const { ledger, backfill } = makeFixture();
    await backfill.backfill();
    const rows = await ledger.list({ role: "operator" });
    expect(rows.some((r) => r.txHash.startsWith("0xLOCAL:"))).toBe(false);
    expect(rows.some((r) => r.subjectId === "job-pending")).toBe(false);
    expect(
      rows.some((r) => r.subjectId === "da75b890-2593-4c1a-851e-4358a0d56349"),
    ).toBe(false);
    expect(rows.some((r) => r.subjectId === "c-local")).toBe(false);
  });

  it("is idempotent: a second run adds nothing", async () => {
    const { backfill, refs } = makeFixture();
    await backfill.backfill();
    const count = refs.rows.length;
    expect(await backfill.backfill()).toBe(0);
    expect(refs.rows.length).toBe(count);
  });

  it("lets the hospital see the anchors of the MDOP job it took part in", async () => {
    const { ledger, backfill } = makeFixture();
    await backfill.backfill();
    const rows = await ledger.list({
      role: "provider",
      participantId: "p-huashan",
    });
    expect(rows.map((r) => r.txHash).sort()).toEqual([
      "tx-anchor-998",
      "tx-contract",
      "tx-quote-984",
    ]);
  });

  it("never blocks boot when a source table cannot be read", async () => {
    const { backfill } = makeFixture();
    (backfill as any).rwsTasks.find = async () => {
      throw new Error("no such table: cp_rws_task");
    };
    await expect(backfill.onModuleInit()).resolves.toBeUndefined();
  });
});
