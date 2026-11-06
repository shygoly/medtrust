import {
  DataProduct,
  DataProductAccessGrantEntity,
  DataProductAccessRequestEntity,
} from "@medtrust/database";
import { DataAccessService } from "./data-access.service";

/**
 * 访问申请（使用方发起 → 提供方批准）的语义钉子。
 *
 * 三件事必须在服务层钉死：
 * 1. **申请不产生访问能力**：pending 期间 `check()` 仍拒绝，只有批准后才有 grant；
 * 2. **谁能批**：只有产品提供方（或合规/运营）能批，别的提供方一律 403；
 * 3. **幂等与边界**：重复申请返回同一条；已有授权不许再申请；撤回/驳回后不能再批。
 */
describe("DataAccessService — 访问申请", () => {
  const PRODUCT = {
    id: "dp-1",
    providerId: "p-hosp-a",
    title: "试验组数据",
  } as DataProduct;

  let grantRows: any[];
  let requestRows: any[];
  let notifications: Array<{ type: string; recipient: string }>;
  let resolved: Array<{ resourceId: string; type?: string }>;
  let audits: any[];
  let service: DataAccessService;

  const grantQb = () => {
    const calls: Array<{ condition: string; params?: any }> = [];
    const qb: any = {
      calls,
      andWhere: (condition: string, params?: any) => {
        calls.push({ condition, params });
        return qb;
      },
      orderBy: () => qb,
      getMany: async () => {
        const dp = calls.find((c) => c.condition.includes("dataProductId"))?.params?.dp;
        const gp = calls.find((c) => c.condition.includes("granteeParticipantId"))?.params?.gp;
        return grantRows.filter(
          (row) => (!dp || row.dataProductId === dp) && (!gp || row.granteeParticipantId === gp),
        );
      },
    };
    return qb;
  };

  const grants = {
    create: (input: any) => ({ ...input }),
    save: async (row: any) => {
      const i = grantRows.findIndex((r) => r.id === row.id);
      if (i >= 0) grantRows[i] = row;
      else grantRows.push(row);
      return row;
    },
    findOne: async ({ where }: any) => grantRows.find((r) => r.id === where.id) ?? null,
    createQueryBuilder: () => grantQb(),
  };

  const requestQb = () => {
    const calls: Array<{ condition: string; params?: any }> = [];
    const qb: any = {
      calls,
      andWhere: (condition: string, params?: any) => {
        calls.push({ condition, params });
        return qb;
      },
      orderBy: () => qb,
      getMany: async () => {
        const st = calls.find((c) => c.condition.includes("r.status"))?.params?.st;
        const me = calls.find((c) => c.params?.me)?.params?.me;
        const providerOr = calls.some((c) => c.condition.includes("r.providerId"));
        return requestRows.filter(
          (row) =>
            (!st || row.status === st) &&
            (!me ||
              (providerOr
                ? row.providerId === me || row.requesterParticipantId === me
                : row.requesterParticipantId === me)),
        );
      },
    };
    return qb;
  };

  const requests = {
    create: (input: any) => ({ ...input }),
    save: async (row: any) => {
      const i = requestRows.findIndex((r) => r.id === row.id);
      if (i >= 0) requestRows[i] = row;
      else requestRows.push(row);
      return row;
    },
    findOne: async ({ where }: any) =>
      requestRows.find((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      ) ?? null,
    createQueryBuilder: () => requestQb(),
  };

  const products = {
    findOne: async ({ where }: any) => (where.id === PRODUCT.id ? PRODUCT : null),
  };

  beforeEach(() => {
    grantRows = [];
    requestRows = [];
    notifications = [];
    resolved = [];
    audits = [];
    service = new DataAccessService(
      grants as never,
      products as never,
      { scope: (qb: any) => qb } as never,
      { current: () => ({ spaceId: "sh-med" }) } as never,
      {
        create: async (_u: number, _t: number, dto: any) => {
          audits.push(dto);
          return { id: audits.length };
        },
      } as never,
      {
        notify: async (input: any) => {
          notifications.push({ type: input.type, recipient: input.recipientParticipantId });
          return {};
        },
        markResolved: async (input: any) => {
          resolved.push({ resourceId: input.resourceId, type: input.type });
          return { updated: 1 };
        },
      } as never,
      requests as never,
      {
        findOne: async ({ where }: any) =>
          where.id === 9 ? { id: 9, name: "研究员" } : null,
      } as never,
    );
  });

  const consumer = {
    userId: 9,
    tenantId: 3,
    participantId: "p-sponsor",
    role: "consumer",
    email: "researcher@example.org",
  };
  const provider = {
    userId: 7,
    tenantId: 3,
    participantId: "p-hosp-a",
    role: "provider",
    email: "admin@hosp-a.example",
  };
  const otherProvider = {
    userId: 8,
    tenantId: 3,
    participantId: "p-hosp-b",
    role: "provider",
  };

  it("申请落 pending 且不产生访问能力；提供方收到待办", async () => {
    const req = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    expect(req.status).toBe("pending");
    expect(req.requesterParticipantId).toBe("p-sponsor");
    expect(req.requester?.name).toBe("研究员");
    expect(req.requester?.email).toBe("researcher@example.org");
    expect(grantRows).toHaveLength(0);
    const check = await service.check({
      dataProductId: "dp-1",
      participantId: "p-sponsor",
    });
    expect(check.allowed).toBe(false);
    expect(notifications).toContainEqual({
      type: "data-access.requested",
      recipient: "p-hosp-a",
    });
  });

  it("重复申请幂等：返回同一条 pending，不新增行", async () => {
    const a = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    const b = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    expect(b.id).toBe(a.id);
    expect(requestRows).toHaveLength(1);
  });

  it("已有生效授权时拒绝重复申请；提供方不能申请自己的产品", async () => {
    grantRows.push({
      id: "g1",
      dataProductId: "dp-1",
      providerId: "p-hosp-a",
      granteeParticipantId: "p-sponsor",
      permissions: ["compute"],
      status: "active",
    });
    await expect(
      service.requestAccess({ dataProductId: "dp-1" }, consumer),
    ).rejects.toThrow(/已获得/);
    await expect(
      service.requestAccess({ dataProductId: "dp-1" }, provider),
    ).rejects.toThrow(/无需申请/);
  });

  it("批准：生成 active 授权（进审计）+ 申请置 approved + grantId", async () => {
    const req = await service.requestAccess(
      { dataProductId: "dp-1", permissions: ["catalog", "compute"], note: "联合课题" },
      consumer,
    );
    const { request, grant } = await service.approveRequest(req.id, provider);
    expect(grant.status).toBe("active");
    expect(grant.granteeParticipantId).toBe("p-sponsor");
    expect(grant.permissions).toEqual(["catalog", "compute"]);
    expect(request.status).toBe("approved");
    expect(request.grantId).toBe(grant.id);
    expect(request.decidedBy?.name).toBeNull(); // provider 快照按 userId 查不到姓名
    expect(audits.some((a) => a.resource === "data-access-grant")).toBe(true);

    const check = await service.check({
      dataProductId: "dp-1",
      participantId: "p-sponsor",
    });
    expect(check.allowed).toBe(true);
    expect(notifications.some((n) => n.type === "data-access.approved")).toBe(true);
    expect(resolved.some((r) => r.type === "data-access.requested")).toBe(true);
  });

  it("越权批准：别的提供方一律 403，申请保持 pending", async () => {
    const req = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    await expect(service.approveRequest(req.id, otherProvider)).rejects.toThrow(
      /只有该数据产品的提供方/,
    );
    expect(requestRows[0].status).toBe("pending");
    expect(grantRows).toHaveLength(0);
  });

  it("驳回必须给原因；驳回后不能再批", async () => {
    const req = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    await expect(service.rejectRequest(req.id, "  ", provider)).rejects.toThrow(
      /原因/,
    );
    const rejected = await service.rejectRequest(req.id, "数据未确权", provider);
    expect(rejected.status).toBe("rejected");
    expect(rejected.decisionNote).toBe("数据未确权");
    await expect(service.approveRequest(req.id, provider)).rejects.toThrow(
      /待处理/,
    );
    expect(notifications.some((n) => n.type === "data-access.rejected")).toBe(true);
  });

  it("申请方撤回：只能撤自己的、只能撤 pending；撤回后批准被拒", async () => {
    const req = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    await expect(service.withdrawRequest(req.id, provider)).rejects.toThrow(
      /仅申请方/,
    );
    const withdrawn = await service.withdrawRequest(req.id, consumer);
    expect(withdrawn.status).toBe("withdrawn");
    await expect(service.approveRequest(req.id, provider)).rejects.toThrow(
      /待处理/,
    );
    expect(notifications.some((n) => n.type === "data-access.withdrawn")).toBe(true);
  });

  it("清单按角色收窄：使用方只看自己的；提供方看申请自己产品的 + 自己发起的", async () => {
    const mine = await service.requestAccess({ dataProductId: "dp-1" }, consumer);
    const consumerList = await service.listRequests({}, consumer);
    expect(consumerList.map((r) => r.id)).toEqual([mine.id]);

    const providerList = await service.listRequests({}, provider);
    expect(providerList.map((r) => r.id)).toEqual([mine.id]);

    const otherList = await service.listRequests({}, otherProvider);
    expect(otherList).toEqual([]);
  });
});
