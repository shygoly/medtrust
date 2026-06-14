import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ComputeTask } from './compute-task.entity';
import { AuditLog } from './audit-log.entity';

export enum TenantType {
  PROVIDER = 'provider',
  CONSUMER = 'consumer',
  ADMIN = 'admin',
  TECH = 'tech',
}

export enum TenantStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected',
}

@Entity('tenants')
@Index(['type'])
@Index(['status'])
export class Tenant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({
    type: 'simple-enum',
    enum: TenantType,
    default: TenantType.CONSUMER,
  })
  type: TenantType;

  @Column({
    type: 'simple-enum',
    enum: TenantStatus,
    default: TenantStatus.PENDING,
  })
  status: TenantStatus;

  @Column({ type: 'text', nullable: true })
  description: string;

  // 资质信息
  @Column({ type: 'text', nullable: true, name: 'business_license' })
  businessLicense: string;

  @Column({ type: 'text', nullable: true, name: 'medical_license' })
  medicalLicense: string;

  @Column({ type: 'text', nullable: true, name: 'legal_person_id' })
  legalPersonId: string;

  // 联系信息
  @Column({ length: 100, nullable: true, name: 'contact_name' })
  contactName: string;

  @Column({ length: 20, nullable: true, name: 'contact_phone' })
  contactPhone: string;

  @Column({ length: 255, nullable: true, name: 'contact_email' })
  contactEmail: string;

  // 配额设置
  @Column({ default: 100, name: 'compute_quota' })
  computeQuota: number;

  @Column({ default: 1000, name: 'storage_quota' })
  storageQuota: number;

  @Column({ default: 365, name: 'data_retention' })
  dataRetention: number;

  // 财务信息
  @Column({ nullable: true, name: 'stripe_customer_id' })
  stripeCustomerId: string;

  @Column({ nullable: true, name: 'stripe_subscription_id' })
  stripeSubscriptionId: string;

  @Column({ nullable: true, name: 'stripe_product_id' })
  stripeProductId: string;

  @Column({ length: 50, nullable: true, name: 'plan_name' })
  planName: string;

  @Column({ length: 20, nullable: true, name: 'subscription_status' })
  subscriptionStatus: string;

  // 统计信息
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, name: 'total_earnings' })
  totalEarnings: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, name: 'total_spending' })
  totalSpending: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ nullable: true, name: 'verified_at' })
  verifiedAt: Date;

  // 关联关系(data-asset / access-request 已下线 8.1/8.2)
  @OneToMany(() => ComputeTask, (task) => task.tenant)
  computeTasks: ComputeTask[];

  @OneToMany(() => AuditLog, (log) => log.tenant)
  auditLogs: AuditLog[];
}
