import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CatalogService } from "../catalog/catalog.service";
import { ComplianceService } from "../../capability/l2-compliance/compliance.service";
import { DataAccessService } from "../data-access/data-access.service";
import { NotificationService } from "../notifications/notification.service";
import { mockRepo } from "../test-utils/mock-repo";
import { ContractService, approvalWaitSeconds } from "./contract.service";
import { MdopContractService } from "./mdop-contract.service";

/**
 * Phase 4.2「审批通知」：合约生命周期要**通知到机构**（当前唯一通道 = 站内信，D-NOTIF-1）。
 *
 * 这里钉四件事是否真的发得出去、发给谁：
 * - 申请创建 → 通知**提供方**（"有人申请了你的数据"）；
 * - 医院签发 → 通知**使用方**（"可以提交作业了"，带审批时延）；
 * - 医院驳回 → 通知**使用方**（拒绝要说明，不能静默）；
 * - 预授权自动推进 → 通知**提供方**（你的预授权用上了，签不签看你连接器策略）。
 *
 * 不验通道投递（站内信就是落库 + 收件箱；邮件/短信本仓没有生产通道，未假装支持）。
 */
describe("合约生命周期 → 站内信（D-NOTIF-1）", () => {
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
    toSnapshot: () => ({
      compositionId: "comp-1",
      evaluationId: "eval-1",
      verdict: "auto_approve",
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

  const sent: Array<{
    recipientParticipantId: string;
    type: string;
    title: string;
    resourceId?: string;
    actorParticipantId?: string | null;
    details?: Record<string, unknown>;
  }> = [];
  const notifications = {
    notify: async (input: {
      recipientParticipantId: string;
      type: string;
      title: string;
      resourceId?: string;
      actorParticipantId?: string | null;
      details?: Record<string, unknown>;
    }) => {
      sent.push(input);
      return { id: `n-${sent.length}` };
    },
  } as unknown as NotificationService;

  const mdop = {
    offer: async (contractId: string) => ({
      contractId,
      canonical: "{}",
      offerId: `offer:${contractId}:1`,
    }),
  } as unknown as MdopContractService;

  const build = () => {
    const svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      catalog,
      undefined,
      undefined,
      compliance,
      undefined,
      undefined,
      allowAll,
      undefined,
      notifications,
    );
    (svc as unknown as { mdopContracts?: MdopContractService }).mdopContracts =
      mdop;
    return svc;
  };

  beforeEach(() => {
    sent.length = 0;
  });

  it("申请创建 → 通知提供方（机构待办），带合约/产品/用途", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientParticipantId: "p-hosp",
      type: "contract.request",
      resourceId: draft.id,
      actorParticipantId: "p-pharma",
    });
    expect(sent[0].details).toMatchObject({
      contractId: draft.id,
      dataProductId: "dp-1",
      consumerId: "p-pharma",
    });
  });

  it("医院签发 → 通知使用方，并带审批时延（Phase 4 的 <24h 指标口径）", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma");
    // P0-7：消费方须先确认规则知悉，医院才能签发（合约本体的前置，与通知无关）
    await svc.acknowledge(draft.id, "p-pharma");
    sent.length = 0;

    await svc.approveDraft(draft.id, "p-hosp");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientParticipantId: "p-pharma",
      type: "contract.approved",
      resourceId: draft.id,
      actorParticipantId: "p-hosp",
    });
    // 时延字段必须在（值可能为 null——单测的内存仓库不模拟 @CreateDateColumn，
    // 真库会带上 createdAt；时延口径本身另有用例直接测函数）
    expect(sent[0].details).toHaveProperty("waitSeconds");
  });

  it("审批时延口径：有 createdAt 就是秒数，未知一律 null（不编 0）", () => {
    const now = new Date("2026-10-16T12:00:00.000Z");
    expect(
      approvalWaitSeconds({ createdAt: "2026-10-16T11:00:00.000Z" }, now),
    ).toBe(3600);
    expect(approvalWaitSeconds({ createdAt: now }, now)).toBe(0);
    expect(
      approvalWaitSeconds({ createdAt: "2030-01-01T00:00:00.000Z" }, now),
    ).toBe(0);
    expect(approvalWaitSeconds({}, now)).toBeNull();
    expect(approvalWaitSeconds({ createdAt: "不是时间" }, now)).toBeNull();
  });

  it("医院驳回 → 通知使用方（拒绝不能静默）", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma");
    sent.length = 0;

    await svc.rejectDraft(draft.id, "p-hosp");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientParticipantId: "p-pharma",
      type: "contract.rejected",
    });
    expect(sent[0].title).toContain("驳回");
  });

  it("预授权自动推进 → 通知提供方（说明「签不签看你连接器策略」，不含糊）", async () => {
    const svc = build();
    const draft = await svc.request(apply, "p-pharma");
    sent.length = 0;

    await svc.autoOffer(draft.id, "p-pharma", { userId: 9, tenantId: 3 });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientParticipantId: "p-hosp",
      type: "contract.auto-offered",
      resourceId: draft.id,
    });
    expect(sent[0].details).toMatchObject({ grantId: "grant-1" });
  });

  it("没有通知服务时不炸（@Optional 兼容既有手工构造）", async () => {
    const svc = new ContractService(
      new GMCryptoService(),
      mockRepo(),
      catalog,
      undefined,
      undefined,
      compliance,
    );
    await expect(svc.request(apply, "p-pharma")).resolves.toMatchObject({
      status: "draft",
    });
  });
});
