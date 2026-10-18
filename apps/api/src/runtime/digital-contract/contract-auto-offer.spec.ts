import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AuditAction } from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import { CatalogService } from "../catalog/catalog.service";
import { ComplianceService } from "../../capability/l2-compliance/compliance.service";
import { DataAccessService } from "../data-access/data-access.service";
import { mockRepo } from "../test-utils/mock-repo";
import { ContractService } from "./contract.service";
import { MdopContractService } from "./mdop-contract.service";

/**
 * 预授权自动推进（Phase 3 / D-MDOP-9）。
 *
 * 要钉住的**不是**"平台能代签"，而是恰恰相反：
 * 1. 预授权（产品级 ACL）是平台侧推进的**前置条件**，没有就拒；
 * 2. 「需审批」预审（D-CMP-2）必须由医院逐条确认，自动推进不能绕过；
 * 3. 推进后要记 `autoOfferGrantId` / `autoOfferedAt` 并写审计——事后能对账"是谁的预授权放的行"；
 * 4. 签名仍由提供方连接器按院内本地策略决定（本用例里 `mdop.offer` 是替身，模拟"要约已发出"）。
 */
describe("ContractService.autoOffer（预授权自动推进）", () => {
  const apply = {
    dataProductId: "dp-1",
    compositionId: "comp-1",
    purpose: "RWS.EFFECTIVENESS",
    retention: "阅后即焚",
    output: "仅聚合统计",
    validDays: 30,
  };

  const catalog = {
    get: async (id: string) => ({
      id,
      urn: "urn:test",
      homeSpace: "sh-med",
      providerId: "p-hosp",
      title: "test",
      productType: "data" as const,
      status: "active" as const,
      rightsConfirmed: true,
      recordCount: 1,
      fhirSchema: null,
    }),
  } as unknown as CatalogService;

  const compliance = {
    getComposition: async (id: string) => ({
      id,
      ownerParticipantId: "p-pharma",
    }),
    evaluate: async () => ({
      id: "eval-1",
      autoVerdict: "auto_approve",
      overallRisk: "medium",
      required: {},
      blockingRulesMatched: [],
      warnings: [],
      structuralIssues: [],
      dimensions: {},
      dimensionSources: {},
      dimensionConflicts: [],
      rulesDigest: "SM3:x",
    }),
    toSnapshot: (e: { id: string; autoVerdict: string }) => ({
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
    }),
  } as unknown as ComplianceService;

  const allowAll = {
    check: async () => ({
      allowed: true,
      reason: "granted",
      dataProductId: "dp-1",
      participantId: "p-pharma",
      providerId: "p-hosp",
      permissions: ["compute"],
      grantId: "grant-1",
    }),
  } as unknown as DataAccessService;

  const denyAll = {
    check: async () => ({
      allowed: false,
      reason: "no-grant",
      dataProductId: "dp-1",
      participantId: "p-pharma",
      providerId: "p-hosp",
      permissions: [],
    }),
  } as unknown as DataAccessService;

  const offers: string[] = [];
  const mdop = {
    offer: async (contractId: string) => {
      offers.push(contractId);
      return { contractId, canonical: "{}", offerId: `offer:${contractId}:1` };
    },
  } as unknown as MdopContractService;

  const audits: Array<{
    action: AuditAction;
    tenantId: number;
    details: Record<string, unknown>;
  }> = [];
  const audit = {
    create: async (
      _userId: number,
      tenantId: number,
      dto: { action: AuditAction; details: Record<string, unknown> },
    ) => {
      audits.push({ action: dto.action, tenantId, details: dto.details });
      return { id: audits.length };
    },
  } as unknown as AuditService;

  const build = (
    dataAccess: DataAccessService,
    over: { mdop?: boolean } = {},
  ) => {
    const svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      catalog,
      undefined,
      undefined,
      compliance,
      undefined,
      undefined,
      dataAccess,
      audit,
    );
    // mdop/offer 是 7 号位（mdopContracts）
    (svc as unknown as { mdopContracts?: MdopContractService }).mdopContracts =
      over.mdop === false ? undefined : mdop;
    return svc;
  };

  const actor = { userId: 9, tenantId: 3 };

  it("预授权在册 → 定稿 + 发要约 + 记 autoOffer 留痕 + 写审计", async () => {
    offers.length = 0;
    audits.length = 0;
    const svc = build(allowAll);
    const draft = await svc.request(apply, "p-pharma");
    expect(draft.status).toBe("draft");

    const out = await svc.autoOffer(draft.id, "p-pharma", actor);

    expect(out.grantId).toBe("grant-1");
    expect(out.offered).toBe(true);
    expect(out.offerId).toContain("offer:");
    expect(out.contract).toMatchObject({
      status: "active",
      autoOfferGrantId: "grant-1",
    });
    expect(out.contract.autoOfferedAt).toBeTruthy();
    expect(out.contract.hash).toMatch(/^SM3:/);
    // P0-7：消费方规则知悉由本次调用代记
    expect(out.contract.consumerAcknowledgedAt).toBeTruthy();
    expect(offers).toEqual([draft.id]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: AuditAction.UPDATE,
      tenantId: 3,
    });
    expect(audits[0].details).toMatchObject({
      op: "auto-offer",
      contractId: draft.id,
      grantId: "grant-1",
      offerId: out.offerId,
    });
  });

  it("提供方没预授权 → 拒绝自动推进（预授权是平台侧推进的唯一依据）", async () => {
    const svc = build(denyAll);
    const draft = await svc.request(apply, "p-pharma");
    await expect(svc.autoOffer(draft.id, "p-pharma", actor)).rejects.toThrow(
      /尚未预授权/,
    );
  });

  it("非申请方不能推进（越权：别家使用方不能替别人触发）", async () => {
    const svc = build(allowAll);
    const draft = await svc.request(apply, "p-pharma");
    await expect(svc.autoOffer(draft.id, "p-other", actor)).rejects.toThrow(
      /仅该申请的数据使用方/,
    );
  });

  it("预审裁决为「需审批」→ 拒绝自动推进（D-CMP-2 必须医院逐条确认）", async () => {
    const manual = {
      ...compliance,
      evaluate: async () => ({
        id: "eval-2",
        autoVerdict: "manual_review",
        overallRisk: "high",
        required: {},
        blockingRulesMatched: [],
        warnings: [],
        structuralIssues: [],
        dimensions: {},
        dimensionSources: {},
        dimensionConflicts: [],
        rulesDigest: "SM3:y",
      }),
      toSnapshot: () => ({
        compositionId: "comp-1",
        evaluationId: "eval-2",
        verdict: "manual_review",
        overallRisk: "high",
        required: {},
        dimensions: {},
        dimensionSources: {},
        dimensionConflicts: [],
        rulesDigest: "SM3:y",
        evaluatedAt: "2026-01-01T00:00:00.000Z",
      }),
    } as unknown as ComplianceService;
    const svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      catalog,
      undefined,
      undefined,
      manual,
      undefined,
      undefined,
      allowAll,
      audit,
    );
    const draft = await svc.request(apply, "p-pharma");

    await expect(svc.autoOffer(draft.id, "p-pharma", actor)).rejects.toThrow(
      /需审批/,
    );
  });

  it("已 finalize 的合约不能二次推进（幂等边界：避免重复发要约）", async () => {
    const svc = build(allowAll);
    const draft = await svc.request(apply, "p-pharma");
    await svc.autoOffer(draft.id, "p-pharma", actor);
    await expect(svc.autoOffer(draft.id, "p-pharma", actor)).rejects.toThrow(
      /仅待审批申请/,
    );
  });

  it("发件箱不可用时仍不出错：合约定稿但 offered=false（如实回报，不假装已发）", async () => {
    const svc = build(allowAll, { mdop: false });
    const draft = await svc.request(apply, "p-pharma");
    const out = await svc.autoOffer(draft.id, "p-pharma", actor);
    expect(out.offered).toBe(false);
    expect(out.contract.status).toBe("active");
  });
});
