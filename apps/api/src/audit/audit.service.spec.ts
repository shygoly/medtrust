import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { getMetadataArgsStorage } from "typeorm";
import { AuditAction, AuditLog, Tenant } from "@medtrust/database";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { AuditService } from "./audit.service";

/**
 * 审计通道的**写入映射**与**查询列名**。
 *
 * 这两个点曾经是静默的：`CreateAuditLogDto` 的字段叫 `resource`，实体列叫 `resourceType`，
 * 而 `create()` 直接展开 DTO → TypeORM 只认实体声明过的属性，`resource` 被丢弃、
 * `resource_type` 恒为 null；同时 `findAll()`/`getStats()` 过滤/分组用的是 `audit.resource`
 * ——表里**没有这一列**。结果是：审计链照写、页面照开，只是"按资源筛合同操作"永远筛不出来。
 *
 * 所以这里的测试替身**照抄 TypeORM 的行为**：只保留实体声明过的列（列名从 entity 元数据读，
 * 不手写），否则"服务把 resource 塞进 create()"这种假绿会再次蒙混过关。
 */
describe("AuditService", () => {
  const columnProps = getMetadataArgsStorage()
    .columns.filter((column) => column.target === AuditLog)
    .map((column) => String(column.propertyName));

  interface QueryCall {
    where: string[];
    select: string[];
    groupBy: string[];
  }

  let saved: Array<Record<string, unknown>>;
  let calls: QueryCall;

  const repo = {
    createdInputs: [] as Array<Record<string, unknown>>,
    create(input: Record<string, unknown>) {
      repo.createdInputs.push(input);
      const row: Record<string, unknown> = {};
      // TypeORM create() 的语义：只拷贝实体声明过的属性
      for (const key of columnProps) if (key in input) row[key] = input[key];
      return row;
    },
    async save(row: Record<string, unknown>) {
      saved.push(row);
      return row;
    },
    async findOne(opts: { where?: { tenantId?: number } }) {
      const rows = saved.filter(
        (row) => !opts?.where?.tenantId || row.tenantId === opts.where.tenantId,
      );
      return rows[rows.length - 1] ?? null;
    },
    async find(opts: { where?: { tenantId?: number } } = {}) {
      return saved.filter(
        (row) => !opts?.where?.tenantId || row.tenantId === opts.where.tenantId,
      );
    },
    createQueryBuilder() {
      const qb: Record<string, unknown> = {
        leftJoinAndSelect: () => qb,
        andWhere: (sql: string) => {
          calls.where.push(sql);
          return qb;
        },
        where: (sql: string) => {
          calls.where.push(sql);
          return qb;
        },
        select: (sql: string) => {
          calls.select.push(sql);
          return qb;
        },
        addSelect: (sql: string) => {
          calls.select.push(sql);
          return qb;
        },
        groupBy: (sql: string) => {
          calls.groupBy.push(sql);
          return qb;
        },
        orderBy: () => qb,
        skip: () => qb,
        take: () => qb,
        getManyAndCount: async () => [[], 0],
        getRawMany: async () => [],
      };
      return qb;
    },
  };

  const gm = { sm3Hash: (payload: string) => `sm3:${payload.length}` };
  const tenants = {
    findOne: async () => null,
    save: async (t: Tenant) => t,
    create: (t: Tenant) => t,
  };

  let service: AuditService;

  beforeEach(async () => {
    saved = [];
    calls = { where: [], select: [], groupBy: [] };
    repo.createdInputs = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
        { provide: getRepositoryToken(Tenant), useValue: tenants },
        { provide: GMCryptoService, useValue: gm },
      ],
    }).compile();
    service = module.get(AuditService);
  });

  it("create() 把 DTO 的 resource 落到实体的 resourceType 列（否则按资源筛选永远为空）", async () => {
    await service.create(7, 1, {
      action: AuditAction.CREATE,
      resource: "contract",
      details: { contractId: "ct-1", source: "ai-chat-agent" },
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      action: AuditAction.CREATE,
      resourceType: "contract",
      userId: 7,
      tenantId: 1,
    });
    // 多余属性不被带进实体（DTO 的 resource 不是列）
    expect(saved[0].resource).toBeUndefined();
  });

  it("链式哈希：第二条的 prevHash 指向第一条的 entryHash，且校验通过", async () => {
    const first = await service.create(7, 1, {
      action: AuditAction.LOGIN,
      resource: "auth",
    });
    const second = await service.create(7, 1, {
      action: AuditAction.COMPUTE,
      resource: "rws-task",
      details: { jobId: "job-1", contractId: "ct-1" },
    });

    expect(first.prevHash).toBe("GENESIS");
    expect(second.prevHash).toBe(first.entryHash);
    expect(second.entryHash).toMatch(/^SM3:/);

    await expect(service.verifyIntegrity(1)).resolves.toMatchObject({
      ok: true,
      checked: 2,
    });
  });

  it("查询/统计用的是**存在的那一列**（resourceType，不是 resource）", async () => {
    await service.findAll({ tenantId: 1, resource: "contract" });
    await service.getStats(1);

    const where = calls.where.join(" ");
    const select = calls.select.join(" ");
    const groupBy = calls.groupBy.join(" ");

    expect(where).toContain("audit.resourceType");
    expect(select).toContain("audit.resourceType");
    expect(groupBy).toContain("audit.resourceType");
    // 反向断言：不得再出现表里没有的 resource 列
    for (const sql of [where, select, groupBy]) {
      expect(sql).not.toMatch(/audit\.resource(?!Type)/);
    }
  });

  it("exportReport 带出 resourceType 与链校验结论（导出可复核）", async () => {
    await service.create(7, 1, {
      action: AuditAction.CREATE,
      resource: "contract",
      details: { contractId: "ct-9" },
    });

    const report = await service.exportReport({ tenantId: 1 });
    expect(report).toMatchObject({
      report: "MedTrust 审计报告",
      tenantId: 1,
      integrity: { ok: true, checked: 1 },
    });
    expect(report.filters).toMatchObject({ resource: null });
    expect(report.total).toBe(0); // 查询替身返回空列表；这里钉的是形状而非数据量
  });
});
