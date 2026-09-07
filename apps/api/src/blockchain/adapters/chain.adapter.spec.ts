import { ChainAdapter } from "./chain.adapter";

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
});
