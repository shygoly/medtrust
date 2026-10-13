import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ContractService } from "./contract.service";
import { mockRepo } from "../test-utils/mock-repo";
import { CatalogService } from "../catalog/catalog.service";
import { ComplianceService } from "../../capability/l2-compliance/compliance.service";
import { SpaceContextService } from "../space-context/space-context.service";

const apply = {
  dataProductId: "dp-1",
  compositionId: "comp-1",
  purpose: "药物警戒",
  retention: "阅后即焚",
  output: "仅聚合",
  validDays: 90,
};

// 预审服务 mock（D-CMP-2）：默认 comp-1 属于 p-pharma-demo、裁决 auto_approve。
function mockCompliance() {
  const evaluation = {
    id: "eval-1",
    autoVerdict: "auto_approve" as string,
    overallRisk: "medium",
    required: {},
    blockingRulesMatched: [] as string[],
    warnings: [],
    structuralIssues: [],
    dimensions: {},
    dimensionSources: {},
    dimensionConflicts: [],
    rulesDigest: "SM3:x",
  };
  return {
    getComposition: jest.fn(async (id: string) => ({
      id,
      ownerParticipantId: "p-pharma-demo",
    })),
    evaluate: jest.fn(async () => evaluation),
    toSnapshot: jest.fn((e: { id: string; autoVerdict: string }) => ({
      compositionId: "comp-1",
      evaluationId: e.id,
      verdict: e.autoVerdict,
      overallRisk: "medium",
      required: {},
      dimensions: {},
      dimensionSources: {},
      dimensionConflicts: [],
      rulesDigest: "SM3:x",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    })),
    upsertSeedComposition: jest.fn(async (id: string) => ({ id })),
  };
}

function mockCatalog(): Pick<CatalogService, "get"> {
  return {
    get: async (id: string) => ({
      id,
      urn: "urn:test",
      homeSpace: "sh-med",
      providerId: "p-demohospa",
      title: "test",
      productType: "data" as const,
      status: "active" as const,
      rightsConfirmed: true,
      recordCount: 1,
      fhirSchema: null,
    }),
  };
}

