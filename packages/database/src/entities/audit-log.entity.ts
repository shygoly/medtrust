import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';

export enum ComplianceLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

@Entity('audit_logs')
@Index(['tenant_id'])
@Index(['user_id'])
@Index(['action'])
@Index(['resource_type'])
@Index(['timestamp'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant, (tenant) => tenant.auditLogs)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ nullable: true, name: 'user_id' })
  userId: number;

  @ManyToOne(() => User, (user) => user.auditLogs)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 50 })
  action: string;

  @Column({ length: 50, nullable: true, name: 'resource_type' })
  resourceType: string;

  @Column({ nullable: true, name: 'resource_id' })
  resourceId: number;

  // 详细记录
  @Column({ type: 'simple-json', nullable: true })
  details: any;

  @Column({ length: 45, nullable: true, name: 'ip_address' })
  ipAddress: string;

  @Column({ type: 'text', nullable: true, name: 'user_agent' })
  userAgent: string;

  // 合规标记
  @Column({
    type: 'simple-enum',
    enum: ComplianceLevel,
    default: ComplianceLevel.LOW,
    name: 'compliance_level',
  })
  complianceLevel: ComplianceLevel;

  @Column({ default: false, name: 'requires_review' })
  requiresReview: boolean;

  @Column({ nullable: true, name: 'reviewed_by' })
  reviewedBy: number;

  @Column({ nullable: true, name: 'reviewed_at' })
  reviewedAt: Date;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp: Date;
}
