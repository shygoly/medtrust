import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { DataAccessRequest } from './access-request.entity';

export enum DataAssetType {
  EMR = 'emr',
  IMAGING = 'imaging',
  LAB = 'lab',
  PRESCRIPTION = 'prescription',
  FOLLOWUP = 'followup',
  GENOMIC = 'genomic',
}

export enum DataAssetStatus {
  DRAFT = 'draft',
  REVIEWING = 'reviewing',
  PUBLISHED = 'published',
  OFFLINE = 'offline',
}

@Entity('data_assets')
@Index(['tenantId'])
@Index(['type'])
@Index(['status'])
export class DataAsset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant, (tenant) => tenant.dataAssets)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'simple-enum',
    enum: DataAssetType,
  })
  type: DataAssetType;

  @Column({
    type: 'simple-enum',
    enum: DataAssetStatus,
    default: DataAssetStatus.DRAFT,
  })
  status: DataAssetStatus;

  // 数据详情
  @Column({ nullable: true, name: 'record_count' })
  recordCount: number;

  @Column({ nullable: true, name: 'patient_count' })
  patientCount: number;

  @Column({ nullable: true, name: 'time_range_start' })
  timeRangeStart: Date;

  @Column({ nullable: true, name: 'time_range_end' })
  timeRangeEnd: Date;

  @Column({ length: 20, nullable: true, name: 'hospital_level' })
  hospitalLevel: string;

  @Column({ length: 100, nullable: true })
  region: string;

  // 数据质量
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  completeness: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  accuracy: number;

  // 定价策略
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'price_per_query' })
  pricePerQuery: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'price_per_compute' })
  pricePerCompute: number;

  // 存储信息
  @Column({ type: 'text', nullable: true, name: 'storage_path' })
  storagePath: string;

  @Column({ nullable: true, name: 'storage_size' })
  storageSize: number;

  @Column({ type: 'text', nullable: true, name: 'encryption_key' })
  encryptionKey: string;

  // 使用条款
  @Column({ type: 'simple-json', nullable: true, name: 'usage_policy' })
  usagePolicy: any;

  @Column({ type: 'simple-json', nullable: true, name: 'required_approvals' })
  requiredApprovals: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ nullable: true, name: 'published_at' })
  publishedAt: Date;

  // 关联关系
  @OneToMany(() => DataAccessRequest, (request) => request.asset)
  accessRequests: DataAccessRequest[];
}
