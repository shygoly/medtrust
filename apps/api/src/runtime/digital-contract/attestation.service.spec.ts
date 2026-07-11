import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ContractService } from "./contract.service";
import { CatalogService } from "../catalog/catalog.service";
import { AttestationService } from "./attestation.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("AttestationService — 策略哈希上链 (4.3)", () => {
  let gm: GMCryptoService;
  let contracts: ContractService;
  let att: AttestationService;
  beforeEach(() => {
    gm = new GMCryptoService();
    const catalog = { get: () => null } as unknown as CatalogService;
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
    expect(json).not.toContain("p-huashan");
  });

  it("increments block height across anchors", async () => {
    const a = await att.anchor("SM3:aaa");
    const b = await att.anchor("SM3:bbb");
    expect(b.block).toBe(a.block + 1);
  });
});
