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

export enum FederatedLearningStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum FederatedLearningType {
  HORIZONTAL = 'horizontal',
  VERTICAL = 'vertical',
}

export enum FederatedLearningAlgorithm {
  LOGISTIC_REGRESSION = 'logistic_regression',
  NEURAL_NETWORK = 'neural_network',
  SECURE_BOOST = 'secure_boost',
}

@Entity('federated_learning_jobs')
@Index(['tenant_id'])
@Index(['status'])
@Index(['created_at'])
export class FederatedLearningJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'simple-enum',
    enum: FederatedLearningStatus,
    default: FederatedLearningStatus.PENDING,
  })
  status: FederatedLearningStatus;

  @Column({
    type: 'simple-enum',
    enum: FederatedLearningType,
    name: 'fl_type',
  })
  flType: FederatedLearningType;

  @Column({
    type: 'simple-enum',
    enum: FederatedLearningAlgorithm,
  })
  algorithm: FederatedLearningAlgorithm;

  // FATE Flow job ID
  @Column({ length: 100, nullable: true, name: 'fate_job_id' })
  fateJobId: string;

  // Participants
  @Column({ type: 'simple-json', name: 'participants' })
  participants: Array<{
    party_id: number;
    role: string;
    endpoint: string;
  }>;

  // Training parameters
  @Column({ type: 'simple-json', nullable: true, name: 'training_params' })
  trainingParams: {
    epochs?: number;
    batch_size?: number;
    learning_rate?: number;
    privacy_budget?: number;
  };

  // Dataset references
  @Column({ type: 'simple-json', nullable: true, name: 'dataset_refs' })
  datasetRefs: Array<{
    party_id: number;
    dataset_id: string;
    features: string[];
  }>;

  // Progress tracking
  @Column({ type: 'int', default: 0, name: 'current_epoch' })
  currentEpoch: number;

  @Column({ type: 'int', nullable: true, name: 'total_epochs' })
  totalEpochs: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'progress_percentage' })
  progressPercentage: number;

  // Model output
  @Column({ type: 'text', nullable: true, name: 'model_path' })
  modelPath: string;

  @Column({ type: 'simple-json', nullable: true, name: 'model_metrics' })
  modelMetrics: {
    accuracy?: number;
    loss?: number;
    auc?: number;
    [key: string]: any;
  };

  // Error handling
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  // Timestamps
  @Column({ nullable: true, name: 'started_at' })
  startedAt: Date;

  @Column({ nullable: true, name: 'completed_at' })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
