import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  AuditAction,
  DataProduct,
  DataProductAccessGrantEntity,
} from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import { SpaceContextService } from "../space-context/space-context.service";
import { SpaceScopeService } from "../space-context/space-scope.service";
import { DataAccessService } from "./data-access.service";

/**
 * 产品级 ACL 的语义钉子（D-ACL-1）。
 *
 * 这里用**内存替身**而不是真库：要验的是判定与授权规则（fail-closed / 谁有权授予 /
 * 追加式回收 / 到期即失效），这些是服务层契约。真驱动下的元数据另有守护
 * （space-context/entity-metadata.spec.ts 会真构建实体元数据）。
 */
describe("DataAccessService（产品级 ACL）", () => {
  const PRODUCT = {
    id: "dp-1",
    providerId: "p-hosp-a",
    title: "试验组数据",
  } as DataProduct;

  let rows: DataProductAccessGrantEntity[];
  let audits: Array<{
    action: AuditAction;
    tenantId: number;
    details: Record<string, unknown>;
  }>;
  let lastQuery: {
    calls: Array<{ condition: string; params?: Record<string, unknown> }>;
  };
  let service: DataAccessService;

  /** 查询构造器替身：把 andWhere 收集起来，getMany 交回全部行（过滤在内存里做）。 */
  const qbFor = () => {
    const calls: Array<{
      condition: string;
      params?: Record<string, unknown>;
    }> = [];
    const qb: Record<string, unknown> = {
      calls,
      andWhere: (condition: string, params?: Record<string, unknown>) => {
        calls.push({ condition, params });
        return qb;
      },
      orderBy: () => qb,
      getMany: async () => {
        const dp = calls.find((c) => c.condition.includes("dataProductId"))
          ?.params?.dp;
        const gp = calls.find((c) =>
          c.condition.includes("granteeParticipantId"),
        )?.params?.gp;
        const st = calls.find((c) => c.condition.includes("status"))?.params
          ?.st;
        return rows.filter(
          (row) =>
            (!dp || row.dataProductId === dp) &&
            (!gp || row.granteeParticipantId === gp) &&
            (!st || row.status === st),
        );
      },
    };
    return qb;
  };

  const grants = {
    create: (input: Partial<DataProductAccessGrantEntity>) => ({ ...input }),
    save: async (row: DataProductAccessGrantEntity) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    },
    findOne: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    createQueryBuilder: () => {
      const qb = qbFor();
      lastQuery = qb as unknown as typeof lastQuery;
      return qb;
    },
  };

  const products = {
    findOne: async ({ where }: { where: { id: string } }) =>
      where.id === PRODUCT.id ? PRODUCT : null,
  };

  beforeEach(async () => {
    rows = [];
    audits = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataAccessService,
        {
          provide: getRepositoryToken(
            DataProductAccessGrantEntity,
            "controlplane",
          ),
          useValue: grants,
        },
        {
          provide: getRepositoryToken(DataProduct, "controlplane"),
          useValue: products,
        },
        {
          provide: SpaceContextService,
          useValue: { current: () => ({ spaceId: "sh-med" }) },
        },
        {
          provide: SpaceScopeService,
          useValue: { scope: (qb: unknown) => qb },
        },
        {
          provide: AuditService,
          useValue: {
            create: async (
              _userId: number,
              tenantId: number,
              dto: { action: AuditAction; details: Record<string, unknown> },
            ) => {
              audits.push({
                action: dto.action,
                tenantId,
                details: dto.details,
              });
              return { id: audits.length };
            },
          },
        },
      ],
    }).compile();
    service = module.get(DataAccessService);
  });

  const provider = {
    userId: 7,
    tenantId: 3,
    participantId: "p-hosp-a",
    role: "provider",
  };
  const consumer = {
    userId: 9,
    tenantId: 3,
    participantId: "p-sponsor",
    role: "consumer",
  };

  it("服务上线即 fail-closed：没有任何授权时判定为拒绝，且原因可分辨", async () => {
    await expect(
      service.check({ dataProductId: "dp-1", participantId: "p-sponsor" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "no-grant",
      providerId: "p-hosp-a",
    });
  });

  it("提供方访问自己的产品不需要自授（否则每家医院都要给自己开一行）", async () => {
    await expect(
      service.check({ dataProductId: "dp-1", participantId: "p-hosp-a" }),
    ).resolves.toMatchObject({ allowed: true, reason: "provider-self" });
  });

  it("产品不存在 → product-unknown（不抛错：判定接口要能回答，调用方再决定怎么提示）", async () => {
    await expect(
      service.check({ dataProductId: "dp-nope", participantId: "p-sponsor" }),
    ).resolves.toMatchObject({ allowed: false, reason: "product-unknown" });
  });

  it("授予 → 立即生效；授予动作写审计链（CREATE + 产品/被授权方/权限）", async () => {
    const granted = await service.grant(
      {
        dataProductId: "dp-1",
        granteeParticipantId: "p-sponsor",
        expiresAt: "2027-01-01T00:00:00Z",
      },
      provider,
    );

    expect(granted).toMatchObject({
      dataProductId: "dp-1",
      providerId: "p-hosp-a",
      granteeParticipantId: "p-sponsor",
      permissions: ["compute"],
      status: "active",
      spaceId: "sh-med",
      grantedByParticipantId: "p-hosp-a",
    });
    await expect(
      service.check({ dataProductId: "dp-1", participantId: "p-sponsor" }),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "granted",
      grantId: granted.id,
    });

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: AuditAction.CREATE,
      tenantId: 3,
    });
    expect(audits[0].details).toMatchObject({
      op: "grant",
      dataProductId: "dp-1",
      granteeParticipantId: "p-sponsor",
      permissions: ["compute"],
    });
  });

  it("只有产品提供方（或合规/运营）能授予：使用方自己给自己授予 → 403", async () => {
    await expect(
      service.grant(
        { dataProductId: "dp-1", granteeParticipantId: "p-sponsor" },
        consumer,
      ),
    ).rejects.toThrow(/只有该数据产品的提供方/);
    expect(rows).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("合规/运营可代授（平台侧职责），审计仍记实际动作", async () => {
    await expect(
      service.grant(
        { dataProductId: "dp-1", granteeParticipantId: "p-sponsor" },
        { userId: 1, tenantId: 3, participantId: "p-gov", role: "compliance" },
      ),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("重复授予不产生重复行：更新既有 active 行（权限与到期），审计记 regrant", async () => {
    const first = await service.grant(
      { dataProductId: "dp-1", granteeParticipantId: "p-sponsor" },
      provider,
    );
    const second = await service.grant(
      {
        dataProductId: "dp-1",
        granteeParticipantId: "p-sponsor",
        permissions: ["catalog", "compute"],
        expiresAt: "2027-06-01T00:00:00Z",
      },
      provider,
    );

    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.permissions).toEqual(["catalog", "compute"]);
    expect(second.expiresAt).toBe(
      new Date("2027-06-01T00:00:00Z").toISOString(),
    );
    expect(audits.map((a) => a.details.op)).toEqual(["grant", "regrant"]);
  });

  it("提供方给自己授予 → 明确拒绝（无意义的行只会造成口径混乱）", async () => {
    await expect(
      service.grant(
        { dataProductId: "dp-1", granteeParticipantId: "p-hosp-a" },
        provider,
      ),
    ).rejects.toThrow(/无需授权/);
  });

  it("权限位与到期时间是入参校验的一部分（未知权限 / 过去时间都拒）", async () => {
    await expect(
      service.grant(
        {
          dataProductId: "dp-1",
          granteeParticipantId: "p-sponsor",
          permissions: ["write" as never],
        },
        provider,
      ),
    ).rejects.toThrow(/未知权限位/);
    await expect(
      service.grant(
        {
          dataProductId: "dp-1",
          granteeParticipantId: "p-sponsor",
          expiresAt: "2020-01-01T00:00:00Z",
        },
        provider,
      ),
    ).rejects.toThrow(/将来时间/);
  });

  it("权限不足：只有 catalog 时 compute 判定为拒绝（权限位是判定的组成部分）", async () => {
    await service.grant(
      {
        dataProductId: "dp-1",
        granteeParticipantId: "p-sponsor",
        permissions: ["catalog"],
      },
      provider,
    );
    await expect(
      service.check({
        dataProductId: "dp-1",
        participantId: "p-sponsor",
        permission: "catalog",
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      service.check({
        dataProductId: "dp-1",
        participantId: "p-sponsor",
        permission: "compute",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "permission-missing" });
  });

  it("到期即失效（不靠定时任务清理：判定时按时间算）", async () => {
    await service.grant(
      {
        dataProductId: "dp-1",
        granteeParticipantId: "p-sponsor",
        expiresAt: "2026-12-31T00:00:00Z",
      },
      provider,
    );
    await expect(
      service.check({
        dataProductId: "dp-1",
        participantId: "p-sponsor",
        now: new Date("2027-01-01T00:00:00Z"),
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "expired" });
  });

  it("目的限定：授权写了 purpose 时，用途不符即拒（与合约 purposeCode 同口径）", async () => {
    await service.grant(
      {
        dataProductId: "dp-1",
        granteeParticipantId: "p-sponsor",
        purpose: "rws.external-control",
      },
      provider,
    );
    await expect(
      service.check({
        dataProductId: "dp-1",
        participantId: "p-sponsor",
        purpose: "rws.external-control",
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      service.check({
        dataProductId: "dp-1",
        participantId: "p-sponsor",
        purpose: "power.load-forecast",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "purpose-mismatch" });
  });

  it("回收必须给原因，且是追加式：行保留、状态转 revoked、原因可查；回收后判定为 revoked", async () => {
    const granted = await service.grant(
      { dataProductId: "dp-1", granteeParticipantId: "p-sponsor" },
      provider,
    );

    await expect(service.revoke(granted.id, "   ", provider)).rejects.toThrow(
      /必须给出原因/,
    );

    const revoked = await service.revoke(granted.id, "合作项目结束", provider);
    expect(revoked).toMatchObject({
      id: granted.id,
      status: "revoked",
      revokeReason: "合作项目结束",
    });
    expect(revoked.revokedAt).toBeTruthy();
    // 行还在（授权历史是审计证据），判定换成 revoked 而不是 no-grant
    expect(rows).toHaveLength(1);
    await expect(
      service.check({ dataProductId: "dp-1", participantId: "p-sponsor" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "revoked",
      revokeReason: "合作项目结束",
    });
    // 重复回收 → 明确报错（而不是静默成功）
    await expect(
      service.revoke(granted.id, "再来一次", provider),
    ).rejects.toThrow(/已回收/);
    expect(audits.map((a) => a.details.op)).toEqual(["grant", "revoke"]);
  });

  it("回收需要权限：与该产品无关的提供方回收别人授出的权 → 403", async () => {
    const granted = await service.grant(
      { dataProductId: "dp-1", granteeParticipantId: "p-sponsor" },
      provider,
    );
    await expect(
      service.revoke(granted.id, "我说了算", {
        userId: 5,
        tenantId: 3,
        participantId: "p-hosp-b",
        role: "provider",
      }),
    ).rejects.toThrow(/只有该数据产品的提供方/);
  });

  it("清单可见性：非特权角色的查询被加上「与自己相关」过滤，合规/运营不加", async () => {
    await service.grant(
      { dataProductId: "dp-1", granteeParticipantId: "p-sponsor" },
      provider,
    );

    await service.list({ actor: consumer, dataProductId: "dp-1" });
    const mine = lastQuery.calls.map((call) => call.condition).join(" | ");
    expect(mine).toContain(
      "g.granteeParticipantId = :me OR g.providerId = :me",
    );
    expect(lastQuery.calls.find((c) => c.params?.me)?.params?.me).toBe(
      "p-sponsor",
    );

    await service.list({
      actor: {
        userId: 1,
        tenantId: 3,
        participantId: "p-gov",
        role: "compliance",
      },
      dataProductId: "dp-1",
    });
    const privileged = lastQuery.calls
      .map((call) => call.condition)
      .join(" | ");
    expect(privileged).not.toContain(":me");
  });
});
