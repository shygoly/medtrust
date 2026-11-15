import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ContractService } from "./contract.service";
import { mockRepo } from "../test-utils/mock-repo";
import { CatalogService } from "../catalog/catalog.service";
import { ComplianceService } from "../../capability/l2-compliance/compliance.service";
import { SpaceContextService } from "../space-context/space-context.service";
import { ParticipantDisplayService } from "../participant-directory/participant-display.service";

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
    const local = new ContractService(new GMCryptoService(), mockRepo(), {
      get: async () => ({
        id: "dp-1",
        homeSpace: "sh-med",
        providerId: "p-demohospa",
        rightsConfirmed: false,
        title: "x",
      }),
    } as unknown as CatalogService);
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
    const hidden = await spaces.run({ spaceId: "hn-power" }, () =>
      local.list(),
    );
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

  it("approveDraft 发出签署要约；要约失败不回滚已生效合约", async () => {
    const offer = jest
      .fn()
      .mockResolvedValueOnce({
        contractId: "x",
        canonical: "c",
        offerId: "offer-1",
      })
      .mockRejectedValueOnce(
        new Error("提供方连接器尚未注册证书，无法发出合约要约"),
      );
    const local = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      compliance as unknown as ComplianceService,
      { offer } as never,
    );
    const draft = await local.request(apply, "p-pharma-demo");
    await local.acknowledge(draft.id, "p-pharma-demo");
    const active = await local.approveDraft(draft.id, "p-demohospa");
    expect(active.status).toBe("active");
    expect(active.mdopOffer).toEqual({ offered: true, offerId: "offer-1" });
    expect(offer).toHaveBeenCalledWith(draft.id, {});
    expect(
      (await local.list()).find((c) => c.id === draft.id)?.holderSigned,
    ).toBe(false);

    const draft2 = await local.request(
      { ...apply, purpose: "另一项研究" },
      "p-pharma-demo",
    );
    await local.acknowledge(draft2.id, "p-pharma-demo");
    const stillActive = await local.approveDraft(draft2.id, "p-demohospa");
    expect(stillActive.status).toBe("active");
    expect(stillActive.mdopOffer.offered).toBe(false);
    expect(stillActive.mdopOffer.reason).toContain("尚未注册证书");
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
    expect(forDemohospb.find((c) => c.id === draft.id)).toBeUndefined();

    const forDemohospa = await svc.list({
      role: "provider",
      participantId: "p-demohospa",
    });
    expect(forDemohospa.find((c) => c.id === draft.id)?.canApprove).toBe(true);
    expect(forDemohospa.find((c) => c.id === draft.id)?.canAcknowledge).toBe(
      false,
    );
    expect(forDemohospa.find((c) => c.id === draft.id)?.holderSigned).toBe(
      false,
    );

    const forDemohospaOrg = await svc.list({
      role: "provider",
      participantId: "示范甲医院",
    });
    expect(forDemohospaOrg.find((c) => c.id === draft.id)?.canApprove).toBe(
      true,
    );

    const forConsumer = await svc.list({
      role: "consumer",
      participantId: "p-pharma-demo",
    });
    expect(forConsumer.find((c) => c.id === draft.id)?.canApprove).toBe(false);
    expect(forConsumer.find((c) => c.id === draft.id)?.canAcknowledge).toBe(
      true,
    );

    const forOtherConsumer = await svc.list({
      role: "consumer",
      participantId: "p-other-pharma",
    });
    expect(forOtherConsumer.find((c) => c.id === draft.id)).toBeUndefined();
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

describe("ContractService — 审核留痕与显示名 (contract-review)", () => {
  const requireActor = { userId: 7, email: "li@demo-hospital.example" };
  const usersRepo = {
    findOne: async ({ where }: any) =>
      where.id === 7 ? { id: 7, name: "李主任" } : null,
  };
  const participantsRepo = {
    find: async ({ where }: any) =>
      where.participantId._value.map((slug: string) => ({
        participantId: slug,
        org:
          slug === "p-demohospa"
            ? "示范甲医院"
            : slug === "p-pharma-demo"
              ? "创新药企（演示）"
              : slug,
      })),
  };

  function build() {
    return new ContractService(
      new GMCryptoService(),
      mockRepo(),
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      mockCompliance() as unknown as ComplianceService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new ParticipantDisplayService(participantsRepo as any),
      usersRepo as any,
    );
  }

  it("申请落申请人快照（姓名/邮箱冻结在当时）", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma-demo", requireActor);
    expect(draft.requestedBy?.userId).toBe(7);
    expect(draft.requestedBy?.name).toBe("李主任");
    expect(draft.requestedBy?.email).toBe("li@demo-hospital.example");
    expect(draft.requestedBy?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("签发落审批决定；补记留痕不改变合约哈希", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma-demo", requireActor);
    await svc.acknowledge(draft.id, "p-pharma-demo");
    const active = await svc.approveDraft(
      draft.id,
      "p-demohospa",
      undefined,
      undefined,
      requireActor,
    );
    expect(active.decision?.outcome).toBe("approved");
    expect(active.decision?.by.participantId).toBe("p-demohospa");
    expect(active.decision?.by.name).toBe("李主任");
    expect(active.requestedBy?.name).toBe("李主任");

    // 关键：decision/requestedBy 不进 canonical —— 已存证合约不得因补记失效。
    const integrity = await svc.verifyIntegrity(active.id);
    expect(integrity.hashMatch).toBe(true);
  });

  it("驳回落审批决定（outcome=rejected）", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma-demo", requireActor);
    const rejected = await svc.rejectDraft(
      draft.id,
      "p-demohospa",
      requireActor,
    );
    expect(rejected.decision?.outcome).toBe("rejected");
    expect((await svc.get(draft.id))?.decision?.outcome).toBe("rejected");
  });

  it("解除落解除人/时间/原因", async () => {
    const svc = build();
    const active = await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    await svc.revoke(active.id, "p-demohospa", "模拟解除", requireActor);
    const row = await svc.get(active.id);
    expect(row?.revocation?.reason).toBe("模拟解除");
    expect(row?.revocation?.by.name).toBe("李主任");
    expect(row?.revocation?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("列表补机构名与数据集标题（查不到则由界面回退 slug）", async () => {
    const svc = build();
    await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    const [row] = await svc.list();
    expect(row.consumerDisplayName).toBe("创新药企（演示）");
    expect(row.providerDisplayName).toBe("示范甲医院");
    expect(row.dataProductTitle).toBe("test");
  });

  it("没有机构仓储时列表仍可用（显示名回退）", async () => {
    const svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      mockCompliance() as unknown as ComplianceService,
    );
    await svc.approve({
      ...apply,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    });
    const [row] = await svc.list();
    expect(row.consumerDisplayName).toBeNull();
    expect(row.dataProductTitle).toBe("test");
  });

  it("列表稳定排序：最近创建优先、id 并列；角色过滤保序（子序列）", async () => {
    const repo = mockRepo();
    const now = Date.now();
    const base = {
      dataProductId: "dp-1",
      purpose: "排序用例",
      retention: "阅后即焚",
      output: "聚合",
      validUntil: "2030-01-01T00:00:00.000Z",
      status: "active" as const,
      providerId: "p-demohospa",
      consumerId: "p-pharma-demo",
    };
    // 同一时刻创建的两份用 id 破并列；再放一份更早的、一份别人的。
    await repo.save({
      ...base,
      id: "c-tie-b",
      createdAt: new Date(now - 1_000),
    });
    await repo.save({
      ...base,
      id: "c-tie-a",
      createdAt: new Date(now - 1_000),
    });
    await repo.save({ ...base, id: "c-old", createdAt: new Date(now - 5_000) });
    await repo.save({
      ...base,
      id: "c-other",
      providerId: "p-other",
      consumerId: "p-other",
      createdAt: new Date(now),
    });
    const svc = new ContractService(
      new GMCryptoService(),
      repo,
      mockCatalog() as CatalogService,
      undefined,
      undefined,
      mockCompliance() as unknown as ComplianceService,
    );

    const first = (await svc.list({ role: "compliance" })).map((c) => c.id);
    expect(first).toEqual(["c-other", "c-tie-a", "c-tie-b", "c-old"]);
    // 两次请求序列一致（不依赖物理顺序）
    expect((await svc.list({ role: "compliance" })).map((c) => c.id)).toEqual(
      first,
    );
    // 角色过滤结果 = 全量序列的子序列（保序）
    const mine = (
      await svc.list({ role: "consumer", participantId: "p-pharma-demo" })
    ).map((c) => c.id);
    expect(mine).toEqual(["c-tie-a", "c-tie-b", "c-old"]);
    const positions = mine.map((id) => first.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("申请方撤回待审批申请：终态 revoked + decision.withdrawn", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma-demo", requireActor);
    const withdrawn = await svc.withdrawDraft(
      draft.id,
      "p-pharma-demo",
      "填错了数据产品",
      requireActor,
    );
    expect(withdrawn.status).toBe("revoked");
    expect(withdrawn.decision?.outcome).toBe("withdrawn");
    expect(withdrawn.decision?.by.participantId).toBe("p-pharma-demo");
    expect(withdrawn.decision?.by.name).toBe("李主任");
    expect(withdrawn.decision?.note).toBe("填错了数据产品");
    // 已撤回的申请不会再出现在「待审批」里
    expect(
      (
        await svc.list({ role: "consumer", participantId: "p-pharma-demo" })
      ).some((c) => c.effectiveStatus === "draft"),
    ).toBe(false);
  });

  it("撤回有边界：他人不能撤回、非待审批不能撤回", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma-demo", requireActor);
    await expect(
      svc.withdrawDraft(draft.id, "p-demohospa", "越权", requireActor),
    ).rejects.toThrow(/仅申请方/);

    await svc.acknowledge(draft.id, "p-pharma-demo");
    await svc.approveDraft(
      draft.id,
      "p-demohospa",
      undefined,
      undefined,
      requireActor,
    );
    await expect(
      svc.withdrawDraft(draft.id, "p-pharma-demo", "想反悔", requireActor),
    ).rejects.toThrow(/仅待审批/);
  });
});
