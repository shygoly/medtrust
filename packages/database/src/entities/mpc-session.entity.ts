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

export enum MpcSessionStatus {
  WAITING_FOR_SHARES = 'waiting_for_shares',
  COMPUTING = 'computing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}

export enum MpcComputationType {
  SECURE_SUM = 'secure_sum',
  SECURE_MEAN = 'secure_mean',
}

@Entity('mpc_sessions')
@Index(['tenant_id'])
@Index(['status'])
@Index(['created_at'])
export class MpcSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ length: 100, unique: true, name: 'session_id' })
  sessionId: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'simple-enum',
    enum: MpcSessionStatus,
    default: MpcSessionStatus.WAITING_FOR_SHARES,
  })
  status: MpcSessionStatus;

  @Column({
    type: 'simple-enum',
    enum: MpcComputationType,
    name: 'computation_type',
  })
  computationType: MpcComputationType;

  // Participants
  @Column({ type: 'simple-json', name: 'participants' })
  participants: Array<{
    party_id: number;
    tenant_id: number;
    endpoint: string;
    share_submitted: boolean;
  }>;

  @Column({ type: 'int', name: 'total_participants' })
  totalParticipants: number;

  @Column({ type: 'int', default: 0, name: 'shares_received' })
  sharesReceived: number;

  // MPC protocol configuration
  @Column({ length: 50, default: 'shamir', name: 'mpc_protocol' })
  mpcProtocol: string;

  @Column({ type: 'int', nullable: true, name: 'threshold' })
  threshold: number;

  // Computation result
  @Column({ type: 'decimal', precision: 20, scale: 10, nullable: true })
  result: number;

  @Column({ type: 'simple-json', nullable: true, name: 'result_metadata' })
  resultMetadata: {
    computation_time_ms?: number;
    protocol_rounds?: number;
    [key: string]: any;
  };

  // Error handling
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  // Timeout configuration
  @Column({ type: 'int', default: 300, name: 'timeout_seconds' })
  timeoutSeconds: number;

  @Column({ nullable: true, name: 'expires_at' })
  expiresAt: Date;

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
