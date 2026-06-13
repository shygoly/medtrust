import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { DataAsset } from './data-asset.entity';

export enum AccessRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

@Entity('data_access_requests')
@Index(['requesterTenantId'])
@Index(['providerTenantId'])
@Index(['assetId'])
export class DataAccessRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'requester_tenant_id' })
  requesterTenantId: number;

  @ManyToOne(() => Tenant, (tenant) => tenant.accessRequests)
  @JoinColumn({ name: 'requester_tenant_id' })
  requester: Tenant;

  @Column({ name: 'provider_tenant_id' })
  providerTenantId: number;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'provider_tenant_id' })
  provider: Tenant;

  @Column({ name: 'asset_id' })
  assetId: number;

  @ManyToOne(() => DataAsset, (asset) => asset.accessRequests)
  @JoinColumn({ name: 'asset_id' })
  asset: DataAsset;

  // 申请信息
  @Column({ type: 'text' })
  purpose: string;

  @Column({ nullable: true, name: 'expected_duration' })
  expectedDuration: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true, name: 'expected_cost' })
  expectedCost: number;

  // 状态
  @Column({
    type: 'simple-enum',
    enum: AccessRequestStatus,
    default: AccessRequestStatus.PENDING,
  })
  status: AccessRequestStatus;

  @Column({ nullable: true, name: 'approved_by' })
  approvedBy: number;

  @Column({ nullable: true, name: 'approved_at' })
  approvedAt: Date;

  @Column({ type: 'text', nullable: true, name: 'rejection_reason' })
  rejectionReason: string;

  // 实际使用
  @Column({ nullable: true, name: 'actual_start_at' })
  actualStartAt: Date;

  @Column({ nullable: true, name: 'actual_end_at' })
  actualEndAt: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true, name: 'actual_cost' })
  actualCost: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
