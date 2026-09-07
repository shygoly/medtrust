import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ContractService } from "./contract.service";
import { mockRepo } from "../test-utils/mock-repo";
import { CatalogService } from "../catalog/catalog.service";

const apply = {
  dataProductId: "dp-1",
  purpose: "药物警戒",
  retention: "阅后即焚",
  output: "仅聚合",
  validDays: 90,
};

function mockCatalog(): Pick<CatalogService, "get"> {
  return {
    get: async (id: string) =>
      id === "dp-1"
        ? {
            id: "dp-1",
            urn: "urn:test",
            homeSpace: "sh-med",
            providerId: "p-huashan",
            title: "test",
            productType: "data",
            rightsConfirmed: true,
            recordCount: 1,
            fhirSchema: null,
          }
        : null,
  };
}

describe("ContractService — 数字合约生成与状态 (4.1/4.2)", () => {
  let svc: ContractService;
  beforeEach(() => {
    svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      mockCatalog() as CatalogService,
    );
  });

  it("approves an active contract with an SM3 hash and future validity", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-huashan",
      consumerId: "p-hengrui",
    });
    expect(c.status).toBe("active");
    expect(c.hash).toMatch(/^SM3:/);
    expect(new Date(c.validUntil).getTime()).toBeGreaterThan(Date.now());
    expect(svc.effectiveStatus(c)).toBe("active");
  });

  it("reports expired once past validUntil", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-huashan",
      consumerId: "p-hengrui",
      validDays: -1,
    });
    expect(svc.effectiveStatus(c)).toBe("expired");
  });

  it("reports revoked after revoke()", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-huashan",
      consumerId: "p-hengrui",
    });
    await svc.revoke(c.id, "p-huashan", "demo-revoke");
    const updated = await svc.get(c.id);
    expect(svc.effectiveStatus(updated!)).toBe("revoked");
    expect(updated?.revokeReason).toBe("demo-revoke");
  });

  it("rejects revoke from a different provider (P1-3)", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-huashan",
      consumerId: "p-hengrui",
    });
    await expect(svc.revoke(c.id, "p-ruijin", "x")).rejects.toThrow(
      /仅数据提供方/,
    );
  });

  it("acknowledge → approveDraft keeps integrity acknowledgedValid (P1-7)", async () => {
    const draft = await svc.request(apply, "p-hengrui");
    await svc.acknowledge(draft.id, "p-hengrui");
    const active = await svc.approveDraft(draft.id, "p-huashan");
    const integrity = await svc.verifyIntegrity(active.id);
    expect(integrity.hashMatch).toBe(true);
    expect(integrity.acknowledgedValid).toBe(true);
  });

  it("consumer request creates a draft; acknowledge then provider approves to active", async () => {
    const draft = await svc.request(apply, "p-hengrui");
    expect(draft.providerId).toBe("p-huashan");
    expect(draft.status).toBe("draft");
    expect(svc.effectiveStatus(draft)).toBe("draft");

    // P0-7: 消费方先确认规则知悉,提供方方可签发
    await svc.acknowledge(draft.id, "p-hengrui");

    const active = await svc.approveDraft(draft.id, "p-huashan");
    expect(active.status).toBe("active");
    expect(active.hash).toMatch(/^SM3:/);
  });

  it("rejects approving a draft the consumer has not acknowledged (P0-7)", async () => {
    const draft = await svc.request(apply, "p-hengrui");
    await expect(svc.approveDraft(draft.id, "p-huashan")).rejects.toThrow(
      /尚未确认规则知悉/,
    );
  });

  it("acknowledge records timestamp + hash + identity (P0-7)", async () => {
    const draft = await svc.request(apply, "p-hengrui");
    const acked = await svc.acknowledge(draft.id, "p-hengrui");
    expect(acked.consumerAcknowledgedAt).toBeTruthy();
    expect(acked.acknowledgedHash).toMatch(/^SM3:/);
    const reloaded = await svc.get(draft.id);
    expect(reloaded?.acknowledgedHash).toBe(acked.acknowledgedHash);
    expect(reloaded?.consumerAcknowledgedAt).toBe(acked.consumerAcknowledgedAt);
  });

  it("provider rejects a draft", async () => {
    const draft = await svc.request(apply, "p-hengrui");
    const rejected = await svc.rejectDraft(draft.id, "p-huashan");
    expect(rejected.status).toBe("revoked");
  });

  it("list sets canApprove for matching provider on draft", async () => {
    const draft = await svc.request(apply, "p-hengrui");
    const forRuijin = await svc.list({
      role: "provider",
      participantId: "p-ruijin",
    });
    expect(forRuijin.find((c) => c.id === draft.id)?.canApprove).toBe(false);

    const forHuashan = await svc.list({
      role: "provider",
      participantId: "p-huashan",
    });
    expect(forHuashan.find((c) => c.id === draft.id)?.canApprove).toBe(true);

    const forHuashanOrg = await svc.list({
      role: "provider",
      participantId: "华山医院",
    });
    expect(forHuashanOrg.find((c) => c.id === draft.id)?.canApprove).toBe(true);
  });

  it("seeds active CKD contracts for both demo providers to p-meddata", async () => {
    await svc.onModuleInit();

    const contracts = await svc.list();
    expect(contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "p-huashan",
          consumerId: "p-meddata",
          purpose: "胰岛素暴露·胰腺炎信号演示研究",
          effectiveStatus: "active",
        }),
        expect.objectContaining({
          providerId: "p-ruijin",
          consumerId: "p-meddata",
          purpose: "胰岛素暴露·胰腺炎信号演示研究",
          effectiveStatus: "active",
        }),
      ]),
    );
  });

  describe("计价条款 (value-settlement 10.1)", () => {
    const priced = {
      ...apply,
      providerId: "p-huashan",
      consumerId: "p-meddata",
      pricing: { model: "per-record" as const, amount: 2, currency: "CNY" },
    };

    it("合约携带计价条款", async () => {
      const c = await svc.approve(priced);
      expect(c.pricing).toEqual({
        model: "per-record",
        amount: 2,
        currency: "CNY",
      });
    });

    it("计价进入 SM3 哈希——改金额则哈希变（随合约哈希上链）", async () => {
      const a = await svc.approve(priced, "c-a");
      const b = await svc.approve(
        { ...priced, pricing: { ...priced.pricing, amount: 3 } },
        "c-b",
      );
      expect(a.hash).not.toBe(b.hash);
    });

    it("无计价条款的合约不带 pricing（无计价则不结算）", async () => {
      const c = await svc.approve({
        ...apply,
        providerId: "p-huashan",
        consumerId: "p-meddata",
      });
      expect(c.pricing).toBeUndefined();
    });
  });
});