describe("ContractService — 数字合约生成与状态 (4.1/4.2)", () => {
  let svc: ContractService;
  let compliance: ReturnType<typeof mockCompliance>;
  beforeEach(() => {
    compliance = mockCompliance();
    svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      compliance as unknown as ComplianceService,
    );
  });

  it("rejects a direct contract when the product is not rights-confirmed", async () => {
    const local = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      {
        get: async () => ({
          id: "dp-1",
          homeSpace: "sh-med",
          providerId: "p-demohospa",
          rightsConfirmed: false,
          title: "x",
        }),
      } as unknown as CatalogService,
    );
    await expect(
      local.approve({
        ...apply,
        providerId: "p-demohospa",
        consumerId: "p-pharma-demo",
      }),
    ).rejects.toThrow(/未确权/);
  });

  it("lists contracts only in the current space", async () => {
    const repo = mockRepo();
    const spaces = new SpaceContextService();
    const local = new ContractService(
      new GMCryptoService(),
      repo,
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      undefined,
      undefined,
      spaces,
    );
    await local.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    const hidden = await spaces.run({ spaceId: "hn-power" }, () => local.list());
    expect(hidden).toEqual([]);
    const visible = await spaces.run({ spaceId: "sh-med" }, () => local.list());
    expect(visible).toHaveLength(1);
  });

  it("approves an active contract with an SM3 hash and future validity", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    expect(c.status).toBe("active");
    expect(c.hash).toMatch(/^SM3:/);
    expect(new Date(c.validUntil).getTime()).toBeGreaterThan(Date.now());
    expect(svc.effectiveStatus(c)).toBe("active");
  });

  it("reports expired once past validUntil", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
      validDays: -1,
    });
    expect(svc.effectiveStatus(c)).toBe("expired");
  });

  it("reports revoked after revoke()", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    await svc.revoke(c.id, "p-demohospa", "demo-revoke");
    const updated = await svc.get(c.id);
    expect(svc.effectiveStatus(updated!)).toBe("revoked");
    expect(updated?.revokeReason).toBe("demo-revoke");
  });

  it("rejects revoke from a different provider (P1-3)", async () => {
    const c = await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    await expect(svc.revoke(c.id, "p-demohospb", "x")).rejects.toThrow(
      /仅数据提供方/,
    );
  });

  it("acknowledge → approveDraft keeps integrity acknowledgedValid (P1-7)", async () => {
    const draft = await svc.request(apply, "p-pharma-demo");
    await svc.acknowledge(draft.id, "p-pharma-demo");
    const active = await svc.approveDraft(draft.id, "p-demohospa");
    const integrity = await svc.verifyIntegrity(active.id);
    expect(integrity.hashMatch).toBe(true);
    expect(integrity.acknowledgedValid).toBe(true);
  });

  it("consumer request creates a draft; acknowledge then provider approves to active", async () => {
    const draft = await svc.request(apply, "p-pharma-demo");
    expect(draft.providerId).toBe("p-demohospa");
    expect(draft.status).toBe("draft");
    expect(svc.effectiveStatus(draft)).toBe("draft");

    // P0-7: 消费方先确认规则知悉,提供方方可签发
    await svc.acknowledge(draft.id, "p-pharma-demo");

    const active = await svc.approveDraft(draft.id, "p-demohospa");
    expect(active.status).toBe("active");
    expect(active.hash).toMatch(/^SM3:/);
  });

  it("rejects a contract request for an unconfirmed product", async () => {
    const unconfirmed = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      {
        get: async () => ({
          id: "dp-1",
          urn: "urn:test",
          homeSpace: "sh-med",
          providerId: "p-demohospa",
          title: "test",
          productType: "data",
          rightsConfirmed: false,
          recordCount: 0,
          fhirSchema: null,
          status: "active",
        }),
      } as unknown as CatalogService,
      undefined,
      undefined,
      compliance as unknown as ComplianceService,
    );
    await expect(unconfirmed.request(apply, "p-pharma-demo")).rejects.toThrow(
      /未确权/,
    );
  });

  it("rejects approving a draft the consumer has not acknowledged (P0-7)", async () => {
    const draft = await svc.request(apply, "p-pharma-demo");
    await expect(svc.approveDraft(draft.id, "p-demohospa")).rejects.toThrow(
      /尚未确认规则知悉/,
    );
  });

  it("acknowledge records timestamp + hash + identity (P0-7)", async () => {
    const draft = await svc.request(apply, "p-pharma-demo");
    const acked = await svc.acknowledge(draft.id, "p-pharma-demo");
    expect(acked.consumerAcknowledgedAt).toBeTruthy();
    expect(acked.acknowledgedHash).toMatch(/^SM3:/);
    const reloaded = await svc.get(draft.id);
    expect(reloaded?.acknowledgedHash).toBe(acked.acknowledgedHash);
    expect(reloaded?.consumerAcknowledgedAt).toBe(acked.consumerAcknowledgedAt);
  });

  it("provider rejects a draft", async () => {
    const draft = await svc.request(apply, "p-pharma-demo");
    const rejected = await svc.rejectDraft(draft.id, "p-demohospa");
    expect(rejected.status).toBe("revoked");
  });

  it("list sets canApprove for matching provider on draft", async () => {
    const draft = await svc.request(apply, "p-pharma-demo");
    const forDemohospb = await svc.list({
      role: "provider",
      participantId: "p-demohospb",
    });
    expect(forDemohospb.find((c) => c.id === draft.id)?.canApprove).toBe(false);

    const forDemohospa = await svc.list({
      role: "provider",
      participantId: "p-demohospa",
    });
    expect(forDemohospa.find((c) => c.id === draft.id)?.canApprove).toBe(true);

    const forDemohospaOrg = await svc.list({
      role: "provider",
      participantId: "示范甲医院",
    });
    expect(forDemohospaOrg.find((c) => c.id === draft.id)?.canApprove).toBe(
      true,
    );
  });

  it("seeds active CKD contracts for both demo providers to p-meddata", async () => {
    await svc.onModuleInit();

    const contracts = await svc.list();
    expect(contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "p-demohospa",
          consumerId: "p-meddata",
          purpose: "胰岛素暴露·胰腺炎信号演示研究",
          effectiveStatus: "active",
        }),
        expect.objectContaining({
          providerId: "p-demohospb",
          consumerId: "p-meddata",
          purpose: "胰岛素暴露·胰腺炎信号演示研究",
          effectiveStatus: "active",
        }),
      ]),
    );
  });

  /**
   * 回归（mdop-kernel §11.5）：种子的「遗留中文 ID 清理」曾用「id 含中文」当判据，
   * 而规范种子 id 里嵌的就是中文用途 → 每次启动都删掉重建，医院签名被静默抹掉。
   */
  it("已持签的种子合约不被重播种覆盖（重启不丢 MDOP 签名）", async () => {
    const repo = mockRepo();
    const local = new ContractService(
      new GMCryptoService(),
      repo,
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      compliance as unknown as ComplianceService,
    );
    await local.onModuleInit();
    const seed = (await local.list()).find(
      (c) => c.providerId === "p-demohospa" && c.consumerId === "p-meddata",
    )!;
    expect(seed.id).toContain("seed:");
    await repo.update(
      { id: seed.id },
      {
        mdopTerms: { purpose: seed.purpose },
        holderSignature: "sig-1",
        mdopStatus: "active",
      },
    );

    await local.onModuleInit(); // 模拟一次重启

    const after = await repo.findOne({ where: { id: seed.id } });
    expect(after?.holderSignature).toBe("sig-1");
    expect(after?.mdopTerms).toEqual({ purpose: seed.purpose });
    expect(after?.mdopStatus).toBe("active");
  });

  describe("计价条款 (value-settlement 10.1)", () => {
    const priced = {
      ...apply,
      providerId: "p-demohospa",
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
        providerId: "p-demohospa",
        consumerId: "p-meddata",
      });
      expect(c.pricing).toBeUndefined();
    });
  });

  describe("合规预审绑定 (D-CMP-2, 4.6)", () => {
    it("未附预审 → 拒绝生成草稿", async () => {
      await expect(
        svc.request({ ...apply, compositionId: "" } as never, "p-pharma-demo"),
      ).rejects.toThrow(/必须引用一份合规预审/);
    });

    it("引用他人的预审 → 拒绝", async () => {
      compliance.getComposition.mockResolvedValueOnce({
        id: "comp-1",
        ownerParticipantId: "p-other",
      } as never);
      await expect(svc.request(apply, "p-pharma-demo")).rejects.toThrow(
        /只能引用属于本方/,
      );
    });

    it("重新裁决为驳回 → 拒绝并返回命中的阻断规则", async () => {
      compliance.evaluate.mockResolvedValueOnce({
        id: "eval-b",
        autoVerdict: "block",
        blockingRulesMatched: ["block-security-below-required"],
      } as never);
      await expect(svc.request(apply, "p-pharma-demo")).rejects.toThrow(
        /驳回.*block-security-below-required/,
      );
    });

    it("裁决通过 → 草稿带预审快照", async () => {
      const draft = await svc.request(apply, "p-pharma-demo");
      expect(draft.preReview?.verdict).toBe("auto_approve");
      expect(draft.preReview?.rulesDigest).toMatch(/^SM3:/);
    });

    it("需审批未确认 → 拒绝签发", async () => {
      compliance.evaluate.mockResolvedValue({
        id: "eval-m",
        autoVerdict: "manual_review",
        blockingRulesMatched: [],
      } as never);
      const draft = await svc.request(apply, "p-pharma-demo");
      await svc.acknowledge(draft.id, "p-pharma-demo");
      await expect(svc.approveDraft(draft.id, "p-demohospa")).rejects.toThrow(
        /需审批/,
      );
    });

    it("需审批已确认 → 签发，确认记录写入合约", async () => {
      compliance.evaluate.mockResolvedValue({
        id: "eval-m",
        autoVerdict: "manual_review",
        blockingRulesMatched: [],
      } as never);
      const draft = await svc.request(apply, "p-pharma-demo");
      await svc.acknowledge(draft.id, "p-pharma-demo");
      const active = await svc.approveDraft(
        draft.id,
        "p-demohospa",
        undefined,
        {
          reason: "已核验队列口径",
        },
      );
      expect(active.status).toBe("active");
      expect(active.preReviewAck?.reason).toBe("已核验队列口径");
      expect(active.preReviewAck?.by).toBe("p-demohospa");
    });

    it("auto_approve 不接受确认入参", async () => {
      const draft = await svc.request(apply, "p-pharma-demo");
      await svc.acknowledge(draft.id, "p-pharma-demo");
      await expect(
        svc.approveDraft(draft.id, "p-demohospa", undefined, { reason: "x" }),
      ).rejects.toThrow(/不接受确认入参/);
    });

    it("预审快照计入合约哈希（改快照即改哈希）", async () => {
      const base = {
        ...apply,
        providerId: "p-demohospa",
        consumerId: "p-meddata",
      };
      const snapA = {
        compositionId: "c",
        evaluationId: "e",
        verdict: "auto_approve" as const,
        overallRisk: "medium" as const,
        required: {},
        dimensions: {},
        dimensionSources: {},
        dimensionConflicts: [],
        rulesDigest: "SM3:a",
        evaluatedAt: "t",
      };
      const a = await svc.approve(base, "ca", snapA);
      const b = await svc.approve(base, "cb", {
        ...snapA,
        rulesDigest: "SM3:b",
      });
      expect(a.hash).not.toBe(b.hash);
    });

    it("种子合约带预审快照", async () => {
      await svc.onModuleInit();
      const contracts = await svc.list();
      const seed = contracts.find(
        (c) => c.consumerId === "p-meddata" && c.preReview,
      );
      expect(seed?.preReview?.verdict).toBe("auto_approve");
    });
  });
});
