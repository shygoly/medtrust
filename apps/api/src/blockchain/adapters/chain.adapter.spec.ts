import { ChainAdapter, ChainTxRevertedError } from "./chain.adapter";

describe("ChainAdapter — 链上查验去 mock(P0-3)", () => {
  const sidecar = "http://localhost:8090";
  let adapter: ChainAdapter;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "x",
    json: async () => body,
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const config = { get: jest.fn().mockReturnValue(sidecar) };
    adapter = new ChainAdapter(config as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns valid:true with real chain fields for an attested hash", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        exists: true,
        timestamp: 1700000000,
        attester: "0xabc",
        dataHash: "abc",
      }),
    );
    const r = await adapter.verifyAttestation("abc");
    expect(r.valid).toBe(true);
    expect(r.attestation).toEqual({
      data_hash: "abc",
      timestamp: 1700000000,
      signer: "0xabc",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${sidecar}/attestation/abc`,
      expect.anything(),
    );
  });

  it("returns valid:false for a non-attested hash", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { exists: false }));
    const r = await adapter.verifyAttestation("nope");
    expect(r.valid).toBe(false);
    expect(r.attestation).toBeNull();
  });

  it("fails closed (valid:false) when the sidecar errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const r = await adapter.verifyAttestation("abc");
    expect(r.valid).toBe(false);
    expect(r.attestation).toBeNull();
  });

  it("queries attestation history and filters by signer", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        attestations: [
          { dataHash: "a", attester: "0x1", timestamp: 1, blockNumber: 10 },
          { dataHash: "b", attester: "0x2", timestamp: 2, blockNumber: 20 },
        ],
      }),
    );
    const list = await adapter.queryAttestationHistory({ signer: "0x1" });
    expect(list).toHaveLength(1);
    expect(list[0].dataHash).toBe("a");
  });

  it("throws when attestation history query fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "down" }));
    await expect(adapter.queryAttestationHistory({})).rejects.toThrow(
      /queryAttestationHistory failed/,
    );
  });

  // 重复哈希回归：合约拒收(回滚)必须与「链不可达」可区分，调用方才能去找回既有记录。
  describe("submitAttestation — 链上回滚是类型化错误", () => {
    it("throws ChainTxRevertedError when the on-chain tx reverts", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          txHash: "reverted-tx",
          blockNumber: "40",
          status: 1,
        }),
      );
      const err = await adapter
        .submitAttestation({ data_id: "SM3:aa", data_hash: "aa" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ChainTxRevertedError);
      expect(err.message).toMatch(/On-chain tx reverted, status=1/);
      // 旧 sidecar 不回带原因：是否重复由调用方另行查链判定
      expect(err.alreadyExists).toBeUndefined();
    });

    it("carries the sidecar's duplicate verdict and the existing record", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          txHash: "reverted-tx",
          blockNumber: "40",
          status: 1,
          message: "Attestation already exists",
          alreadyExists: true,
          existing: {
            txHash: "orig-tx",
            blockNumber: "22",
            timestamp: 1758350000,
          },
        }),
      );
      const err = await adapter
        .submitAttestation({ data_id: "SM3:aa", data_hash: "aa" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ChainTxRevertedError);
      expect(err.alreadyExists).toBe(true);
      expect(err.existing).toEqual({
        transaction_hash: "orig-tx",
        block_number: 22,
        timestamp: 1758350000,
      });
    });

    it("does not classify transport failures as a revert", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(503, { error: "chain not ready" }),
      );
      const err = await adapter
        .submitAttestation({ data_id: "SM3:aa", data_hash: "aa" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ChainTxRevertedError);
    });
  });

  describe("findAttestation — 按哈希查链上记录", () => {
    it("returns the tx hash and block when the sidecar resolves them", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          exists: true,
          timestamp: 1758350000,
          attester: "0xabc",
          dataHash: "aa",
          txHash: "orig-tx",
          blockNumber: 22,
        }),
      );
      await expect(adapter.findAttestation("aa")).resolves.toEqual({
        data_hash: "aa",
        timestamp: 1758350000,
        signer: "0xabc",
        transaction_hash: "orig-tx",
        block_number: 22,
      });
    });

    it("returns the record without tx fields for a sidecar that cannot resolve them", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { exists: true, timestamp: 5, attester: "0x1" }),
      );
      const found = await adapter.findAttestation("aa");
      expect(found).toEqual({ data_hash: "aa", timestamp: 5, signer: "0x1" });
    });

    it("returns null when the hash is not on chain", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { exists: false }));
      await expect(adapter.findAttestation("aa")).resolves.toBeNull();
    });

    it("throws (does not guess) when the chain cannot be asked", async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));
      await expect(adapter.findAttestation("aa")).rejects.toThrow(/boom/);
    });
  });
});
