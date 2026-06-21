import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction, ComplianceLevel, Tenant, TenantType, TenantStatus } from '@medtrust/database';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepository: Repository<AuditLog>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
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
            name: '演示可信数据空间',
            type: TenantType.ADMIN,
            status: TenantStatus.ACTIVE,
          }),
        );
      }
      const tenantId = tenant.id;
      const ago = (m: number) => new Date(Date.now() - m * 60_000);
      const demo: Array<Partial<AuditLog>> = [
        { action: AuditAction.LOGIN, resourceType: 'auth', details: { actor: '区域卫健委监管员' }, timestamp: ago(2) },
        { action: AuditAction.READ, resourceType: 'catalog', resourceId: 1, details: { product: 'CKD 结构化随访队列' }, timestamp: ago(18) },
        { action: AuditAction.APPROVE, resourceType: 'contract', resourceId: 1, details: { purpose: 'CKD 多中心 RWS', consumer: '恒瑞医药' }, complianceLevel: ComplianceLevel.MEDIUM, timestamp: ago(35) },
        { action: AuditAction.COMPUTE, resourceType: 'rws-task', resourceId: 2990, details: { task: 'rws-2990', verdict: 'manual_review' }, complianceLevel: ComplianceLevel.HIGH, requiresReview: true, timestamp: ago(62) },
        { action: AuditAction.DOWNLOAD, resourceType: 'aggregate-result', resourceId: 2990, details: { note: '仅聚合结果出域 · 原始数据不出域' }, timestamp: ago(90) },
        { action: AuditAction.UPDATE, resourceType: 'capability', details: { layer: 'l3_model', key: 'meditron-7b' }, timestamp: ago(140) },
      ];
      for (const d of demo) {
        await this.auditRepository.save(this.auditRepository.create({ tenantId, ...d }));
      }
      this.logger.log(`seeded ${demo.length} demo audit logs (tenant ${tenantId})`);
    } catch (e) {
      this.logger.warn(`demo audit seed skipped: ${(e as Error).message}`);
    }
  }

  async create(userId: number, tenantId: number, createDto: CreateAuditLogDto, ipAddress?: string, userAgent?: string): Promise<AuditLog> {
    const log = this.auditRepository.create({
      ...createDto,
      userId,
      tenantId,
      ipAddress: ipAddress || createDto.ipAddress,
      userAgent: userAgent || createDto.userAgent,
      timestamp: new Date(),
    });
    return this.auditRepository.save(log);
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
    const qb = this.auditRepository.createQueryBuilder('audit')
      .leftJoinAndSelect('audit.user', 'user')
      .leftJoinAndSelect('audit.tenant', 'tenant');

    if (query.tenantId) {
      qb.andWhere('audit.tenantId = :tenantId', { tenantId: query.tenantId });
    }

    if (query.userId) {
      qb.andWhere('audit.userId = :userId', { userId: query.userId });
    }

    if (query.action) {
      qb.andWhere('audit.action = :action', { action: query.action });
    }

    if (query.resource) {
      qb.andWhere('audit.resource = :resource', { resource: query.resource });
    }

    if (query.startDate) {
      qb.andWhere('audit.timestamp >= :startDate', { startDate: query.startDate });
    }

    if (query.endDate) {
      qb.andWhere('audit.timestamp <= :endDate', { endDate: query.endDate });
    }

    qb.orderBy('audit.timestamp', 'DESC');

    const limit = query.limit || 50;
    const offset = query.offset || 0;
    qb.skip(offset).take(limit);

    return qb.getManyAndCount();
  }

  async findByTenant(tenantId: number, limit = 50): Promise<AuditLog[]> {
    return this.auditRepository.find({
      where: { tenantId },
      relations: ['user'],
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async findByUser(userId: number, limit = 50): Promise<AuditLog[]> {
    return this.auditRepository.find({
      where: { userId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getStats(tenantId: number) {
    // 按操作类型统计
    const actionStats = await this.auditRepository
      .createQueryBuilder('audit')
      .where('audit.tenantId = :tenantId', { tenantId })
      .select('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.action')
      .getRawMany();

    // 按资源类型统计
    const resourceStats = await this.auditRepository
      .createQueryBuilder('audit')
      .where('audit.tenantId = :tenantId', { tenantId })
      .select('audit.resource', 'resource')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.resource')
      .getRawMany();

    // 最近7天统计
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyStats = await this.auditRepository
      .createQueryBuilder('audit')
      .where('audit.tenantId = :tenantId', { tenantId })
      .andWhere('audit.timestamp >= :date', { date: sevenDaysAgo })
      .select('DATE(audit.timestamp)', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('DATE(audit.timestamp)')
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
}
