import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction } from '@medtrust/database';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditRepository: Repository<AuditLog>,
  ) {}

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
