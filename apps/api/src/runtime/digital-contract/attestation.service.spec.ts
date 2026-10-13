import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ContractService } from "./contract.service";
import { CatalogService } from "../catalog/catalog.service";
import { AttestationService } from "./attestation.service";
import {
  ChainAdapter,
  ChainTxRevertedError,
} from "../../blockchain/adapters/chain.adapter";
import { mockRepo } from "../test-utils/mock-repo";
import { AttestationLedgerService } from "./attestation-ledger.service";
import { fakeRepo } from "./attestation-ledger.test-utils";

describe("AttestationService — 策略哈希上链 (4.3)", () => {
  let gm: GMCryptoService;
  let contracts: ContractService;
  let att: AttestationService;
  beforeEach(() => {
    gm = new GMCryptoService();
    const catalog = {
      get: async (id: string) => ({
        id,
        homeSpace: "sh-med",
        providerId: "p1",
        title: "t",
        rightsConfirmed: true,
        status: "active",
      }),
    } as unknown as CatalogService;
    contracts = new ContractService(gm, mockRepo(), catalog);
    att = new AttestationService(gm);
  });

  it("anchors a contract and returns a tx receipt", async () => {
    const c = await contracts.approve({
      dataProductId: "dp-1",
      providerId: "p1",
      consumerId: "p2",
      purpose: "药物警戒",
      retention: "阅后即焚",
      output: "仅聚合",
      validDays: 90,
    });
    const r = await att.attestContract(c);
    expect(r.txHash).toMatch(/^0x/);
    expect(r.hash).toBe(c.hash);
    expect(r.block).toBeGreaterThan(0);
  });

  it("anchors only the hash — receipt carries no contract content", async () => {
    const c = await contracts.approve({
      dataProductId: "dp-1",
      providerId: "p1",
      consumerId: "p2",
      purpose: "药物警戒",
      retention: "阅后即焚",
      output: "仅聚合",
      validDays: 90,
    });
    const r = await att.attestContract(c);
    const json = JSON.stringify(r);
    expect(json).not.toContain("药物警戒");
    expect(json).not.toContain("p-demohospa");
  });

  it("increments block height across anchors", async () => {
    const a = await att.anchor("SM3:aaa");
    const b = await att.anchor("SM3:bbb");
    expect(b.block).toBe(a.block + 1);
  });

  it("链上 payload 与回执均携带 attestationLevel=software (D-RWS-4)", async () => {
    const submitted: unknown[] = [];
    const adapter = {
      submitAttestation: async (p: unknown) => {
        submitted.push(p);
        return { transaction_hash: "cm-tx-1", block_number: 7 };
      },
    } as unknown as ChainAdapter;
    const attWithChain = new AttestationService(gm, adapter);
    const r = await attWithChain.anchor("SM3:abc");
    expect(
      (submitted[0] as { metadata?: Record<string, unknown> }).metadata
        ?.attestationLevel,
    ).toBe("software");
    expect((r as { attestationLevel?: string }).attestationLevel).toBe(
      "software",
    );
  });

  it("本地降级回执同样标注 attestationLevel=software (D-RWS-4)", async () => {
    const r = await att.anchor("SM3:def");
    expect((r as { attestationLevel?: string }).attestationLevel).toBe(
      "software",
    );
  });
});

/**
 * 回归：确定性计算算出与历史任务**相同**的结果哈希时，链上合约以
 * `Attestation already exists` 拒收。旧行为把这种拒收当成「链不可达」降级成
 * `0xLOCAL:` 本地回执——可那条哈希明明就在链上。
 *
 * 实测（2026-10-07）：RWS 任务 da75b890 的结果哈希与 2026-09-20 的 f7ea3eb9 相同，
 * 后者已在区块 22 上链（tx 9fe18251…）。
 */
