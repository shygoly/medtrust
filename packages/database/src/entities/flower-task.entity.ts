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

export enum FlowerTaskStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Flower Task Entity
 * Stores mapping between ComputeTask and Flower task
 */
@Entity('flower_tasks')
@Index(['tenant_id'])
@Index(['compute_task_id'])
@Index(['flower_task_id'])
@Index(['status'])
export class FlowerTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'compute_task_id', unique: true })
  computeTaskId: number;

  @Column({ name: 'flower_task_id', unique: true })
  flowerTaskId: string;

  @Column({
    type: 'simple-enum',
    enum: FlowerTaskStatus,
    default: FlowerTaskStatus.PENDING,
  })
  status: FlowerTaskStatus;

  @Column({ type: 'simple-json', nullable: true })
  config: {
    taskType: string;
    modelType: string;
    datasetConfig: any;
    trainingConfig: any;
    aggregationConfig?: any;
  };

  @Column({ type: 'simple-json', nullable: true, name: 'progress_data' })
  progressData: {
    currentRound: number;
    totalRounds: number;
    currentClient?: string;
    metrics?: Record<string, number>;
  };

  @Column({ length: 100, nullable: true, name: 'server_id' })
  serverId: string;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  @Column({ nullable: true, name: 'started_at' })
  startedAt: Date;

  @Column({ nullable: true, name: 'completed_at' })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
