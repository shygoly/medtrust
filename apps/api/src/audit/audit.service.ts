import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AuditLog,
  AuditAction,
  ComplianceLevel,
  Tenant,
  TenantType,
  TenantStatus,
} from "@medtrust/database";
import { CreateAuditLogDto } from "./dto/create-audit-log.dto";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { auditLogsToCsv } from "./audit-csv";

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepository: Repository<AuditLog>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
    private readonly gm: GMCryptoService,
  ) {}

  // 演示种子:首次启动且无日志时,造一个演示租户并灌入几条审计记录,
  // 使控制台审计页非空。失败不阻断启动。
  async onModuleInit(): Promise<void> {
    try {
      if ((await this.auditRepository.count()) > 0) return;
      let tenant = await this.tenantRepository.findOne({ where: {} });
      if (!tenant) {
        tenant = await this.tenantRepository.save(
          this.tenantRepository.create({
            name: "演示可信数据空间",
            type: TenantType.ADMIN,
            status: TenantStatus.ACTIVE,
          }),
        );
      }
      const tenantId = tenant.id;
      const ago = (m: number) => new Date(Date.now() - m * 60_000);
      const demo: Array<Partial<AuditLog>> = [
        {
          action: AuditAction.LOGIN,
          resourceType: "auth",
          details: { actor: "区域卫健委监管员" },
          timestamp: ago(2),
        },
        {
          action: AuditAction.READ,
          resourceType: "catalog",
          resourceId: 1,
          details: { product: "CKD 结构化随访队列" },
          timestamp: ago(18),
        },
        {
          action: AuditAction.APPROVE,
          resourceType: "contract",
          resourceId: 1,
          details: { purpose: "CKD 多中心 RWS", consumer: "创新药企" },
          complianceLevel: ComplianceLevel.MEDIUM,
          timestamp: ago(35),
        },
        {
          action: AuditAction.COMPUTE,
          resourceType: "rws-task",
          resourceId: 2990,
          details: { task: "rws-2990", verdict: "manual_review" },
          complianceLevel: ComplianceLevel.HIGH,
          requiresReview: true,
          timestamp: ago(62),
        },
        {
          action: AuditAction.DOWNLOAD,
          resourceType: "aggregate-result",
          resourceId: 2990,
          details: { note: "仅聚合结果出域 · 原始数据不出域" },
          timestamp: ago(90),
        },
        {
          action: AuditAction.UPDATE,
          resourceType: "capability",
          details: { layer: "l3_model", key: "meditron-7b" },
          timestamp: ago(140),
        },
      ];
      let prevHash = "GENESIS";
      for (const d of demo) {
        const log = this.auditRepository.create({ tenantId, ...d });
        const chain = this.computeEntryHash(log, prevHash);
        log.prevHash = prevHash;
        log.entryHash = chain;
        await this.auditRepository.save(log);
        prevHash = chain;
      }
      this.logger.log(
        `seeded ${demo.length} demo audit logs (tenant ${tenantId})`,
      );
    } catch (e) {
      this.logger.warn(`demo audit seed skipped: ${(e as Error).message}`);
    }
  }

  async create(
    userId: number,
    tenantId: number,
    createDto: CreateAuditLogDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuditLog> {
    // DTO 的 `resource` ↔ 实体列 `resourceType` 的映射必须显式做：
    // TypeORM 的 create() 只拷贝实体声明过的属性，直接展开 DTO 会让 `resource`
    // 静默消失（`resource_type` 恒为 null），而查询/统计按资源筛选就走不下去。
    const resourceType = createDto.resource ?? createDto.resourceType;
    if (!resourceType) {
      throw new BadRequestException("审计日志必须带 resource（资源类型）");
    }
    // P1-5:平台审计日志链式哈希(SM3)。每条日志的 prevHash 指向前一条 entryHash。
    const latest = await this.auditRepository.findOne({
      where: { tenantId },
      order: { timestamp: "DESC", id: "DESC" },
    });
    const prevHash = latest?.entryHash ?? "GENESIS";
    const {
      resource: _resource,
      resourceType: _resourceType,
      ...rest
    } = createDto;
    const log = this.auditRepository.create({
      ...rest,
      resourceType,
      userId,
      tenantId,
      ipAddress: ipAddress || createDto.ipAddress,
      userAgent: userAgent || createDto.userAgent,
      timestamp: new Date(),
    });
    log.prevHash = prevHash;
    log.entryHash = this.computeEntryHash(log, prevHash);
    return this.auditRepository.save(log);
  }

  // P1-5:完整性校验端点——重算链比对,任一条被篡改则报警。
  async verifyIntegrity(tenantId: number): Promise<{
    ok: boolean;
    checked: number;
    firstBreakIndex?: number;
    firstBreakId?: number;
    message: string;
  }> {
    const logs = await this.auditRepository.find({
      where: { tenantId },
      order: { timestamp: "ASC", id: "ASC" },
    });
    let prevHash = "GENESIS";
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const expectedEntry = this.computeEntryHash(log, prevHash);
      if (log.prevHash !== prevHash || log.entryHash !== expectedEntry) {
        return {
          ok: false,
          checked: i + 1,
          firstBreakIndex: i,
          firstBreakId: log.id,
          message: `审计日志链在第 ${i + 1} 条断裂`,
        };
      }
      prevHash = expectedEntry;
    }
    return { ok: true, checked: logs.length, message: "审计日志链完整" };
  }

  /** 审计条目 SM3 指纹:SM3(prevHash|tenantId|userId|action|resourceType|resourceId|details|ip|ua|timestamp)。 */
  private computeEntryHash(log: AuditLog, prevHash: string): string {
    const details = JSON.stringify(log.details ?? {});
    const timestamp = log.timestamp
      ? new Date(log.timestamp).toISOString()
      : "";
    const payload = [
      prevHash,
      log.tenantId ?? "",
      log.userId ?? "",
      log.action ?? "",
      log.resourceType ?? "",
      log.resourceId ?? "",
      details,
      log.ipAddress ?? "",
      log.userAgent ?? "",
      timestamp,
    ].join("|");
    return "SM3:" + this.gm.sm3Hash(payload);
  }

  async findAll(query: {
    tenantId?: number;
    userId?: number;
    action?: AuditAction;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<[AuditLog[], number]> {
    const qb = this.auditRepository
      .createQueryBuilder("audit")
      .leftJoinAndSelect("audit.user", "user")
      .leftJoinAndSelect("audit.tenant", "tenant");

    if (query.tenantId) {
      qb.andWhere("audit.tenantId = :tenantId", { tenantId: query.tenantId });
    }

    if (query.userId) {
      qb.andWhere("audit.userId = :userId", { userId: query.userId });
    }

    if (query.action) {
      qb.andWhere("audit.action = :action", { action: query.action });
    }

    if (query.resource) {
      qb.andWhere("audit.resourceType = :resource", {
        resource: query.resource,
      });
    }

    if (query.startDate) {
      qb.andWhere("audit.timestamp >= :startDate", {
        startDate: query.startDate,
      });
    }

    if (query.endDate) {
      qb.andWhere("audit.timestamp <= :endDate", { endDate: query.endDate });
    }

    qb.orderBy("audit.timestamp", "DESC");

    const limit = query.limit || 50;
    const offset = query.offset || 0;
    qb.skip(offset).take(limit);

    return qb.getManyAndCount();
  }

  async findByTenant(tenantId: number, limit = 50): Promise<AuditLog[]> {
    return this.auditRepository.find({
      where: { tenantId },
      relations: ["user"],
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async findByUser(userId: number, limit = 50): Promise<AuditLog[]> {
    return this.auditRepository.find({
      where: { userId },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async getStats(tenantId: number) {
    // 按操作类型统计
    const actionStats = await this.auditRepository
      .createQueryBuilder("audit")
      .where("audit.tenantId = :tenantId", { tenantId })
      .select("audit.action", "action")
      .addSelect("COUNT(*)", "count")
      .groupBy("audit.action")
      .getRawMany();

    // 按资源类型统计
    const resourceStats = await this.auditRepository
      .createQueryBuilder("audit")
      .where("audit.tenantId = :tenantId", { tenantId })
      .select("audit.resourceType", "resource")
      .addSelect("COUNT(*)", "count")
      .groupBy("audit.resourceType")
      .getRawMany();

    // 最近7天统计
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyStats = await this.auditRepository
      .createQueryBuilder("audit")
      .where("audit.tenantId = :tenantId", { tenantId })
      .andWhere("audit.timestamp >= :date", { date: sevenDaysAgo })
      .select("DATE(audit.timestamp)", "date")
      .addSelect("COUNT(*)", "count")
      .groupBy("DATE(audit.timestamp)")
      .getRawMany();

    return {
      actionStats: actionStats.reduce((acc, curr) => {
        acc[curr.action] = parseInt(curr.count);
        return acc;
      }, {}),
      resourceStats: resourceStats.reduce((acc, curr) => {
        acc[curr.resource] = parseInt(curr.count);
        return acc;
      }, {}),
      dailyStats,
    };
  }

  // P2-5:审计报告导出(JSON + SM3 链完整性结论)。合规/运营可下载,
  // 报告包含生成时间、筛选条件、完整性校验结果与全部命中条目。
  async exportReport(query: {
    tenantId?: number;
    action?: AuditAction;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const [entries, total] = await this.findAll({
      ...query,
      limit: query.limit ?? 200,
      offset: query.offset ?? 0,
    });
    const integrity = await this.verifyIntegrity(query.tenantId ?? 0);
    return {
      report: "MedTrust 审计报告",
      generatedAt: new Date().toISOString(),
      tenantId: query.tenantId ?? null,
      filters: {
        action: query.action ?? null,
        resource: query.resource ?? null,
        startDate: query.startDate?.toISOString() ?? null,
        endDate: query.endDate?.toISOString() ?? null,
      },
      total,
      integrity,
      entries: entries.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        userId: e.userId,
        userName: e.user?.name ?? e.user?.email ?? null,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        details: e.details,
        complianceLevel: e.complianceLevel,
        requiresReview: e.requiresReview,
        entryHash: e.entryHash,
        prevHash: e.prevHash,
      })),
    };
  }

  /**
   * 审计条目导出为 CSV（按同一套筛选：时间段 / 动作 / 资源）。
   *
   * 与 `exportReport()` 的分工：报告是"带链校验结论的 JSON"，CSV 是"给表格工具用的原始行"。
   * 两者共用 `findAll()` 的筛选语义，避免"报告查得到、CSV 查不到"这种口径漂移。
   */
  async exportCsv(query: {
    tenantId?: number;
    action?: AuditAction;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<string> {
    const [entries] = await this.findAll({
      ...query,
      limit: query.limit ?? 200,
      offset: query.offset ?? 0,
    });
    return auditLogsToCsv(entries);
  }
}