describe("AttestationService — 重复哈希找回既有链上记录", () => {
  const HASH =
    "SM3:70d755b33b60e038e1f4d4827d3990a2ce7880be4fff756cd75973a996be2315";
  const HEX = HASH.slice(4);
  const ORIGINAL_TX =
    "9fe18251bd08d346aad76ca28a7b2004320cc371b15fd25c96e7e9c9ec83794e";
  const gm = new GMCryptoService();

  function makeLedger() {
    return new AttestationLedgerService(
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
    );
  }

  /** 旧版 sidecar 的行为：回滚只给 status=1，不说原因；按哈希能查到存在但不带交易号。 */
  function legacySidecarRejectingDuplicate() {
    return {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1);
      }),
      findAttestation: jest.fn(async (hex: string) =>
        hex === HEX
          ? { data_hash: hex, timestamp: 1758346800, signer: "0xabc" }
          : null,
      ),
    };
  }

  it("returns the existing on-chain tx/block from the ledger instead of a local receipt", async () => {
    const ledger = makeLedger();
    await ledger.record({
      hash: HASH,
      txHash: ORIGINAL_TX,
      block: 22,
      kind: "output",
      subjectType: "rws-task",
      subjectId: "f7ea3eb9-d95b-4581-8759-6bf4fb8b7fdb",
      anchoredAt: "2026-09-20T05:40:00.000Z",
    });
    const adapter = legacySidecarRejectingDuplicate();
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      ledger,
    );

    const r = await att.anchor(HASH, undefined, {
      kind: "output",
      subjectType: "rws-task",
      subjectId: "da75b890-2593-4c1a-851e-4358a0d56349",
    });

    expect(r.txHash).toBe(ORIGINAL_TX);
    expect(r.txHash.startsWith("0xLOCAL:")).toBe(false);
    expect(r.block).toBe(22);
    expect(r.hash).toBe(HASH);
    // 如实标注：本次没有产生新交易，回带的是既有记录
    expect(r.reused).toBe(true);
    expect(r.anchoredAt).toBe("2026-09-20T05:40:00.000Z");
    expect(r.degraded).toBeUndefined();
    expect(adapter.findAttestation).toHaveBeenCalledWith(HEX);
  });

  it("links the new task to the same chain record so its parties can see it in the ledger", async () => {
    const ledger = makeLedger();
    await ledger.record({
      hash: HASH,
      txHash: ORIGINAL_TX,
      block: 22,
      kind: "output",
      subjectType: "rws-task",
      subjectId: "task-old",
    });
    const att = new AttestationService(
      gm,
      legacySidecarRejectingDuplicate() as unknown as ChainAdapter,
      ledger,
    );
    await att.anchor(HASH, undefined, {
      kind: "output",
      subjectType: "rws-task",
      subjectId: "task-new",
    });
    const rows = await ledger.list({ role: "operator" });
    expect(rows.map((x) => [x.subjectId, x.txHash, x.block]).sort()).toEqual([
      ["task-new", ORIGINAL_TX, 22],
      ["task-old", ORIGINAL_TX, 22],
    ]);
  });

  it("re-anchoring an object's own hash is idempotent: same record, not labelled reused", async () => {
    const ledger = makeLedger();
    const subject = {
      kind: "receipt-chain" as const,
      subjectType: "mdop-job" as const,
      subjectId: "job-muxxx70z-e03b9dc1",
    };
    await ledger.record({
      ...subject,
      hash: HASH,
      txHash: ORIGINAL_TX,
      block: 998,
    });
    const att = new AttestationService(
      gm,
      legacySidecarRejectingDuplicate() as unknown as ChainAdapter,
      ledger,
    );
    // 补锚 / 重复上报：同一作业再锚一次同一个链头
    const r = await att.anchor(HASH, undefined, subject);
    expect(r.txHash).toBe(ORIGINAL_TX);
    expect(r.block).toBe(998);
    expect(r.reused).toBeUndefined();
    expect(r.degraded).toBeUndefined();
    expect(await ledger.count()).toBe(1);
  });

  it("does not echo this run's endorsements as on-chain when no new tx was written", async () => {
    const ledger = makeLedger();
    await ledger.record({
      hash: HASH,
      txHash: ORIGINAL_TX,
      block: 22,
      kind: "output",
    });
    const att = new AttestationService(
      gm,
      legacySidecarRejectingDuplicate() as unknown as ChainAdapter,
      ledger,
    );
    const r = await att.anchor(HASH, {
      endorsements: [
        {
          participantId: "p-demohospa",
          resultSm3: "ab",
          sig: "30",
          certFingerprint: "SM2:07",
        },
      ],
    });
    expect(r.reused).toBe(true);
    expect(r.endorsements).toBeUndefined();
  });

  it("prefers the tx/block the sidecar resolved from the chain itself (no local record needed)", async () => {
    const ledger = makeLedger();
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1, {
          reason: "Attestation already exists",
          alreadyExists: true,
          existing: {
            transaction_hash: ORIGINAL_TX,
            block_number: 22,
            timestamp: 1758346800,
          },
        });
      }),
      findAttestation: jest.fn(),
    };
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      ledger,
    );
    const r = await att.anchor(HASH);
    expect(r.txHash).toBe(ORIGINAL_TX);
    expect(r.block).toBe(22);
    expect(r.reused).toBe(true);
    expect(r.anchoredAt).toBe(new Date(1758346800 * 1000).toISOString());
    // sidecar 已经给了结论与记录，不必再查一次
    expect(adapter.findAttestation).not.toHaveBeenCalled();
    // 找回的记录顺手入账本，下次不必再问链
    expect((await ledger.findByHash(HASH))?.txHash).toBe(ORIGINAL_TX);
  });

  it("uses the tx/block from the chain lookup when the ledger has never seen the hash", async () => {
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1);
      }),
      findAttestation: jest.fn(async (hex: string) => ({
        data_hash: hex,
        timestamp: 1758346800,
        signer: "0xabc",
        transaction_hash: ORIGINAL_TX,
        block_number: 22,
      })),
    };
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      makeLedger(),
    );
    const r = await att.anchor(HASH);
    expect(r.txHash).toBe(ORIGINAL_TX);
    expect(r.block).toBe(22);
    expect(r.reused).toBe(true);
  });

  it("degrades — honestly labelled — when the hash is on chain but its tx cannot be resolved", async () => {
    const att = new AttestationService(
      gm,
      legacySidecarRejectingDuplicate() as unknown as ChainAdapter,
      makeLedger(), // 账本里没有这条哈希，旧 sidecar 也给不出交易号
    );
    const r = await att.anchor(HASH);
    // 绝不编造交易号；也不冒充成功
    expect(r.txHash.startsWith("0xLOCAL:")).toBe(true);
    expect(r.degraded).toBe("duplicate-unresolved");
    expect(r.reused).toBeUndefined();
  });

  it("keeps today's degrade for a revert that is not a duplicate", async () => {
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1, { reason: "Contract is paused" });
      }),
      findAttestation: jest.fn(async () => null), // 链上没有这条哈希
    };
    const ledger = makeLedger();
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      ledger,
    );
    const r = await att.anchor(HASH);
    expect(r.txHash.startsWith("0xLOCAL:")).toBe(true);
    expect(r.degraded).toBe("chain-rejected");
    expect(await ledger.findByHash(HASH)).toBeNull();
  });

  it("keeps today's degrade when the chain is unreachable, without asking it again", async () => {
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new Error("fetch failed");
      }),
      findAttestation: jest.fn(),
    };
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      makeLedger(),
    );
    const r = await att.anchor(HASH);
    expect(r.txHash.startsWith("0xLOCAL:")).toBe(true);
    expect(r.degraded).toBe("chain-unavailable");
    expect(adapter.findAttestation).not.toHaveBeenCalled();
  });

  // 线上现状（2026-10-07 实测）：已部署的 sidecar 没有按哈希查询，
  // GET /attestation/<hash> 落到 /attest 的处理器上返回 405「POST only」。
  it("falls back to the ledger when the deployed sidecar has no hash lookup", async () => {
    const ledger = makeLedger();
    await ledger.record({
      hash: HASH,
      txHash: ORIGINAL_TX,
      block: 22,
      kind: "output",
      anchoredAt: "2026-09-20T05:40:00.000Z",
    });
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1);
      }),
      findAttestation: jest.fn(async () => {
        throw new Error("findAttestation failed (HTTP 405): POST only");
      }),
    };
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      ledger,
    );
    const r = await att.anchor(HASH);
    expect(r.txHash).toBe(ORIGINAL_TX);
    expect(r.block).toBe(22);
    expect(r.reused).toBe(true);
    expect(r.degraded).toBeUndefined();
  });

  it("degrades when the sidecar has no hash lookup and the ledger does not know the hash", async () => {
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1);
      }),
      findAttestation: jest.fn(async () => {
        throw new Error("findAttestation failed (HTTP 405): POST only");
      }),
    };
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      makeLedger(),
    );
    const r = await att.anchor(HASH);
    expect(r.txHash.startsWith("0xLOCAL:")).toBe(true);
    // 无从判定是不是重复：只能如实说「链拒收」
    expect(r.degraded).toBe("chain-rejected");
  });

  it("the chain overrides a stale ledger: not on chain means not reused", async () => {
    const ledger = makeLedger();
    await ledger.record({
      hash: HASH,
      txHash: ORIGINAL_TX,
      block: 22,
      kind: "output",
    });
    const adapter = {
      submitAttestation: jest.fn(async () => {
        throw new ChainTxRevertedError(1, { reason: "Contract is paused" });
      }),
      findAttestation: jest.fn(async () => null), // 链说：没有这条哈希
    };
    const att = new AttestationService(
      gm,
      adapter as unknown as ChainAdapter,
      ledger,
    );
    const r = await att.anchor(HASH);
    expect(r.txHash.startsWith("0xLOCAL:")).toBe(true);
    expect(r.degraded).toBe("chain-rejected");
    expect(r.reused).toBeUndefined();
  });
});

