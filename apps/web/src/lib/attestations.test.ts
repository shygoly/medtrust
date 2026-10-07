import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBlock,
  formatDateTime,
  shortHash,
  toAttestationRows,
  type AttestationLedgerRecord,
} from "./attestations";

// 存证账本页读 GET /attestations（存证指针账本）。形状取自线上实录：
// RWS 任务结果在区块 22，MDOP 作业回执链头在区块 998–1000，节点证明摘要在区块 984/985。
const RECORDS: AttestationLedgerRecord[] = [
  {
    id: "r1",
    kind: "receipt-chain",
    hash: "SM3:6f1e0c9b2a4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
    txHash: "17a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3",
    block: 998,
    anchoredAt: "2026-10-07T02:03:04.000Z",
    subjectType: "mdop-job",
    subjectId: "job-muxxx70z-e03b9dc1",
    attestationLevel: "software",
  },
  {
    id: "r2",
    kind: "output",
    hash: "SM3:70d755b33b60e038e1f4d4827d3990a2ce7880be4fff756cd75973a996be2315",
    txHash: "9fe18251bd08d346aad76ca28a7b2004320cc371b15fd25c96e7e9c9ec83794e",
    block: 22,
    anchoredAt: "2026-09-20T05:40:00.000Z",
    subjectType: "rws-task",
    subjectId: "f7ea3eb9-d95b-4581-8759-6bf4fb8b7fdb",
    attestationLevel: "software",
  },
  {
    id: "r3",
    kind: "node-attestation",
    hash: "SM3:" + "8".repeat(64),
    txHash: "ab".repeat(32),
    block: 984,
    anchoredAt: "2026-10-07T01:00:00.000Z",
    subjectType: null,
    subjectId: null,
    attestationLevel: "software",
  },
];

test("maps ledger records to rows with type, hash, tx, block and time", () => {
  const rows = toAttestationRows(RECORDS, "Asia/Shanghai");
  assert.deepEqual(rows[0], {
    id: "r1",
    kind: "receipt-chain",
    kindLabel: "审计回执链",
    hash: "SM3:6f1e0c9b2a4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
    hashShort: "SM3:6f1e0c...8d9e0f",
    txHash: "17a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3",
    txShort: "17a3c5...d9f1a3",
    block: "Block #998",
    time: "2026-10-07 10:03",
    subjectLabel: "MDOP 作业",
    subjectId: "job-muxxx70z-e03b9dc1",
    subjectHref: "/space/mdop/jobs/job-muxxx70z-e03b9dc1",
  });
});

test("links each row to the object it attests", () => {
  const rows = toAttestationRows(RECORDS, "Asia/Shanghai");
  assert.equal(rows[1].kindLabel, "计算结果");
  assert.equal(rows[1].subjectLabel, "RWS 任务");
  assert.equal(
    rows[1].subjectHref,
    "/space/tasks/f7ea3eb9-d95b-4581-8759-6bf4fb8b7fdb?workload=rws",
  );
  assert.equal(rows[1].block, "Block #22");
});

test("a record without an owning object shows the empty mark, not a guess", () => {
  const rows = toAttestationRows(RECORDS, "Asia/Shanghai");
  assert.equal(rows[2].kindLabel, "节点证明摘要");
  assert.equal(rows[2].subjectLabel, "—");
  assert.equal(rows[2].subjectId, "—");
  assert.equal(rows[2].subjectHref, null);
});

test("an empty ledger maps to no rows (the page renders the empty state)", () => {
  assert.deepEqual(toAttestationRows([], "Asia/Shanghai"), []);
});

test("shortHash keeps the algorithm prefix and the first / last 6 hex digits", () => {
  assert.equal(
    shortHash("SM3:58496e0000000000000000000000000000000000000000000000000000a1c4f2"),
    "SM3:58496e...a1c4f2",
  );
  // 交易号没有前缀
  assert.equal(shortHash("9fe18251bd08d346aad76ca28a7b2004"), "9fe182...7b2004");
  // 短到不必截断的原样返回；空值用统一的空标记
  assert.equal(shortHash("abcdef012345"), "abcdef012345");
  assert.equal(shortHash(""), "—");
  assert.equal(shortHash(undefined), "—");
});

test("formatDateTime renders YYYY-MM-DD HH:mm in the viewer's zone", () => {
  assert.equal(
    formatDateTime("2026-09-20T05:40:00.000Z", "Asia/Shanghai"),
    "2026-09-20 13:40",
  );
  assert.equal(formatDateTime("2026-09-20T05:40:00.000Z", "UTC"), "2026-09-20 05:40");
  assert.equal(formatDateTime(undefined, "UTC"), "—");
  assert.equal(formatDateTime("not-a-date", "UTC"), "—");
});

test("formatBlock renders `Block #n` and never a fake height", () => {
  assert.equal(formatBlock(22), "Block #22");
  assert.equal(formatBlock(1018), "Block #1018");
  assert.equal(formatBlock(undefined), "—");
  assert.equal(formatBlock(Number.NaN), "—");
});
