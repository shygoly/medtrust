import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { FlowerTask } from './flower-task.entity';

export enum ComputeMethod {
  MPC = 'mpc',
  FL = 'fl',
  TEE = 'tee',
  SANDBOX = 'sandbox',
}

export enum ComputeTaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('compute_tasks')
@Index(['tenant_id'])
@Index(['request_id'])
@Index(['status'])
export class ComputeTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant, (tenant) => tenant.computeTasks)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // Legacy authorization link (one-shot access request). Retained for data
  // compatibility during cutover; the relation to DataAccessRequest is dropped
  // so compute-task no longer depends on the centralized access-request module.
  @Column({ nullable: true, name: 'request_id' })
  requestId: number;

  // New authorization reference: the digital contract that authorized this task
  // (control-plane). Replaces the access-request relation (8.2 cutover).
  @Column({ nullable: true, name: 'contract_id' })
  contractId: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'simple-enum',
    enum: ComputeMethod,
  })
  method: ComputeMethod;

  @Column({
    type: 'simple-enum',
    enum: ComputeTaskStatus,
    default: ComputeTaskStatus.PENDING,
  })
  status: ComputeTaskStatus;

  // 计算配置
  @Column({ length: 100, nullable: true, name: 'algorithm_id' })
  algorithmId: string;

  @Column({ type: 'simple-json', nullable: true, name: 'algorithm_params' })
  algorithmParams: any;

  @Column({ type: 'simple-json', nullable: true, name: 'data_assets' })
  dataAssets: any;

  // 资源使用
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'cpu_hours' })
  cpuHours: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'gpu_hours' })
  gpuHours: number;

  @Column({ nullable: true, name: 'memory_gb' })
  memoryGb: number;

  // 结果
  @Column({ type: 'text', nullable: true, name: 'result_path' })
  resultPath: string;

  @Column({ type: 'simple-json', nullable: true, name: 'result_summary' })
  resultSummary: any;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  @Column({ nullable: true, name: 'started_at' })
  startedAt: Date;

  @Column({ nullable: true, name: 'completed_at' })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Flower federated learning task (when method is FL)
  @OneToOne(() => FlowerTask)
  flowerTask: FlowerTask;
}