describe("AttestationService — 上链成功写存证指针", () => {
  const gm = new GMCryptoService();

  it("records every real on-chain anchor in the ledger with its subject", async () => {
    const ledger = new AttestationLedgerService(
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
    );
    const adapter = {
      submitAttestation: async () => ({
        transaction_hash: "cm-tx-9",
        block_number: 999,
      }),
    } as unknown as ChainAdapter;
    const att = new AttestationService(gm, adapter, ledger);
    const r = await att.anchor("sm3:" + "c".repeat(64), undefined, {
      kind: "receipt-chain",
      subjectType: "mdop-job",
      subjectId: "job-muxxx70z-e03b9dc1",
    });
    expect(r.reused).toBeUndefined();
    expect(r.degraded).toBeUndefined();
    const [row] = await ledger.list({ role: "operator" });
    expect(row).toMatchObject({
      kind: "receipt-chain",
      hash: "SM3:" + "c".repeat(64),
      txHash: "cm-tx-9",
      block: 999,
      subjectType: "mdop-job",
      subjectId: "job-muxxx70z-e03b9dc1",
    });
  });

  it("local (degraded) receipts never reach the ledger", async () => {
    const ledger = new AttestationLedgerService(
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
      fakeRepo(),
    );
    const att = new AttestationService(gm, undefined, ledger);
    const r = await att.anchor("SM3:" + "d".repeat(64));
    expect(r.degraded).toBe("no-chain-adapter");
    expect(await ledger.list({ role: "operator" })).toEqual([]);
  });

  it("a ledger write failure never fails the anchor itself", async () => {
    const ledger = {
      record: jest.fn(async () => {
        throw new Error("db locked");
      }),
      findByHash: jest.fn(),
    } as unknown as AttestationLedgerService;
    const adapter = {
      submitAttestation: async () => ({
        transaction_hash: "cm-tx-1",
        block_number: 7,
      }),
    } as unknown as ChainAdapter;
    const att = new AttestationService(gm, adapter, ledger);
    await expect(att.anchor("SM3:abc")).resolves.toMatchObject({
      txHash: "cm-tx-1",
      block: 7,
    });
  });
});
